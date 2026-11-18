UPDATE public.houses
SET color = CASE lower(name)
  WHEN 'ravens' THEN '#EAB308'
  WHEN 'hawks' THEN '#2563EB'
  WHEN 'eagles' THEN '#EF4444'
  WHEN 'falcons' THEN '#16A34A'
  ELSE color
END
WHERE lower(name) IN ('ravens', 'hawks', 'eagles', 'falcons');
