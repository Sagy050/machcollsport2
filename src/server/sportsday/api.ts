/**
 * HTTP layer for /api/* (server only): same endpoints and rules as the original Node server.
 *   Public  (no login)  GET  /api/state  /api/results.csv  /api/time
 *   Staff   (recorder)  record finish order, enter distances, finish events
 *   Admin               athletes, events and entries, users, settings, finalise, reset, backup
 * Live updates come from Lovable Cloud realtime (see public/js/live.js), not from this server.
 */
import { HttpError, bad, int, str } from "@/lib/sportsday/util";
import * as store from "./store";
import * as users from "./users";
import { parseRosterFile, sampleWorkbook } from "./roster-file";
import type { SessionUser } from "./users";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Ctx = { request: Request; url: URL; params: Record<string, string>; body: Any; user: SessionUser | null };
type Access = "public" | "staff" | "admin";
type Handler = (c: Ctx) => Promise<Response> | Response;

const NO_STORE = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers } });
const csv = (text: string, filename: string) =>
  new Response("\ufeff" + text, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, ...NO_STORE },
  });

async function sendSnapshot(request: Request, kind: "public" | "staff") {
  const snap = await store.snapshot(kind);
  const h = { "Content-Type": "application/json; charset=utf-8", ETag: snap.etag, "Cache-Control": "no-cache" };
  if (request.headers.get("if-none-match") === snap.etag) return new Response(null, { status: 304, headers: { ETag: snap.etag, "Cache-Control": "no-cache" } });
  return new Response(snap.json, { headers: h });
}

const routes: { method: string; re: RegExp; access: Access; fn: Handler }[] = [];
const route = (method: string, pattern: string, access: Access, fn: Handler) =>
  routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), access, fn });
const id = (p: Record<string, unknown>, name = "id") => {
  const n = Number(p[name]);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, "Not found");
  return n;
};
const clientIp = (r: Request) => r.headers.get("cf-connecting-ip") || (r.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "?";
const MAX_ROSTER_BYTES = 8 * 1024 * 1024;
const MAX_ROSTER_BASE64 = Math.ceil(MAX_ROSTER_BYTES / 3) * 4;
const MAX_MEDIA_BYTES = 512 * 1024;
const MAX_MEDIA_BASE64 = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;

function decodeJpeg(data: unknown) {
  if (typeof data !== "string" || data.length > MAX_MEDIA_BASE64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw bad("Image data is invalid or too large");
  }
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length < 4 || bytes.length > MAX_MEDIA_BYTES || btoa(binary) !== data ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw bad("Upload a valid JPEG image no larger than 512 KB");
  }
  return bytes;
}

route("GET", "/api/state", "public", ({ request }) => sendSnapshot(request, "public"));
route("GET", "/api/ads", "public", async () => json({ ads: await store.listAds(true) }));
route("GET", "/api/results.csv", "public", async () => csv(await store.csvOf("public"), "sports-day-results.csv"));
route("GET", "/api/time", "public", () => json({ now: Date.now() }));
route("GET", "/api/me", "public", ({ user }) =>
  json({ user: user ? { id: user.id, username: user.username, display_name: user.display_name, role: user.role } : null }),
);
route("GET", "/api/bootstrap/status", "public", async () => json(await users.bootstrapStatus()));
route("POST", "/api/bootstrap", "public", async ({ request, body }) => {
  const result = await users.bootstrapAdmin(
    body,
    clientIp(request),
    request.headers.get("user-agent"),
    request.headers.get("sec-ch-ua-model"),
  );
  return json({ user: result.user }, 200, { "Set-Cookie": users.cookieHeader(result.token, Math.floor(users.SESSION_MS / 1000)) });
});

route("POST", "/api/login", "public", async ({ request, body }) => {
  const r = await users.login(
    body,
    clientIp(request),
    request.headers.get("user-agent"),
    request.headers.get("sec-ch-ua-model"),
  );
  return json({ user: r.user }, 200, { "Set-Cookie": users.cookieHeader(r.token, Math.floor(users.SESSION_MS / 1000)) });
});
route("POST", "/api/logout", "public", async ({ user }) => {
  await users.logout(user);
  return json({ ok: true }, 200, { "Set-Cookie": users.cookieHeader("", 0) });
});
route("POST", "/api/me/password", "staff", async ({ user, body }) => {
  await users.changeOwnPassword(user!, body);
  return json({ ok: true, relogin: true });
});

// ---- staff: live data and recording --------------------------------------------------------------
route("GET", "/api/staff/state", "staff", ({ request }) => sendSnapshot(request, "staff"));
route("GET", "/api/athletes", "staff", async () => json({ athletes: await store.listAthletes() }));
route("GET", "/api/export/results.csv", "staff", async () => csv(await store.csvOf("staff"), "sports-day-results-full.csv"));

