BEGIN;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS levels text[] NOT NULL DEFAULT ARRAY[]::text[];

UPDATE public.athletes
   SET levels = ARRAY[level]::text[]
 WHERE level IS NOT NULL AND cardinality(levels) = 0;

ALTER TABLE public.athletes DROP CONSTRAINT IF EXISTS athletes_levels_check;
ALTER TABLE public.athletes
  ADD CONSTRAINT athletes_levels_check
  CHECK (
    levels <@ ARRAY['Lower Junior', 'Junior', 'Intermediate', 'Senior', 'Open']::text[]
    AND cardinality(levels) <= 5
    AND (level IS NULL OR level = ANY(levels))
  );

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
    IF (ev.level <> 'Mixed' AND NOT (athlete.levels @> ARRAY[ev.level]::text[]))
       OR (ev.gender IS NOT NULL AND athlete.gender <> ev.gender) THEN
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

INSERT INTO public.sd_entries (event_id, athlete_id, name, house_id, heat, status, updated_at)
SELECT e.id, a.id, a.full_name, a.house_id, 1, 'ok', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM public.sd_events e
JOIN public.athletes a ON a.levels @> ARRAY[e.level]::text[] AND (e.gender IS NULL OR a.gender = e.gender)
WHERE e.kind = 'individual'
ON CONFLICT (event_id, athlete_id) DO NOTHING;

INSERT INTO public.audit (ts, username, action, detail)
VALUES (
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  'migration',
  'athletes.multiple_divisions',
  'Added support for athlete eligibility in multiple age groups.'
);

COMMIT;
