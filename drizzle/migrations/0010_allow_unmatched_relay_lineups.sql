BEGIN;

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
BEGIN
  SELECT * INTO team FROM public.sd_entries WHERE id = _entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relay team no longer exists' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO ev FROM public.sd_events WHERE id = team.event_id;
  IF ev.kind <> 'relay' THEN RAISE EXCEPTION 'This event is not a relay' USING ERRCODE = 'P0001'; END IF;
  IF cardinality(_athlete_ids) <> ev.relay_legs
     OR (SELECT count(DISTINCT value) FROM unnest(_athlete_ids) AS ids(value)) <> ev.relay_legs THEN
    RAISE EXCEPTION 'Choose exactly % different runners', ev.relay_legs USING ERRCODE = 'P0001';
  END IF;
  IF team.perf_value IS NOT NULL OR team.status <> 'ok' OR EXISTS (SELECT 1 FROM public.relay_splits WHERE entry_id = _entry) THEN
    RAISE EXCEPTION 'Clear this team relay result before changing its runners' USING ERRCODE = 'P0001';
  END IF;
  FOREACH athlete_id IN ARRAY _athlete_ids LOOP
    SELECT * INTO athlete FROM public.athletes WHERE id = athlete_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'One or more selected athletes no longer exist' USING ERRCODE = 'P0001'; END IF;
    IF athlete.house_id <> team.house_id THEN RAISE EXCEPTION 'All runners must belong to this house' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  DELETE FROM public.relay_members WHERE entry_id = _entry;
  INSERT INTO public.relay_members(entry_id, leg, athlete_id)
    SELECT _entry, ord::smallint, value
    FROM unnest(_athlete_ids) WITH ORDINALITY AS ids(value, ord)
    ORDER BY ord;
  UPDATE public.sd_entries SET updated_by = _actor, updated_at = _now WHERE id = _entry;
  RETURN jsonb_build_object('entry_id', _entry, 'athlete_ids', to_jsonb(_athlete_ids));
END $$;

REVOKE EXECUTE ON FUNCTION public.sd_set_relay_lineup(integer, integer[], integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sd_set_relay_lineup(integer, integer[], integer, bigint) TO service_role;

COMMIT;