route("POST", "/api/events/:id/start", "staff", async ({ user, params, body }) => json(await store.startHeat(user, id(params), body.heat || 1, body.at)));
route("POST", "/api/events/:id/reset-clock", "staff", async ({ user, params, body }) =>
  json(await store.resetHeat(user, id(params), body.heat || 1, !!body.force)),
);
route("POST", "/api/events/:id/complete", "staff", async ({ user, params, body }) => json(await store.completeEvent(user, id(params), body.rest)));
route("POST", "/api/events/:id/reopen", "staff", async ({ user, params }) => json({ event: await store.reopenEvent(user, id(params)) }));
route("POST", "/api/events/:id/swap", "staff", async ({ user, body }) => json(await store.swapResults(user, id(body, "a"), id(body, "b"))));
route("POST", "/api/events/:id/entries", "staff", async ({ user, params, body }) => json(await store.addEntries(user, id(params), body), 201));
route("POST", "/api/events/:id/relay-lineup", "admin", async ({ user, params, body }) =>
  json(await store.setRelayLineup(user, id(params), body.house_id, body.athlete_ids)),
);
route("POST", "/api/entries/:id/finish", "staff", async ({ user, params }) =>
  json({ entry: await store.recordFinish(user, id(params)) }),
);
route("POST", "/api/entries/:id/time", "staff", async ({ user, params, body }) => json({ entry: await store.recordTime(user, id(params), body.ms) }));
route("POST", "/api/entries/:id/relay-split", "staff", async ({ user, params, body }) =>
  json(await store.recordRelaySplit(user, id(params), body.leg, body.elapsedMs)),
);
route("POST", "/api/entries/:id/relay-split/undo", "staff", async ({ user, params }) =>
  json(await store.undoRelaySplit(user, id(params))),
);
route("POST", "/api/entries/:id/mark", "staff", async ({ user, params, body }) => json({ entry: await store.recordMark(user, id(params), body.value) }));
route("POST", "/api/entries/:id/clear", "staff", async ({ user, params }) => json({ entry: await store.clearResult(user, id(params)) }));
route("POST", "/api/entries/:id/status", "staff", async ({ user, params, body }) =>
  json({ entry: await store.setEntryStatus(user, id(params), body.status) }),
);
route("PATCH", "/api/entries/:id", "staff", async ({ user, params, body }) => json({ entry: await store.setHeat(user, id(params), body.heat) }));

// ---- admin: set-up before the day ----------------------------------------------------------------
route("GET", "/api/admin/ads", "admin", async () => json({ ads: await store.listAds() }));
route("POST", "/api/admin/ads", "admin", async ({ user, body }) =>
  json({ ad: await store.saveAd(user, null, body, body.image === undefined ? null : decodeJpeg(body.image)) }, 201),
);
route("PATCH", "/api/admin/ads/:id", "admin", async ({ user, params, body }) =>
  json({ ad: await store.saveAd(user, id(params), body, body.image === undefined ? null : decodeJpeg(body.image)) }),
);
route("DELETE", "/api/admin/ads/:id", "admin", async ({ user, params }) => json(await store.deleteAd(user, id(params))));
route("POST", "/api/events", "admin", async ({ user, body }) => json({ event: await store.createEvent(user, body) }, 201));
route("POST", "/api/events/bulk", "admin", async ({ user, body }) => json(await store.bulkEvents(user, body), 201));
route("PATCH", "/api/events/:id", "admin", async ({ user, params, body }) => json({ event: await store.updateEvent(user, id(params), body) }));
route("DELETE", "/api/events/:id", "admin", async ({ user, params }) => json(await store.deleteEvent(user, id(params))));
route("POST", "/api/events/:id/heats", "admin", async ({ user, params, body }) => json(await store.makeHeats(user, id(params), body.size)));
route("DELETE", "/api/entries/:id", "admin", async ({ user, params }) => json(await store.removeEntry(user, id(params))));

