# Machabeng Sports Day 2026

The Lovable-hosted Sports Day app: a public live scoreboard, staff event-operations console, and printable meet report. The app uses Supabase/Postgres and Supabase Realtime; the SQLite database from the separate `sportsday-v2` project is intentionally not copied.

## First deployment

1. Connect the Lovable project to Lovable Cloud/Supabase and make sure migrations `0000` through `0003` are applied. Apply [`0004_official_2026_programme.sql`](./drizzle/migrations/0004_official_2026_programme.sql) once to back up the old schedule/results and install the official programme. It keeps the athlete roster and staff accounts.
2. In Lovable’s server-side secrets, set `SPORTSDAY_SETUP_KEY` to a private random value of at least 32 characters. For example, generate one locally with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Keep this value out of `VITE_` variables, source control, and shared screenshots.
3. Open `/staff`, choose **First deployment? Set up the admin account**, enter the setup key, and choose the first administrator’s name, username, and password.
4. After the first admin is created, remove `SPORTSDAY_SETUP_KEY` from the deployment secrets. Admin setup is also blocked while an active admin exists.

The migration seeds the default houses and meet settings. Start with the fresh Lovable database; do not copy the source SQLite file.

The official programme uses Lower Junior (S1–S2), Junior (S3), Intermediate (S4–S5), Senior (IBDP 1), and Open (IBDP 2 / Open). Review each athlete's age-group assignment before recording; the migration preserves existing roster assignments and does not guess which current athletes belong to Lower Junior or Open. The 8 × 50m Juniors relay uses eight runners per house.

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
