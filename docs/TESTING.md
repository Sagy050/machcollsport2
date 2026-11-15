# Testing

Run everything with `npm test` (36 tests, about 6 seconds), `npm run e2e` (real browser) and `npm run loadtest`.

## Automated tests (`test/`)

| Area | What is checked |
|---|---|
| Access and security | Anonymous users cannot write or read staff data; recorders cannot do admin work; CSRF header and cross-origin writes blocked; bad JSON and oversized bodies; passwords hashed; brute-force lockout; HttpOnly cookies; static server path traversal; security headers |
| Set-up | Pasted athlete list imports with automatic bibs (house letters, girl/boy words, duplicates, bad rows reported); add, rename, delete athletes; quick events (names x age groups x genders), entries filled for the right athletes, repeats skipped, relays one entry per house; add or remove entries; heats mix the houses |
| Recording | Start clock, tap order gives places, points and house totals; exact-millisecond ranking; swap, clear, DNS, DNF, DQ; finishing marks the rest DNS; distance events with decimal commas and ties; heats with separate clocks and ranking across heats; start time lag tolerance; relays; awards |
| Rules | Recorders vs admins; finalised events locked for recorders only; finalise and reopen the day; public view hides staff fields; names shortened for the public only; points scale change re-scores the day |
| Multi-user | **Three recorders tap 150 results at once in three events: nothing lost, places valid.** Two recorders tap the same athlete at once: one result, ranking valid |
| Reliability | Live stream delivers a tap to spectators within a second; ETag and gzip; **data survives a server restart (including a running clock)**; reset keeps a backup; last admin cannot be removed; disabled users signed out; audit log |
| Exports | CSV formula injection defused; bibs included |
| Scoring unit tests | Points scale, validation, time formatting, ranking with ties, name display |

## Browser test (`npm run e2e`)

Drives the **real staff screens in a phone-sized browser**: sign in, paste 24 athletes, create events, open a race, check tapping before the clock starts is refused, start the clock, tap three athletes, swap two, undo, mark a DNS, finish; enter a long jump on the keypad; then check a **second browser on the public page updates by itself**, add a recorder account, sign in as that recorder (no Setup tab), and open the heat and add-athletes screens. Any browser console error fails the run.

## Load test (`npm run loadtest`)

6 recorders tapping 400 results while 300 spectators watch the live stream. Result on the development machine: all 400 stored, positions valid, about 350 taps per second, tap latency p95 under 50 ms, spectators told within about 200 ms. (Your numbers will vary; the pass/fail checks are what matter.)

## Manual test checklist for the day before

- [ ] Sign in as admin and as a recorder on real phones, on the school or stadium network and on mobile data.
- [ ] Run a pretend 100m with 8 friends: start, tap, undo, swap, finish. Check the public page on a second phone.
- [ ] Switch a phone to aeroplane mode, tap two results, switch back: the banner clears and results appear.
- [ ] Start the same event on two phones at once: only one clock runs.
- [ ] Print `/report` to PDF. Download a backup. Then clear the practice results.
