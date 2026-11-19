BEGIN;

INSERT INTO public.sd_events
  (name, level, gender, kind, measure, sched_time, relay_legs, status, sort, created_at, updated_at)
SELECT 'Long Jump', p.level, p.gender, 'individual', 'distance', '', 0, 'scheduled', p.seq,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM (VALUES
  ('Lower Junior', 'F', 54),
  ('Lower Junior', 'M', 55),
  ('Open',         'F', 56),
  ('Open',         'M', 57)
) AS p(level, gender, seq)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sd_events e
  WHERE e.name = 'Long Jump'
    AND e.level = p.level
    AND e.gender IS NOT DISTINCT FROM p.gender
    AND e.kind = 'individual'
);

INSERT INTO public.sd_entries (event_id, athlete_id, name, house_id, heat, status, updated_at)
SELECT e.id, a.id, a.full_name, a.house_id, 1, 'ok',
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM public.sd_events e
JOIN public.athletes a
  ON a.levels @> ARRAY[e.level]::text[]
 AND (e.gender IS NULL OR a.gender = e.gender)
WHERE e.name = 'Long Jump'
  AND e.level IN ('Lower Junior', 'Open')
  AND e.kind = 'individual'
ON CONFLICT (event_id, athlete_id) DO NOTHING;

INSERT INTO public.audit (ts, username, action, detail)
VALUES (
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  'migration',
  'programme.falcons_long_jump',
  'Added Lower Junior and Open Long Jump divisions for the Falcons roster.'
);

COMMIT;
