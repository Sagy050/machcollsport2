# Technical documentation

## Architecture

The Lovable application keeps the existing TanStack Start/Nitro server and Lovable Cloud/Supabase database. The public, staff, and report screens are static HTML/CSS/JavaScript served by `src/server/sportsday/pages.ts`; server-side API handlers and data access are in `src/server/sportsday/`. Supabase Postgres stores the meet data, Supabase Auth validates staff passwords, and Supabase Realtime signals page refreshes through `live_version`.

The separate `sportsday-v2` app uses Express and SQLite. Its database and deployment configuration are not part of this app. The staff UI and supported meet operations have been ported while keeping Lovable hosting, authentication, and realtime.

## Data and meet operations

- **Athletes:** name, house, age group, gender, and a unique bib.
- **Events and entries:** individual events may be timed or measured by distance; relay events create one team entry per house. Relay lineups use four eligible athletes, and each baton handoff records a cumulative split.
- **Results:** positions and points are calculated from the recorded performance. Tied performances share a position. Relay points go to the house, not an individual.
- **Roster intake:** administrators can import CSV/TXT/XLS/XLSX rosters, download a sample workbook, and clear the roster after results are cleared. Clearing the roster saves a database backup.
- **Live recording:** recorder actions require a staff session. Staff state and public results are read through the server API; database changes update `live_version`, which the browser listens to through Supabase Realtime.

The database schema and incremental changes live in `drizzle/migrations/`. Migration `0003_relay_and_admin_setup.sql` adds relay lineup/split storage, heat-end data, and the one-time administrator setup claim. Apply it to the Lovable database before deploying code that uses those features.

## Roles

| Capability | Public | Recorder | Admin |
|---|---:|---:|---:|
| View scoreboard, events, and report | yes | yes | yes |
| Start clocks and record results | no | yes | yes |
| Manage athletes, events, relay lineups, and heats | no | no | yes |
| Manage staff accounts, scoring, settings, backups, and resets | no | no | yes |

Roles are checked in the API, not only hidden in the interface.

## First administrator

The first administrator is created through `/api/bootstrap` only when there is no active admin and a server-side `SPORTSDAY_SETUP_KEY` of at least 32 characters is configured. The setup code is compared in constant time, failed attempts are rate-limited, and a database claim prevents concurrent initial-admin creation. The route creates a Supabase Auth account and staff profile, then signs in the new admin. It never allows public admin creation after an active admin exists.

Do not expose the setup key through a `VITE_` variable. Remove it from deployment secrets after setup; to intentionally reopen first-admin setup, configure a new key only after no active admin remains.

## Security and persistence

- Supabase Auth stores and validates passwords; the app stores hashed, short-lived staff session tokens in `staff_sessions`.
- Server routes use the Supabase service-role client. It must remain server-only and must never be included in browser bundles.
- Write routes require the app’s custom request header and reject cross-site requests.
- API inputs have size and field limits; roster uploads are capped at 8 MB.
- Relay split writes, relay lineup changes, and heat resets use Postgres functions to preserve atomic validation and writes.
- Roster clearing and full resets create a backup record first. User actions are written to the audit table.

## API overview

- **Public:** `GET /api/state`, `/api/results.csv`, `/api/time`.
- **Sign-in and first setup:** `GET /api/me`, `POST /api/login`, `/api/logout`, `/api/me/password`, `GET /api/bootstrap/status`, `POST /api/bootstrap`.
- **Recording:** `GET /api/staff/state`; event start/reset/complete/reopen; entry time/relay split/undo/mark/clear/status; heat assignment.
- **Admin setup:** event and entry management, relay lineups, roster import/export/template/clear, staff users, settings, finalisation, audit, backup, and reset.

## Local development and deployment

Use Node.js and npm:

```sh
npm install
npm run dev
npm test
npx tsc --noEmit
npm run build
```

The app requires the Lovable Cloud/Supabase environment already used by the target project. Keep `.env`, the service-role key, and `SPORTSDAY_SETUP_KEY` private. Do not copy the source app’s SQLite database into this project.
