ALTER TABLE public.sd_events
  ADD COLUMN IF NOT EXISTS heat_ends jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.relay_members (
  entry_id integer NOT NULL REFERENCES public.sd_entries(id) ON DELETE CASCADE,
  leg smallint NOT NULL CHECK (leg BETWEEN 1 AND 4),
  athlete_id integer NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, leg),
  UNIQUE (entry_id, athlete_id)
);

CREATE INDEX relay_members_athlete ON public.relay_members (athlete_id);

CREATE TABLE public.relay_splits (
  entry_id integer NOT NULL REFERENCES public.sd_entries(id) ON DELETE CASCADE,
  leg smallint NOT NULL CHECK (leg BETWEEN 1 AND 4),
  cumulative_ms bigint NOT NULL CHECK (cumulative_ms > 0),
  updated_by integer,
  updated_at bigint NOT NULL,
  PRIMARY KEY (entry_id, leg)
);

CREATE TABLE public.sportsday_admin_bootstrap (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  claim_token text NOT NULL,
  claimed_at bigint NOT NULL
);

REVOKE ALL ON public.relay_members, public.relay_splits, public.sportsday_admin_bootstrap FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.relay_members, public.relay_splits, public.sportsday_admin_bootstrap TO service_role;
ALTER TABLE public.relay_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relay_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sportsday_admin_bootstrap ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER bump_relay_members AFTER INSERT OR UPDATE OR DELETE ON public.relay_members
  FOR EACH STATEMENT EXECUTE FUNCTION public.sd_bump_version();
CREATE TRIGGER bump_relay_splits AFTER INSERT OR UPDATE OR DELETE ON public.relay_splits
  FOR EACH STATEMENT EXECUTE FUNCTION public.sd_bump_version();

