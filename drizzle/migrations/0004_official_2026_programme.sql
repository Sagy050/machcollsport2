BEGIN;

ALTER TABLE public.athletes DROP CONSTRAINT IF EXISTS athletes_level_check;
ALTER TABLE public.athletes
  ADD CONSTRAINT athletes_level_check
  CHECK (level IS NULL OR level IN ('Lower Junior', 'Junior', 'Intermediate', 'Senior', 'Open'));

ALTER TABLE public.sd_events DROP CONSTRAINT IF EXISTS sd_events_level_check;
ALTER TABLE public.sd_events
  ADD CONSTRAINT sd_events_level_check
  CHECK (level IN ('Lower Junior', 'Junior', 'Intermediate', 'Senior', 'Open', 'Mixed'));

ALTER TABLE public.sd_events
  ADD COLUMN IF NOT EXISTS relay_legs integer NOT NULL DEFAULT 0;
ALTER TABLE public.sd_events ALTER COLUMN relay_legs SET DEFAULT 0;
UPDATE public.sd_events
   SET relay_legs = CASE WHEN kind = 'relay' THEN 4 ELSE 0 END;
ALTER TABLE public.sd_events DROP CONSTRAINT IF EXISTS sd_events_relay_legs_check;
ALTER TABLE public.sd_events
  ADD CONSTRAINT sd_events_relay_legs_check
  CHECK ((kind = 'relay' AND relay_legs IN (4, 8)) OR (kind <> 'relay' AND relay_legs = 0));

ALTER TABLE public.relay_members DROP CONSTRAINT IF EXISTS relay_members_leg_check;
ALTER TABLE public.relay_members
  ADD CONSTRAINT relay_members_leg_check CHECK (leg BETWEEN 1 AND 8);
ALTER TABLE public.relay_splits DROP CONSTRAINT IF EXISTS relay_splits_leg_check;
ALTER TABLE public.relay_splits
  ADD CONSTRAINT relay_splits_leg_check CHECK (leg BETWEEN 1 AND 8);

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
  IF cardinality(_athlete_ids) <> ev.relay_legs
     OR (SELECT count(DISTINCT value) FROM unnest(_athlete_ids) AS ids(value)) <> ev.relay_legs THEN
    RAISE EXCEPTION 'Choose exactly % different runners', ev.relay_legs USING ERRCODE = 'P0001';
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
  IF _leg < 1 OR _leg > ev.relay_legs THEN
    RAISE EXCEPTION 'Relay leg must be between 1 and %', ev.relay_legs USING ERRCODE = 'P0001';
  END IF;
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
  IF (SELECT count(*) FROM public.relay_members WHERE entry_id = _entry) <> ev.relay_legs THEN
    RAISE EXCEPTION 'An admin must set all % runners for this relay team first', ev.relay_legs USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(max(leg), 0) + 1 INTO expected_leg FROM public.relay_splits WHERE entry_id = _entry;
  IF _leg <> expected_leg THEN RAISE EXCEPTION 'Record relay leg % next', expected_leg USING ERRCODE = 'P0001'; END IF;
  SELECT coalesce(max(cumulative_ms), 0) INTO previous_ms FROM public.relay_splits WHERE entry_id = _entry;
  IF _elapsed_ms <= previous_ms THEN RAISE EXCEPTION 'Each relay leg time must be later than the previous handoff' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.relay_splits(entry_id, leg, cumulative_ms, updated_by, updated_at)
    VALUES (_entry, _leg, _elapsed_ms, _actor, _now);
  UPDATE public.sd_entries SET updated_by = _actor, updated_at = _now WHERE id = _entry;
  IF _leg = ev.relay_legs THEN
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
  IF last_leg = ev.relay_legs THEN
    UPDATE public.sd_entries SET performance = '', perf_value = NULL, status = 'ok', updated_by = _actor, updated_at = _now WHERE id = _entry;
  ELSE
    UPDATE public.sd_entries SET updated_by = _actor, updated_at = _now WHERE id = _entry;
  END IF;
  RETURN jsonb_build_object('leg', last_leg);
END $$;

REVOKE EXECUTE ON FUNCTION public.sd_set_relay_lineup(integer, integer[], integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_record_relay_split(integer, integer, bigint, text, double precision, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_undo_relay_split(integer, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sd_set_relay_lineup(integer, integer[], integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.sd_record_relay_split(integer, integer, bigint, text, double precision, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.sd_undo_relay_split(integer, integer, bigint) TO service_role;

INSERT INTO public.backups (created_at, label, data)
VALUES (
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  'before-official-programme-2026-11-20',
  jsonb_build_object(
    'app', 'machabeng-sports-day',
    'version', 2,
    'settings', (SELECT value FROM public.app_settings WHERE key = 'settings'),
    'houses', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.houses h), '[]'::jsonb),
    'athletes', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.athletes a), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.sd_events e), '[]'::jsonb),
    'entries', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.sd_entries e), '[]'::jsonb),
    'relayMembers', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.entry_id, m.leg) FROM public.relay_members m), '[]'::jsonb),
    'relaySplits', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.entry_id, s.leg) FROM public.relay_splits s), '[]'::jsonb)
  )
);

DELETE FROM public.sd_events;

INSERT INTO public.sd_events
  (name, level, gender, kind, measure, sched_time, relay_legs, status, sort, created_at, updated_at)