route("POST", "/api/athletes", "admin", async ({ user, body }) => json({ athlete: await store.createAthlete(user, body) }, 201));
route("POST", "/api/athletes/import", "admin", async ({ user, body }) => json(await store.importAthletes(user, body.rows)));
route("POST", "/api/athletes/parse-file", "admin", async ({ body }) => {
  const filename = str(body.filename, { field: "Filename", required: true, max: 200 });
  if (typeof body.data !== "string" || body.data.length > MAX_ROSTER_BASE64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data)) {
    throw bad("Roster file data is invalid or too large");
  }
  const binary = atob(body.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_ROSTER_BYTES || btoa(binary) !== body.data) {
    throw bad("Roster file data is invalid or too large");
  }
  return json({ rows: parseRosterFile(filename, bytes) });
});
route("GET", "/api/athletes/template.xlsx", "admin", () => {
  const workbook = sampleWorkbook();
  const body = new ArrayBuffer(workbook.byteLength);
  new Uint8Array(body).set(workbook);
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sportsday-roster-template.xlsx"',
      ...NO_STORE,
    },
  });
});
route("POST", "/api/athletes/clear", "admin", async ({ user }) => json(await store.clearRoster(user)));
route("POST", "/api/athletes/:id/photo", "admin", async ({ user, params, body }) => {
  if (body.consent !== "granted") throw bad("Confirm the athlete has agreed to a public photo before uploading");
  return json({ athlete: await store.setAthletePhoto(user, id(params), decodeJpeg(body.data)) });
});
route("PATCH", "/api/athletes/:id/photo-consent", "admin", async ({ user, params, body }) =>
  json({ athlete: await store.setAthletePhotoConsent(user, id(params), body.status) }),
);
route("DELETE", "/api/athletes/:id/photo", "admin", async ({ user, params }) =>
  json({ athlete: await store.removeAthletePhoto(user, id(params)) }),
);
route("PUT", "/api/athletes/:id/events", "admin", async ({ user, params, body }) =>
  json(await store.updateAthleteEvents(user, id(params), body.event_ids)),
);
route("PATCH", "/api/athletes/:id", "admin", async ({ user, params, body }) => json({ athlete: await store.updateAthlete(user, id(params), body) }));
route("DELETE", "/api/athletes/:id", "admin", async ({ user, params }) => json(await store.deleteAthlete(user, id(params))));
route("GET", "/api/athletes.csv", "admin", async () => csv(await store.athletesCsv(), "athletes.csv"));

route("GET", "/api/users", "admin", async () => json({ users: await users.listUsers() }));
route("POST", "/api/users", "admin", async ({ user, body }) => json({ user: await users.createUser(user, body) }, 201));
route("PATCH", "/api/users/:id", "admin", async ({ user, params, body }) => json({ user: await users.updateUser(user, id(params), body) }));
route("DELETE", "/api/users/:id", "admin", async ({ user, params }) => json(await users.deleteUser(user, id(params))));
route("POST", "/api/users/:id/password", "admin", async ({ user, params, body }) => {
  await users.setPassword(user, id(params), users.checkPassword(body.password));
  return json({ ok: true });
});

route("PATCH", "/api/settings", "admin", async ({ user, body }) => json(await store.updateSettings(user, body)));
route("POST", "/api/day/finalise", "admin", async ({ user, body }) => json({ settings: await store.setFinalised(user, true, !!body.force) }));
route("POST", "/api/day/reopen", "admin", async ({ user }) => json({ settings: await store.setFinalised(user, false) }));
route("GET", "/api/admin/audit", "admin", async ({ url }) => json({ audit: await store.listAudit(url.searchParams.get("limit")) }));
route("POST", "/api/admin/reset", "admin", async ({ user, body }) => {
  if (body.confirm !== "RESET") throw bad("Type RESET to confirm");
  return json(await store.reset(user, body.scope));
});
route("GET", "/api/admin/backup", "admin", async ({ user }) => {
  const data = await store.backupData();
  await store.audit(user, "backup.download", "");
  return new Response(JSON.stringify(data, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sportsday-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json"`,
      ...NO_STORE,
    },
  });
});

const BIG = new Map([
  ["/api/athletes/import", 1024 * 1024],
  ["/api/athletes/parse-file", MAX_ROSTER_BASE64 + 1024],
]);

async function readBody(request: Request, max: number) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "Request too large");
  if (!text) return {};
  if (!/json/i.test(request.headers.get("content-type") || "")) throw new HttpError(415, "Send JSON");
  try {
    const b = JSON.parse(text);
    if (b === null || typeof b !== "object" || Array.isArray(b)) throw 0;
    return b;
  } catch {
    throw bad("Invalid JSON");
  }
}

async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "GET" : request.method;
  let matched: (typeof routes)[number] | null = null;
  let params: Record<string, string> = {};
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method === method) {
      matched = r;
      params = (m.groups || {}) as Record<string, string>;
      break;
    }
  }
  if (!matched) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Method not allowed" : "Not found");

  if (method !== "GET") {
    // CSRF: a custom header can only be sent by our own pages (browsers preflight it cross-site), plus a same-site check.
    if (request.headers.get("x-requested-with") !== "sportsday") throw new HttpError(403, "Missing request header");
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Cross-site request blocked");
  }
  const user = await users.sessionUser(request);
  if (matched.access !== "public") {
    if (!user) throw new HttpError(401, "Please sign in");
    if (matched.access === "admin" && user.role !== "admin") throw new HttpError(403, "Admins only");
  }
  const body = method === "GET" || method === "DELETE" ? {} : await readBody(request,
    url.pathname.endsWith("/photo") || url.pathname === "/api/admin/ads" || /^\/api\/admin\/ads\/\d+$/.test(url.pathname)
      ? MAX_MEDIA_BASE64 + 8192
      : BIG.get(url.pathname) || 256 * 1024,
  );
  return matched.fn({ request, url, params, body, user });
}

export async function handleApi(request: Request): Promise<Response> {
  try {
    const res = await dispatch(request);
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    console.error("api error", e);
    return json({ error: "Something went wrong on the server" }, 500);
  }
}
