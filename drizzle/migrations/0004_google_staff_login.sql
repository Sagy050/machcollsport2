ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_email text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_google_email_lower
  ON public.profiles (lower(google_email))
  WHERE google_email IS NOT NULL;