SELECT p.name, p.level, p.gender, p.kind, p.measure, p.sched_time, p.relay_legs,
       'scheduled', p.seq, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM (VALUES
  (1,  '1200m',             'Senior',       'F', 'individual', 'time',     '08:00', 0),
  (2,  '1200m',             'Senior',       'M', 'individual', 'time',     '08:10', 0),
  (3,  '1200m',             'Open',         'F', 'individual', 'time',     '08:20', 0),
  (4,  '1200m',             'Open',         'M', 'individual', 'time',     '08:30', 0),
  (5,  '400m',              'Lower Junior', 'F', 'individual', 'time',     '08:40', 0),
  (6,  '400m',              'Lower Junior', 'M', 'individual', 'time',     '08:50', 0),
  (7,  '600m',              'Junior',       'F', 'individual', 'time',     '09:00', 0),
  (8,  '600m',              'Junior',       'M', 'individual', 'time',     '09:10', 0),
  (9,  'Shot Put',          'Intermediate', 'F', 'individual', 'distance', '09:40', 0),
  (10, 'Shot Put',          'Intermediate', 'M', 'individual', 'distance', '09:50', 0),
  (11, '800m',              'Intermediate', 'F', 'individual', 'time',     '10:00', 0),
  (12, '800m',              'Intermediate', 'M', 'individual', 'time',     '10:10', 0),
  (13, 'Cricket Ball Throw','Junior',       'F', 'individual', 'distance', '10:20', 0),
  (14, 'Cricket Ball Throw','Junior',       'M', 'individual', 'distance', '10:30', 0),
  (15, 'Shot Put',          'Senior',       'F', 'individual', 'distance', '10:40', 0),
  (16, 'Shot Put',          'Senior',       'M', 'individual', 'distance', '10:40', 0),
  (17, '60m',               'Lower Junior', 'F', 'individual', 'time',     '10:45', 0),
  (18, '60m',               'Lower Junior', 'M', 'individual', 'time',     '10:55', 0),
  (19, '60m',               'Junior',       'F', 'individual', 'time',     '11:05', 0),
  (20, '60m',               'Junior',       'M', 'individual', 'time',     '11:15', 0),
  (21, 'Shot Put',          'Open',         'F', 'individual', 'distance', '11:30', 0),
  (22, 'Shot Put',          'Open',         'M', 'individual', 'distance', '11:30', 0),
  (23, 'Tennis Ball Throw', 'Lower Junior', 'F', 'individual', 'distance', '11:50', 0),
  (24, 'Tennis Ball Throw', 'Lower Junior', 'M', 'individual', 'distance', '11:50', 0),
  (25, '100m',              'Intermediate', 'F', 'individual', 'time',     '12:10', 0),
  (26, '100m',              'Intermediate', 'M', 'individual', 'time',     '12:15', 0),
  (27, '100m',              'Senior',       'F', 'individual', 'time',     '12:20', 0),
  (28, '100m',              'Senior',       'M', 'individual', 'time',     '12:25', 0),
  (29, '100m',              'Open',         'F', 'individual', 'time',     '12:30', 0),
  (30, '100m',              'Open',         'M', 'individual', 'time',     '12:35', 0),
  (31, '8 x 50m Relay',     'Junior',       NULL, 'relay',      'time',     '12:40', 8),
  (32, '4 x 100m Relay',    'Intermediate', 'F', 'relay',       'time',     '12:50', 4),
  (33, '4 x 100m Relay',    'Intermediate', 'M', 'relay',       'time',     '13:00', 4),
  (34, '4 x 100m Relay',    'Senior',       'F', 'relay',       'time',     '13:10', 4),
  (35, '4 x 100m Relay',    'Senior',       'M', 'relay',       'time',     '13:15', 4),
  (36, '4 x 100m Relay',    'Open',         'F', 'relay',       'time',     '13:20', 4),
  (37, '4 x 100m Relay',    'Open',         'M', 'relay',       'time',     '13:25', 4)
) AS p(seq, name, level, gender, kind, measure, sched_time, relay_legs)
ORDER BY p.seq;

INSERT INTO public.sd_entries (event_id, athlete_id, name, house_id, heat, status, updated_at)
SELECT e.id, a.id, a.full_name, a.house_id, 1, 'ok', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM public.sd_events e
JOIN public.athletes a ON a.level = e.level AND (e.gender IS NULL OR a.gender = e.gender)
WHERE e.kind = 'individual';

INSERT INTO public.sd_entries (event_id, athlete_id, name, house_id, heat, status, updated_at)
SELECT e.id, NULL, h.name || ' team', h.id, 1, 'ok', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM public.sd_events e CROSS JOIN public.houses h
WHERE e.kind = 'relay';

WITH eligible AS (
  SELECT entry.id AS entry_id, athlete.id AS athlete_id, ev.relay_legs,
         row_number() OVER (PARTITION BY entry.id ORDER BY athlete.bib COLLATE "C") AS leg,
         count(*) OVER (PARTITION BY entry.id) AS runner_count
  FROM public.sd_entries entry
  JOIN public.sd_events ev ON ev.id = entry.event_id
  JOIN public.athletes athlete
    ON athlete.house_id = entry.house_id
   AND athlete.level = ev.level
   AND (ev.gender IS NULL OR athlete.gender = ev.gender)
  WHERE ev.kind = 'relay' AND entry.athlete_id IS NULL
)
INSERT INTO public.relay_members (entry_id, leg, athlete_id)
SELECT entry_id, leg::smallint, athlete_id
FROM eligible
WHERE leg <= relay_legs AND runner_count >= relay_legs;

UPDATE public.app_settings
   SET value = jsonb_set(jsonb_set(value, '{finalised}', 'false'::jsonb, true), '{finalisedAt}', 'null'::jsonb, true)
 WHERE key = 'settings';

INSERT INTO public.audit (ts, username, action, detail)
VALUES (floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, 'migration', 'programme.replace', 'Installed the official 2026-11-20 programme; prior events and results are in backups.');

COMMIT;
