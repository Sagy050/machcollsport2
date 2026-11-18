# Technical documentation

## 1. What it is

A web application with three parts served by one small Node.js program:

| Part | URL | Who | What it does |
|---|---|---|---|
| Public page | `/` | Everyone | Animated 3D stadium, live standings, events, awards. Read-only. |
| Staff app | `/staff` | Recorders and admins | Tap to record results; admins set up athletes, events and users. |
| Report | `/report` | Everyone | Final ranking and awards, print or CSV. |

## 2. Architecture

```
 browsers (phones, laptops, the big screen)
      |  HTTPS: JSON API + one live stream (Server-Sent Events)
      v
 Node.js server (src/app.js)  -- no frameworks, no packages
      |  security headers, sessions, CSRF check, rate limits
      v
 store (src/store.js)  -- every write is one SQLite transaction
      v
 SQLite file (data/sportsday.db), WAL mode, synchronous=FULL
```

**Live updates.** Every committed write bumps a version number and pushes it to every open page over Server-Sent Events. Pages then fetch `/api/state` (cached per version, ETag, gzip). A tap reaches spectators in well under a second (see TESTING.md).

**Why Node + SQLite (technical choices).** One process, one file: nothing to configure, easy to back up (`VACUUM INTO`), and writes are serialised, so two recorders cannot corrupt each other's data. SQLite is far faster than a school Sports Day needs (hundreds of writes per second in the load test). Server-Sent Events are simpler and more robust than WebSockets for one-way "something changed" messages. The front end is plain JavaScript with no build step, so the code can be read and changed by students. Trade-off: the host needs a persistent disk (Render, Railway, Fly.io, a VPS) rather than a serverless platform.

## 3. How recording works (the design that avoids typing)

Athletes and their event **entries** exist *before* the day. Recording only fills in a result on a row that is already there.

- **Athletes:** name, house, age group (Junior, Intermediate, Senior), gender, and a unique **bib** (for example `E07` = Eagles #7, made automatically).
- **Events:** name, age group (or Mixed), optional gender, kind (individual or relay), measure (**time** or **distance**), start time, status (scheduled, live, completed, final).
- **Entries:** one per athlete per event, with a heat number. Relays have one entry per house.
- **Timed events:** pressing **Start clock** stores the start moment on the server for that heat (so refreshing or switching phones does not lose it). Each tap sends the elapsed milliseconds `now - start`. The phone corrects for its own clock being wrong by measuring its offset from the server.
- **Distance events:** the recorder types a distance on the keypad; the server stores it to the centimetre.
- **Positions are never typed.** After every write the server ranks the whole event: lower time or longer distance wins; equal results share a place and the next place is skipped (1, 2, 2, 4). Times rank by the exact millisecond even though they display to the hundredth, so tap order is always respected. Heats are ranked together.
- **Statuses:** DNS, DNF and DQ remove a result and score 0. Finishing an event can mark everyone left blank as DNS.
- **Fixing mistakes:** Undo (clears the last tap), swap two places (they trade results), clear, enter by hand.

## 4. Points system

Points come from the **position**, using one scale for every event (individual or relay):

| Position | 1st | 2nd | 3rd | 4th | 5th and below |
|---|---|---|---|---|---|
| Points | 10 | 7 | 5 | 3 | 1 |

DNS, DNF and DQ score 0. Ties share the points of the place they share. Relay points go to the house only and do not count for any individual. The scale can be changed in Setup, Day; changing it re-scores the whole day instantly because points are calculated when shown, never stored.

- **House ranking:** total points, then golds, then silvers, then bronzes.
- **Best performer per house / top athletes:** individual points, then golds, silvers, bronzes.
- **Age-group champions:** best athlete in each age group and gender.

## 5. Roles

| | Public | Recorder | Admin |
|---|---|---|---|
| View live results | yes | yes | yes |
| Start clocks, tap or enter results, finish events | | yes | yes |
| Edit events after the day is finalised | | no | yes |
| Athletes, events, entries, heats, users, settings, reset, backup | | | yes |

## 6. Security and data integrity

- **Passwords:** scrypt with a random salt, never stored in plain text. At least 8 characters. The first admin password is random (or `ADMIN_PASSWORD`) and shown once.
- **Sessions:** random token in an `HttpOnly`, `SameSite=Lax` cookie (also `Secure` over HTTPS); only a hash is stored in the database; 24 hours; disabling a user or changing a password signs them out at once.
- **Brute force:** repeated wrong passwords lock that account and address out for a short time.
- **CSRF and cross-origin:** every write needs a custom header and a matching `Origin`.
- **Injection and XSS:** all database access uses prepared statements; every screen escapes user text; a strict Content-Security-Policy, `nosniff`, no framing.
- **Input limits:** request size cap, field length limits, enum checks on every field.
- **CSV safety:** names beginning with `=`, `+`, `-` or `@` are defused so a spreadsheet cannot run them.
- **Roles are checked on the server** for every route, not just hidden in the screen.
- **No lost results:** SQLite WAL with `synchronous=FULL` (a committed result survives a power cut). A phone with no signal keeps its taps and sends them in order when the connection returns. Reset always saves a backup first. An audit log records who did what and when.
- **No conflicts:** each tap changes one row, and recorders normally work on different events. If two people save the same athlete, the later save wins, the ranking stays valid, and both are in the audit log.

## 7. API (summary)

- **Public:** `GET /api/state`, `/api/stream` (live), `/api/results.csv`, `/api/time`, `/healthz`.
- **Sign-in:** `POST /api/login`, `/api/logout`, `GET /api/me`, `POST /api/me/password`.
- **Recording (recorder or admin):** `GET /api/staff/state`; `POST /api/events/:id/start`, `/reset-clock`, `/complete`, `/reopen`, `/swap`, `/entries`; `POST /api/entries/:id/time`, `/mark`, `/clear`, `/status`; `PATCH /api/entries/:id` (heat).
- **Set-up (admin):** `POST /api/events`, `/api/events/bulk`; `PATCH`/`DELETE /api/events/:id`; `POST /api/events/:id/heats`; `DELETE /api/entries/:id`; athletes (`/api/athletes`, `/api/athletes/import`, `/api/athletes.csv`); users; `PATCH /api/settings`; `POST /api/day/finalise`, `/api/day/reopen`; `POST /api/admin/reset`; `GET /api/admin/backup`, `/api/admin/audit`.

## 8. Deploying

Set `PORT`, `DATA_DIR` (on a persistent disk), `TRUST_PROXY=1` behind a proxy, and optionally `ADMIN_PASSWORD`. Health check: `/healthz`. Back up by downloading from Setup, Day, or copying `DATA_DIR`.
