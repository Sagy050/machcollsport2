BEGIN;

INSERT INTO public.sd_events
  (name, level, gender, kind, measure, sched_time, relay_legs, status, sort, created_at, updated_at)
SELECT p.name, 'Lower Junior', p.gender, p.kind, p.measure, '', p.relay_legs, 'scheduled', p.seq,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM (VALUES
  (50, 'Long Jump',     'F', 'individual', 'distance', 0),
  (51, 'Long Jump',     'M', 'individual', 'distance', 0),
  (52, '4 x 100m Relay','F', 'relay',      'time',     4),
  (53, '4 x 100m Relay','M', 'relay',      'time',     4)
) AS p(seq, name, gender, kind, measure, relay_legs)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sd_events e
  WHERE e.name = p.name
    AND e.level = 'Lower Junior'
    AND e.gender IS NOT DISTINCT FROM p.gender
    AND e.kind = p.kind
);

INSERT INTO public.sd_entries (event_id, athlete_id, name, house_id, heat, status, updated_at)
SELECT e.id, NULL, h.name || ' team', h.id, 1, 'ok',
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM public.sd_events e
CROSS JOIN public.houses h
WHERE e.kind = 'relay'
  AND e.name = '4 x 100m Relay'
  AND e.level IN ('Lower Junior', 'Junior')
  AND NOT EXISTS (
    SELECT 1
    FROM public.sd_entries entry
    WHERE entry.event_id = e.id
      AND entry.house_id = h.id
      AND entry.athlete_id IS NULL
  );

INSERT INTO public.audit (ts, username, action, detail)
VALUES (
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  'migration',
  'programme.lower_junior_events',
  'Added Lower Junior long jump and 4 x 100m relay divisions with unscheduled times.'
);

COMMIT;
