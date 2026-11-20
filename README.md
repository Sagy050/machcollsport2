# Machabeng Sports Day 2026

The Lovable-hosted Sports Day app: a public live scoreboard, staff event-operations console, and printable meet report. The app uses Supabase/Postgres and Supabase Realtime; the SQLite database from the separate `sportsday-v2` project is intentionally not copied.

## First deployment

1. Connect the Lovable project to Lovable Cloud/Supabase and make sure migrations `0000` through `0003` are applied. Apply [`0004_official_2026_programme.sql`](./drizzle/migrations/0004_official_2026_programme.sql) once to back up the old schedule/results and install the official programme. It keeps the athlete roster and staff accounts.
2. Apply [`0005_athlete_multiple_divisions.sql`](./drizzle/migrations/0005_athlete_multiple_divisions.sql) after `0004`. It lets an athlete be assigned to more than one age group and seeds the corresponding individual event entries.
3. Apply [`0006_ravens_events.sql`](./drizzle/migrations/0006_ravens_events.sql) after `0005`. It adds the Ravens PDF's missing events; field-event start times can be set in **Setup → Events**.
4. Apply [`0007_lower_junior_events.sql`](./drizzle/migrations/0007_lower_junior_events.sql) after `0006`. It adds the Lower Junior long jump and 4 × 100m relay events from the Eagles and Hawks lists.
5. Apply [`0008_falcons_long_jump_divisions.sql`](./drizzle/migrations/0008_falcons_long_jump_divisions.sql) after `0007` to add the Falcons long-jump divisions.
6. Apply [`0009_ads_and_athlete_photos.sql`](./drizzle/migrations/0009_ads_and_athlete_photos.sql) after `0008`. It adds admin-managed marketplace ads and private storage buckets for ad and consented athlete photos.
7. In Lovable’s server-side secrets, set `SPORTSDAY_SETUP_KEY` to a private random value of at least 32 characters. For example, generate one locally with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Keep this value out of `VITE_` variables, source control, and shared screenshots.
8. Open `/staff`, choose **First deployment? Set up the admin account**, enter the setup key, and choose the first administrator’s name, username, and password.
9. After the first admin is created, remove `SPORTSDAY_SETUP_KEY` from the deployment secrets. Admin setup is also blocked while an active admin exists.

The migration seeds the default houses and meet settings. Start with the fresh Lovable database; do not copy the source SQLite file.

The official programme uses Lower Junior (S1–S2), Junior (S3), Intermediate (S4–S5), Senior (IBDP 1), and Open (IBDP 2 / Open). Athletes can be assigned to multiple age groups from **Setup → Athletes**; when importing a roster, separate multiple values in the Age Groups column with semicolons. In the Events column, use `Junior: Long Jump` to target a specific division when an event name appears in more than one division. Event awards are counted in the division of each entered event. The 8 × 50m Juniors relay uses eight runners per house.

Roster imports can include relay lineups in the optional **Relay Teams** column, so athletes, individual event requests, and relay legs can be uploaded together in one CSV or workbook. Each assignment uses `Age Group | Gender | Event | Leg`, for example `Junior | F | 4 x 100m Relay | 1`; separate multiple assignments with semicolons. Include every leg for a team, using each athlete once. Keep relay assignments out of the **Events** column.

## Local development

Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_PUBLISHABLE_KEY` for the server, plus `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for browser Realtime. First-admin setup also requires a private `SPORTSDAY_SETUP_KEY` of at least 32 characters. Keep these secrets out of source control.

```sh
npm install
npm run dev
```

Use a development Lovable Cloud/Supabase project before using the data-backed routes. Never commit `.env` or service-role credentials. Run `npm test`, `npx tsc --noEmit`, and `npm run build` to validate changes.

## Pages

- `/` — public stadium landing page, live house standings, events, and athlete awards.
- `/ads` — public, searchable student club marketplace.
- `/staff` — staff sign-in, event recording, schedule, standings, roster, and admin setup.
- `/report` — printable results and awards.

See [`docs/TECHNICAL.md`](./docs/TECHNICAL.md) for the architecture and API overview.