CREATE OR REPLACE FUNCTION public.sd_set_relay_lineup(
  _entry integer,
  _athlete_ids integer[],
  _actor integer,
  _now bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  team public.sd_entries;
  ev public.sd_events;
  athlete_id integer;
  athlete public.athletes;
  leg integer := 0;
BEGIN
  SELECT * INTO team FROM public.sd_entries WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relay team no longer exists' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO ev FROM public.sd_events WHERE id = team.event_id;
  IF ev.kind <> 'relay' THEN RAISE EXCEPTION 'This event is not a relay' USING ERRCODE = 'P0001'; END IF;
  IF cardinality(_athlete_ids) <> 4 OR (SELECT count(DISTINCT value) FROM unnest(_athlete_ids) AS ids(value)) <> 4 THEN
    RAISE EXCEPTION 'Choose exactly four different runners' USING ERRCODE = 'P0001';
  END IF;
  IF team.perf_value IS NOT NULL OR team.status <> 'ok' OR EXISTS (SELECT 1 FROM public.relay_splits WHERE entry_id = _entry) THEN
    RAISE EXCEPTION 'Clear this team relay result before changing its runners' USING ERRCODE = 'P0001';
  END IF;
  FOREACH athlete_id IN ARRAY _athlete_ids LOOP
    leg := leg + 1;
    SELECT * INTO athlete FROM public.athletes WHERE id = athlete_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'One or more selected athletes no longer exist' USING ERRCODE = 'P0001'; END IF;
    IF athlete.house_id <> team.house_id THEN RAISE EXCEPTION 'All runners must belong to this house' USING ERRCODE = 'P0001'; END IF;
    IF (ev.level <> 'Mixed' AND athlete.level <> ev.level) OR (ev.gender IS NOT NULL AND athlete.gender <> ev.gender) THEN
      RAISE EXCEPTION 'All runners must match this relay age group and gender' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  DELETE FROM public.relay_members WHERE entry_id = _entry;
  INSERT INTO public.relay_members(entry_id, leg, athlete_id)
    SELECT _entry, ord::smallint, value
    FROM unnest(_athlete_ids) WITH ORDINALITY AS ids(value, ord)
    ORDER BY ord;
  UPDATE public.sd_entries SET updated_by = _actor, updated_at = _now WHERE id = _entry;
  RETURN jsonb_build_object('entry_id', _entry, 'athlete_ids', to_jsonb(_athlete_ids));
END $$;

CREATE OR REPLACE FUNCTION public.sd_record_relay_split(
  _entry integer,
  _leg integer,
  _elapsed_ms bigint,
  _performance text,
  _perf_value double precision,
  _actor integer,
  _now bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  team public.sd_entries;
  ev public.sd_events;
  previous_ms bigint := 0;
  existing_ms bigint;
  expected_leg integer;
  start_at bigint;
BEGIN
  SELECT * INTO team FROM public.sd_entries WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relay team no longer exists' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO ev FROM public.sd_events WHERE id = team.event_id;
  IF ev.kind <> 'relay' THEN RAISE EXCEPTION 'This event is not a relay' USING ERRCODE = 'P0001'; END IF;
  IF _leg < 1 OR _leg > 4 THEN RAISE EXCEPTION 'Relay leg must be between 1 and 4' USING ERRCODE = 'P0001'; END IF;
  SELECT cumulative_ms INTO existing_ms FROM public.relay_splits WHERE entry_id = _entry AND leg = _leg;
  IF FOUND AND existing_ms = _elapsed_ms THEN
    IF _leg > 1 THEN
      SELECT cumulative_ms INTO previous_ms FROM public.relay_splits WHERE entry_id = _entry AND leg = _leg - 1;
    END IF;
    RETURN jsonb_build_object('leg', _leg, 'cumulative_ms', _elapsed_ms, 'split_ms', _elapsed_ms - coalesce(previous_ms, 0));
  END IF;
  IF team.status <> 'ok' OR team.perf_value IS NOT NULL THEN
    RAISE EXCEPTION 'Clear this team result or status before recording relay legs' USING ERRCODE = 'P0001';
  END IF;
  start_at := (ev.heat_starts ->> team.heat::text)::bigint;
  IF start_at IS NULL THEN RAISE EXCEPTION 'Start the clock first' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(*) FROM public.relay_members WHERE entry_id = _entry) <> 4 THEN
    RAISE EXCEPTION 'An admin must set four runners for this relay team first' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(max(leg), 0) + 1 INTO expected_leg FROM public.relay_splits WHERE entry_id = _entry;
  IF _leg <> expected_leg THEN RAISE EXCEPTION 'Record relay leg % next', expected_leg USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(max(cumulative_ms), 0) INTO previous_ms FROM public.relay_splits WHERE entry_id = _entry;
  IF _elapsed_ms <= previous_ms THEN RAISE EXCEPTION 'Each relay leg time must be later than the previous handoff' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.relay_splits(entry_id, leg, cumulative_ms, updated_by, updated_at)
    VALUES (_entry, _leg, _elapsed_ms, _actor, _now);
  UPDATE public.sd_entries SET updated_by = _actor, updated_at = _now WHERE id = _entry;
  IF _leg = 4 THEN
    UPDATE public.sd_entries
       SET performance = _performance, perf_value = _perf_value, status = 'ok',
           updated_by = _actor, updated_at = _now
     WHERE id = _entry;
  END IF;
  IF ev.status = 'scheduled' THEN
    UPDATE public.sd_events SET status = 'live', updated_at = _now WHERE id = ev.id;
  END IF;
  RETURN jsonb_build_object('leg', _leg, 'cumulative_ms', _elapsed_ms, 'split_ms', _elapsed_ms - previous_ms);
END $$;

CREATE OR REPLACE FUNCTION public.sd_undo_relay_split(_entry integer, _actor integer, _now bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  team public.sd_entries;
  ev public.sd_events;
  last_leg integer;
BEGIN
  SELECT * INTO team FROM public.sd_entries WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relay team no longer exists' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO ev FROM public.sd_events WHERE id = team.event_id;
  IF ev.kind <> 'relay' THEN RAISE EXCEPTION 'This event is not a relay' USING ERRCODE = 'P0001'; END IF;
  SELECT max(leg) INTO last_leg FROM public.relay_splits WHERE entry_id = _entry;
  IF last_leg IS NULL THEN RAISE EXCEPTION 'There is no relay leg to undo' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM public.relay_splits WHERE entry_id = _entry AND leg = last_leg;
  IF last_leg = 4 THEN
    UPDATE public.sd_entries SET performance = '', perf_value = NULL, status = 'ok', updated_by = _actor, updated_at = _now WHERE id = _entry;
  ELSE
    UPDATE public.sd_entries SET updated_by = _actor, updated_at = _now WHERE id = _entry;
  END IF;
  RETURN jsonb_build_object('leg', last_leg);
END $$;

CREATE OR REPLACE FUNCTION public.sd_reset_heat(_event integer, _heat integer, _force boolean, _actor integer, _now bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev public.sd_events;
  recorded integer;
BEGIN
  SELECT * INTO ev FROM public.sd_events WHERE id = _event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0001'; END IF;
  SELECT count(DISTINCT e.id) INTO recorded
    FROM public.sd_entries e
    LEFT JOIN public.relay_splits s ON s.entry_id = e.id
   WHERE e.event_id = _event AND e.heat = _heat
     AND (e.perf_value IS NOT NULL OR e.status <> 'ok' OR s.entry_id IS NOT NULL);
  IF recorded > 0 AND NOT _force THEN
    RAISE EXCEPTION '% result(s) are already recorded in this heat', recorded USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.sd_entries AS e
     SET performance = '', perf_value = NULL, status = 'ok', updated_by = _actor, updated_at = _now
   WHERE e.event_id = _event AND e.heat = _heat
     AND (e.perf_value IS NOT NULL OR e.status <> 'ok' OR EXISTS (SELECT 1 FROM public.relay_splits s WHERE s.entry_id = e.id));
  DELETE FROM public.relay_splits
   WHERE entry_id IN (SELECT id FROM public.sd_entries WHERE event_id = _event AND heat = _heat);
  UPDATE public.sd_events
     SET heat_starts = heat_starts - _heat::text,
         heat_ends = heat_ends - _heat::text,
         updated_at = _now
   WHERE id = _event;
  RETURN jsonb_build_object('cleared', recorded);
END $$;

REVOKE EXECUTE ON FUNCTION public.sd_set_relay_lineup(integer, integer[], integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_record_relay_split(integer, integer, bigint, text, double precision, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_undo_relay_split(integer, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_reset_heat(integer, integer, boolean, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sd_set_relay_lineup(integer, integer[], integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.sd_record_relay_split(integer, integer, bigint, text, double precision, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.sd_undo_relay_split(integer, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.sd_reset_heat(integer, integer, boolean, integer, bigint) TO service_role;
