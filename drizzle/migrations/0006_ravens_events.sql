BEGIN;

INSERT INTO public.sd_events
  (name, level, gender, kind, measure, sched_time, relay_legs, status, sort, created_at, updated_at)
SELECT p.name, p.level, p.gender, p.kind, p.measure, '', p.relay_legs, 'scheduled', p.seq,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
       floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM (VALUES
  (38, '400m',             'Junior',       'F', 'individual', 'time',     0),
  (39, '400m',             'Junior',       'M', 'individual', 'time',     0),
  (40, 'Long Jump',        'Junior',       'F', 'individual', 'distance', 0),
  (41, 'Long Jump',        'Junior',       'M', 'individual', 'distance', 0),
  (42, 'Tennis Ball Throw','Junior',       'F', 'individual', 'distance', 0),
  (43, 'Tennis Ball Throw','Junior',       'M', 'individual', 'distance', 0),
  (44, '4 x 100m Relay',   'Junior',       'F', 'relay',      'time',     4),
  (45, '4 x 100m Relay',   'Junior',       'M', 'relay',      'time',     4),
  (46, 'Long Jump',        'Intermediate', 'F', 'individual', 'distance', 0),
  (47, 'Long Jump',        'Intermediate', 'M', 'individual', 'distance', 0),
  (48, 'Long Jump',        'Senior',       'F', 'individual', 'distance', 0),
  (49, 'Long Jump',        'Senior',       'M', 'individual', 'distance', 0)
) AS p(seq, name, level, gender, kind, measure, relay_legs)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sd_events e
  WHERE e.name = p.name
    AND e.level = p.level
    AND e.gender IS NOT DISTINCT FROM p.gender
    AND e.kind = p.kind
);

INSERT INTO public.audit (ts, username, action, detail)
VALUES (
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  'migration',
  'programme.ravens_events',
  'Added Ravens-listed Junior 400m, long jump, tennis throw and 4 x 100m relay events with unscheduled times.'
);

COMMIT;
