# Machabeng Sports Day 2026

The Lovable-hosted Sports Day app: a public live scoreboard, staff event-operations console, and printable meet report. The app uses Supabase/Postgres and Supabase Realtime; the SQLite database from the separate `sportsday-v2` project is intentionally not copied.

## First deployment

1. Connect the Lovable project to Lovable Cloud/Supabase and make sure its existing migrations are applied. Apply [`0003_relay_and_admin_setup.sql`](./drizzle/migrations/0003_relay_and_admin_setup.sql) and [`0004_google_staff_login.sql`](./drizzle/migrations/0004_google_staff_login.sql) if they are not already in the database.
2. In Lovable’s server-side secrets, set `SPORTSDAY_SETUP_KEY` to a private random value of at least 32 characters. For example, generate one locally with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Keep this value out of `VITE_` variables, source control, and shared screenshots.
3. In Supabase **Authentication → Providers → Google**, enable Google and enter the OAuth client ID and secret. Use the callback URL shown by Supabase in the Google OAuth client, and add the deployed staff URL (for example, `https://your-site.example/staff*`) to Supabase **Authentication → URL Configuration → Redirect URLs**. Open `/staff`, choose **First deployment? Set up the admin account**, enter the first administrator’s Google email and setup key, and choose their name, username, and password.
4. After the first admin is created, remove `SPORTSDAY_SETUP_KEY` from the deployment secrets. Admin setup is also blocked while an active admin exists.
5. Add a Google email to each existing staff account in the Team section. Google sign-in is limited to active staff accounts with an explicitly assigned, verified email.

The migration seeds the default houses and meet settings. Start with the fresh Lovable database; do not copy the source SQLite file.

## Local development

Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_PUBLISHABLE_KEY` for the server, plus `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for browser Realtime. First-admin setup also requires a private `SPORTSDAY_SETUP_KEY` of at least 32 characters. Keep these secrets out of source control.

```sh
npm install
npm run dev
```

Use a development Lovable Cloud/Supabase project before using the data-backed routes. Never commit `.env` or service-role credentials. Run `npm test`, `npx tsc --noEmit`, and `npm run build` to validate changes.

## Pages

- `/` — public stadium landing page, live house standings, events, and athlete awards.
- `/staff` — staff sign-in, event recording, schedule, standings, roster, and admin setup.
- `/report` — printable results and awards.

See [`docs/TECHNICAL.md`](./docs/TECHNICAL.md) for the architecture and API overview.
