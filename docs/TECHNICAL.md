# Technical documentation

## Architecture

The Lovable application keeps the existing TanStack Start/Nitro server and Lovable Cloud/Supabase database. The public, staff, and report screens are static HTML/CSS/JavaScript served by `src/server/sportsday/pages.ts`; server-side API handlers and data access are in `src/server/sportsday/`. Supabase Postgres stores the meet data, Supabase Auth validates staff passwords, and Supabase Realtime signals page refreshes through `live_version`.

The separate `sportsday-v2` app uses Express and SQLite. Its database and deployment configuration are not part of this app. The staff UI and supported meet operations have been ported while keeping Lovable hosting, authentication, and realtime.

## Data and meet operations

- **Athletes:** name, house, age group, gender, and a unique bib.
- **Events and entries:** track and relay entries are recorded in finish order; field events are measured by distance. Relay events create one team entry per house.
- **Results:** track places come from finish order and field places from distance. Track times and relay splits are not recorded or displayed; staff combine heats by adjusting the event-wide finish order. Relay points go to the house, not an individual.
- **Roster intake:** administrators can import CSV/TXT/XLS/XLSX rosters, download a sample workbook, and clear the roster after results are cleared. Clearing the roster saves a database backup.
- **Athlete photos:** admins can record consent and upload a compressed JPEG only when permission is granted. Photos are kept in private storage and signed into public results only for consenting athletes.
- **Marketplace ads:** `/ads` lists active club ads; only admins can create, edit, publish, hide, or delete ads through the staff setup area.
- **Live recording:** recorder actions require a staff session. Staff state and public results are read through the server API; database changes update `live_version`, which the browser listens to through Supabase Realtime.
- **Machcoll:** the public landing page sends questions to `POST /api/chat`. The server reads current standings, schedule, scoring, and house-level event results; student names are used only for server-side redaction and are not included in the model prompt. Track performances, private records, and write operations are not available to the assistant. Each browser/device can submit one question per UTC calendar day, with a browser-derived persistent device ID plus server-side enforcement; chat is not an official complaint submission channel.

The database schema and incremental changes live in `drizzle/migrations/`. Migration `0003_relay_and_admin_setup.sql` adds relay lineup/split storage, heat-end data, and the one-time administrator setup claim. Migration `0009_ads_and_athlete_photos.sql` adds the Ads table, athlete consent/photo metadata, and private image buckets; apply it before deploying these features.
Migration `0010_machcoll_daily_usage.sql` adds persistent per-device daily Machcoll usage records. The API falls back to its in-memory limiter until this migration is applied.

## Roles

| Capability                                                    | Public | Recorder | Admin |
| ------------------------------------------------------------- | -----: | -------: | ----: |
| View scoreboard, events, and report                           |    yes |      yes |   yes |
| Start clocks and record results                               |     no |      yes |   yes |
| Manage athletes, events, house-based relay teams, and heats   |     no |       no |   yes |
| Manage ads and athlete photo consent                          |     no |       no |   yes |
| Manage staff accounts, scoring, settings, backups, and resets |     no |       no |   yes |

Roles are checked in the API, not only hidden in the interface.

## First administrator

The first administrator is created through `/api/bootstrap` only when there is no active admin and a server-side `SPORTSDAY_SETUP_KEY` of at least 32 characters is configured. The setup code is compared in constant time, failed attempts are rate-limited, and a database claim prevents concurrent initial-admin creation. The route creates a Supabase Auth account and staff profile, then signs in the new admin. It never allows public admin creation after an active admin exists.

Do not expose the setup key through a `VITE_` variable. Remove it from deployment secrets after setup; to intentionally reopen first-admin setup, configure a new key only after no active admin remains.

## Security and persistence

- Supabase Auth stores and validates passwords; the app stores hashed, short-lived staff session tokens in `staff_sessions`.
- Server routes use the Supabase service-role client. It must remain server-only and must never be included in browser bundles.
- Write routes require the app’s custom request header and reject cross-site requests.
- API inputs have size and field limits; roster uploads are capped at 8 MB.
- The public Machcoll endpoint applies a best-effort in-memory limit of one question per browser/device per UTC calendar day, with IP fallback for devices that omit a valid device ID. The browser stores a persistent device ID and the UI disables further questions locally after use. Keep `LOVABLE_API_KEY` server-side; Lovable manages the project AI connector and key.
- Relay results are recorded against house-team entries; current recording does not require runner lineups or relay splits.
- Roster clearing and full resets create a backup record first. User actions are written to the audit table.
- Login activity displays a browser-derived device label instead of the IP; old entries without device metadata show that the device was not recorded. Failed-login IPs remain in audit details for rate limiting but are hidden in the activity display.

## API overview

- **Public:** `GET /api/state`, `/api/results.csv`, `/api/time`; `GET /api/chat/status` and `POST /api/chat` for one-question-per-device Machcoll answers.
- **Marketplace:** `GET /api/ads` returns active ads only.
- **Sign-in and first setup:** `GET /api/me`, `POST /api/login`, `/api/logout`, `/api/me/password`, `GET /api/bootstrap/status`, `POST /api/bootstrap`.
- **Recording:** `GET /api/staff/state`; event start/reset/complete/reopen; entry time/relay split/undo/mark/clear/status; heat assignment.
- **Admin setup:** event and entry management, house-based relay teams, athlete event assignments and photo consent, roster import/export/template/clear, ad management, staff users, settings, finalisation, audit, backup, and reset.

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
