/**
 * Staff accounts and sessions (server only).
 * Passwords are held by Lovable Cloud auth; this app keeps its own short session cookie,
 * so disabling a user or changing a password signs them out at once.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError, bad, str, oneOf } from "@/lib/sportsday/util";
import { audit, dbError, type Actor } from "./store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const db = () => supabaseAdmin as unknown as SupabaseClient;
const now = () => Date.now();
export const SESSION_MS = 24 * 3600e3;
export const COOKIE = "sd_session";
const STAFF_ROLES = ["admin", "recorder"] as const;
type Role = (typeof STAFF_ROLES)[number];
type ProfileRow = { id: string; staff_no: number; username: string | null; display_name: string | null; email: string | null; google_email: string | null; active: boolean; last_login: number | null };

async function q<T = Any>(p: PromiseLike<{ data: Any; error: Any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw dbError(error);
  return data as T;
}
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function googleEmail(value: unknown, required = false): string | null {
  const email = str(value, { field: "Google email", max: 254 }).toLowerCase();
  if (!email) {
    if (required) throw bad("Google email is required");
    return null;
  }
  if (!EMAIL_PATTERN.test(email)) throw bad("Enter a valid Google email address");
  return email;
}

export function checkPassword(pw: unknown, field = "Password"): string {
  if (typeof pw !== "string" || pw.length < 8) throw bad(`${field} must be at least 8 characters`);
  if (pw.length > 200) throw bad(`${field} is too long`);
  return pw;
}

// ---- crypto helpers (Web Crypto works everywhere the server runs) ---------------------------------
function b64url(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

// ---- roles ---------------------------------------------------------------------------------------
async function roleMap(uids: string[]): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  if (!uids.length) return out;
  const rows = await q<{ user_id: string; role: string }[]>(db().from("user_roles").select("user_id,role").in("user_id", uids));
  for (const r of rows) {
    if (r.role === "admin") out.set(r.user_id, "admin");
    else if (r.role === "recorder" && !out.has(r.user_id)) out.set(r.user_id, "recorder");
  }
  return out;
}
async function setRole(uid: string, role: Role) {
  await q(db().from("user_roles").delete().eq("user_id", uid));
  await q(db().from("user_roles").insert({ user_id: uid, role }));
}

// ---- password check through Lovable Cloud auth ---------------------------------------------------
async function passwordOk(email: string, password: string): Promise<boolean> {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  // We only needed the check: drop that auth session straight away.
  try {
    await supabaseAdmin.auth.admin.signOut(data.session.access_token, "local");
  } catch {
    /* best effort */
  }
  return true;
}

// ---- sessions ------------------------------------------------------------------------------------
export function readCookie(request: Request): string | null {
  const m = /(?:^|;\s*)sd_session=([A-Za-z0-9_-]{20,80})/.exec(request.headers.get("cookie") || "");
  return m?.[1] ?? null;
}
export function cookieHeader(token: string, maxAge: number) {
  // SameSite=None + Partitioned keeps sign-in working when the app is shown inside another site's frame (the editor preview).
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${maxAge}`;
}

export type SessionUser = NonNullable<Actor> & { token: string };

export async function sessionUser(request: Request): Promise<SessionUser | null> {
  const token = readCookie(request);
  if (!token) return null;
  const h = await sha256(token);
  const row = await q<Any>(
    db()
      .from("staff_sessions")
      .select("expires_at, profiles!inner(id, staff_no, username, display_name, active)")
      .eq("token_hash", h)
      .gt("expires_at", now())
      .maybeSingle(),
  );
  if (!row || !row.profiles || !row.profiles.active || !row.profiles.username) return null;
  const p = row.profiles as ProfileRow;
  const role = (await roleMap([p.id])).get(p.id);
  if (!role) return null;
  if (row.expires_at - now() < SESSION_MS / 2) await q(db().from("staff_sessions").update({ expires_at: now() + SESSION_MS }).eq("token_hash", h));
  return { id: p.staff_no, uid: p.id, username: p.username!, display_name: p.display_name || p.username!, role, token: h };
}

const killSessions = (uid: string) => q(db().from("staff_sessions").delete().eq("profile_id", uid));

export async function login(body: Any, ip: string) {
  const username = str(body.username, { field: "Username", max: 120 });
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const u = username.toLowerCase();
  // Brute-force protection: 8 bad tries per user+address and 40 per address in 10 minutes.
  const since = now() - 10 * 60e3;
  const ipLike = `%"ip":"${likeEscape(ip)}"%`;
  const [{ count: perUser }, { count: perIp }] = await Promise.all([
    db().from("audit").select("id", { count: "exact", head: true }).eq("action", "login.fail").gt("ts", since).eq("username", u).like("detail", ipLike),
    db().from("audit").select("id", { count: "exact", head: true }).eq("action", "login.fail").gt("ts", since).like("detail", ipLike),
  ]);
  if ((perUser || 0) >= 8 || (perIp || 0) >= 40) throw new HttpError(429, "Too many failed sign-ins. Wait a few minutes and try again.");

  const col = u.includes("@") ? "email" : "username";
  const rows = await q<ProfileRow[]>(db().from("profiles").select("*").ilike(col, likeEscape(username)).not("username", "is", null).limit(1));
  const p = rows[0];
  const role = p ? (await roleMap([p.id])).get(p.id) : undefined;
  const ok = !!(p && p.email && p.active && role && (await passwordOk(p.email, password)));
  if (!ok || !p || !role) {
    await audit(null, "login.fail", { username, ip }, u);
    throw new HttpError(401, "Wrong username or password");
  }
  const token = randomToken();
  await q(db().from("staff_sessions").insert({ token_hash: await sha256(token), profile_id: p.id, created_at: now(), expires_at: now() + SESSION_MS }));
  await q(db().from("profiles").update({ last_login: now() }).eq("id", p.id));
  const actor = { id: p.staff_no, uid: p.id, username: p.username!, display_name: p.display_name || p.username!, role };
  await audit(actor, "login", { ip });
  return { token, user: { id: actor.id, username: actor.username, display_name: actor.display_name, role } };
}

export async function loginWithGoogle(accessToken: unknown, ip: string) {
  const token = str(accessToken, { field: "Google sign-in token", required: true, max: 8192 });
  const since = now() - 10 * 60e3;
  const ipLike = `%"ip":"${likeEscape(ip)}"%`;
  const { count, error: rateError } = await db()
    .from("audit")
    .select("id", { count: "exact", head: true })
    .eq("action", "login.google.fail")
    .gt("ts", since)
    .like("detail", ipLike);
  if (rateError) throw dbError(rateError);
  if ((count || 0) >= 40) throw new HttpError(429, "Too many failed sign-ins. Wait a few minutes and try again.");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) {
    if (error.status && error.status >= 500) throw new HttpError(503, "Google sign-in is temporarily unavailable");
    await audit(null, "login.google.fail", { ip });
    throw new HttpError(401, "Google sign-in could not be verified");
  }
  const authUser = data.user;
  const identity = authUser?.identities?.find((item) => item.provider === "google");
  const verified = !!authUser?.email_confirmed_at;
  const email = verified ? googleEmail(authUser?.email) : null;
  const rows = email
    ? await q<ProfileRow[]>(db().from("profiles").select("*").eq("google_email", email).eq("active", true).not("username", "is", null).limit(1))
    : [];
  const profile = rows[0];
  const role = profile ? (await roleMap([profile.id])).get(profile.id) : undefined;
  if (!profile || !role || !identity || !email) {
    await audit(null, "login.google.fail", { ip }, email || "google");
    throw new HttpError(401, "This Google account is not authorized for staff access");
  }

  const sessionToken = randomToken();
  await q(db().from("staff_sessions").insert({
    token_hash: await sha256(sessionToken),
    profile_id: profile.id,
    created_at: now(),
    expires_at: now() + SESSION_MS,
  }));
  await q(db().from("profiles").update({ last_login: now() }).eq("id", profile.id));
  const actor = {
    id: profile.staff_no,
    uid: profile.id,
    username: profile.username!,
    display_name: profile.display_name || profile.username!,
    role,
  };
  await audit(actor, "login.google", { ip });
  return { token: sessionToken, user: { id: actor.id, username: actor.username, display_name: actor.display_name, role } };
}

export async function logout(user: SessionUser | null) {
  if (user) await q(db().from("staff_sessions").delete().eq("token_hash", user.token));
}

export async function changeOwnPassword(user: SessionUser, body: Any) {
  const rows = await q<ProfileRow[]>(db().from("profiles").select("*").eq("id", user.uid).limit(1));
  if (!rows[0]?.email || !(await passwordOk(rows[0].email, String(body.current || "")))) throw new HttpError(403, "Current password is wrong");
  await setPassword(user, user.id, checkPassword(body.password, "New password"));
}

function bootstrapSecret() {
  const secret = process.env["SPORTSDAY_SETUP_KEY"] || "";
  return secret.length >= 32 ? secret : null;
}

async function constantTimeEqual(a: string, b: string) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function bootstrapStatus() {
  const required = (await activeAdmins()) === 0;
  return { required, configured: bootstrapSecret() !== null, open: required && bootstrapSecret() !== null };
}

async function claimInitialAdmin() {
  const claimToken = randomToken();
  const table = () => db().from("sportsday_admin_bootstrap");
  const first = await table().insert({ id: 1, claim_token: claimToken, claimed_at: now() });
  if (!first.error) return claimToken;
  if (first.error.code !== "23505") throw dbError(first.error);

  const current = await q<{ claim_token: string; claimed_at: number } | null>(
    table().select("claim_token,claimed_at").eq("id", 1).maybeSingle(),
  );
  if (!current || now() - current.claimed_at < 15 * 60e3) {
    throw new HttpError(409, "First-admin setup is already in progress or has already completed");
  }
  const removed = await table().delete().eq("id", 1).eq("claim_token", current.claim_token).select("id");
  if (removed.error) throw dbError(removed.error);
  if (!removed.data?.length) throw new HttpError(409, "First-admin setup is already in progress");
  const next = await table().insert({ id: 1, claim_token: claimToken, claimed_at: now() });
  if (next.error) {
    if (next.error.code === "23505") throw new HttpError(409, "First-admin setup is already in progress");
    throw dbError(next.error);
  }
  return claimToken;
}

export async function bootstrapAdmin(body: Any, ip: string) {
  const secret = bootstrapSecret();
  if (!secret) throw new HttpError(503, "First-admin setup is not configured. Set SPORTSDAY_SETUP_KEY to a secret of at least 32 characters.");
  const since = now() - 15 * 60e3;
  const ipLike = `%"ip":"${likeEscape(ip)}"%`;
  const { count, error } = await db()
    .from("audit")
    .select("id", { count: "exact", head: true })
    .eq("action", "bootstrap.fail")
    .gt("ts", since)
    .like("detail", ipLike);
  if (error) throw dbError(error);
  if ((count || 0) >= 10) throw new HttpError(429, "Too many setup attempts. Wait a few minutes and try again.");

  const provided = str(body.setup_key, { field: "Setup code", required: true, max: 256 });
  if (!(await constantTimeEqual(provided, secret))) {
    const saved = await db().from("audit").insert({
      ts: now(),
      user_id: null,
      username: "bootstrap",
      action: "bootstrap.fail",
      detail: JSON.stringify({ ip }),
    });
    if (saved.error) throw dbError(saved.error);
    throw new HttpError(403, "The setup code is incorrect");
  }
  if ((await activeAdmins()) > 0) throw new HttpError(409, "An active admin account already exists");

  const claimToken = await claimInitialAdmin();
  try {
    if ((await activeAdmins()) > 0) throw new HttpError(409, "An active admin account already exists");
    const user = {
      username: body.username,
      display_name: body.display_name,
      password: checkPassword(body.password),
      role: "admin",
      google_email: googleEmail(body.google_email, true),
    };
    await createUser(null, user);
    return await login(user, ip);
  } catch (error) {
    const released = await db().from("sportsday_admin_bootstrap").delete().eq("id", 1).eq("claim_token", claimToken);
    if (released.error) console.error("Could not release first-admin setup claim", released.error);
    throw error;
  }
}

// ---- user admin ----------------------------------------------------------------------------------
const publicUser = (p: ProfileRow, role: Role) => ({
  id: p.staff_no,
  username: p.username,
  display_name: p.display_name || p.username,
  google_email: p.google_email,
  role,
  active: !!p.active,
  last_login: p.last_login,
});

export async function listUsers() {
  const rows = await q<ProfileRow[]>(db().from("profiles").select("*").not("username", "is", null));
  const roles = await roleMap(rows.map((r) => r.id));
  return rows
    .filter((r) => roles.has(r.id))
    .map((r) => publicUser(r, roles.get(r.id)!))
    .sort((a, b) => a.role.localeCompare(b.role) || String(a.username).localeCompare(String(b.username)));
}
async function byStaffNo(id: number) {
  const rows = await q<ProfileRow[]>(db().from("profiles").select("*").eq("staff_no", id).limit(1));
  const p = rows[0];
  const role = p ? (await roleMap([p.id])).get(p.id) : undefined;
  if (!p || !role || !p.username) throw new HttpError(404, "User not found");
  return { p, role };
}
async function activeAdmins() {
  return (await listUsers()).filter((u) => u.role === "admin" && u.active).length;
}

function cleanUser(b: Any, cur: { p: ProfileRow; role: Role } | null) {
  const out = {
    username: b.username !== undefined || !cur ? str(b.username, { field: "Username", required: true, min: 3, max: 32 }) : cur.p.username!,
    display_name: b.display_name !== undefined || !cur ? str(b.display_name, { field: "Name", required: true, max: 60 }) : cur.p.display_name || "",
    google_email: b.google_email !== undefined || !cur ? googleEmail(b.google_email) : cur.p.google_email,
    role: (b.role !== undefined || !cur ? oneOf(b.role, STAFF_ROLES, "Role") : cur.role) as Role,
    active: b.active !== undefined ? !!b.active : cur ? cur.p.active : true,
  };
  if (!/^[A-Za-z0-9._-]+$/.test(out.username)) throw bad("Username may only use letters, numbers, dot, dash and underscore");
  return out;
}
async function usernameTaken(username: string, exceptUid?: string) {
  const rows = await q<{ id: string }[]>(db().from("profiles").select("id").ilike("username", likeEscape(username)));
  return rows.some((r) => r.id !== exceptUid);
}
async function googleEmailTaken(email: string, exceptUid?: string) {
  const rows = await q<{ id: string }[]>(db().from("profiles").select("id").eq("google_email", email));
  return rows.some((r) => r.id !== exceptUid);
}

export async function createUser(actor: Actor, b: Any) {
  const pw = checkPassword(b.password);
  const f = cleanUser(b, null);
  if (await usernameTaken(f.username)) throw new HttpError(409, "That username is taken");
  if (f.google_email && (await googleEmailTaken(f.google_email))) throw new HttpError(409, "That Google email is already assigned");
  // Staff sign in with a username; the auth service needs an address, so each account gets a private placeholder one.
  const email = `${f.username.toLowerCase()}.${Date.now().toString(36)}@staff.machabeng-sportsday.app`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { display_name: f.display_name } });
  if (error || !data.user) throw new HttpError(400, /password/i.test(error?.message || "") ? `Password not accepted: ${error!.message}` : "Could not create that account");
  const uid = data.user.id;
  try {
    await q(db().from("profiles").upsert({ id: uid, username: f.username, display_name: f.display_name, email, google_email: f.google_email, active: true }));
    await setRole(uid, f.role);
    await audit(actor, "user.create", { username: f.username, role: f.role });
  } catch (error) {
    const cleanup = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (cleanup.error) console.error("Could not roll back staff account creation", cleanup.error);
    throw error;
  }
  const created = (await q<ProfileRow[]>(db().from("profiles").select("*").eq("id", uid)))[0];
  if (!created) throw new Error("Account was not saved");
  const { p, role } = await byStaffNo(created.staff_no);
  return publicUser(p, role);
}

export async function updateUser(actor: Actor, id: number, b: Any) {
  const cur = await byStaffNo(id);
  const f = cleanUser(b, cur);
  if (await usernameTaken(f.username, cur.p.id)) throw new HttpError(409, "That username is taken");
  if (f.google_email && (await googleEmailTaken(f.google_email, cur.p.id))) throw new HttpError(409, "That Google email is already assigned");
  const losesAdmin = cur.role === "admin" && cur.p.active && (f.role !== "admin" || !f.active);
  if (losesAdmin && (await activeAdmins()) <= 1) throw new HttpError(409, "There must be at least one active admin");
  await q(db().from("profiles").update({ username: f.username, display_name: f.display_name, google_email: f.google_email, active: f.active }).eq("id", cur.p.id));
  if (f.role !== cur.role) await setRole(cur.p.id, f.role);
  if (!f.active || f.role !== cur.role) await killSessions(cur.p.id);
  await audit(actor, "user.update", { id, ...f });
  const next = await byStaffNo(id);
  return publicUser(next.p, next.role);
}

export async function deleteUser(actor: Actor, id: number) {
  const cur = await byStaffNo(id);
  if (actor && cur.p.staff_no === actor.id) throw new HttpError(409, "You cannot delete your own account");
  if (cur.role === "admin" && cur.p.active && (await activeAdmins()) <= 1) throw new HttpError(409, "There must be at least one active admin");
  const { error } = await supabaseAdmin.auth.admin.deleteUser(cur.p.id);
  if (error) throw new Error(error.message);
  await q(db().from("profiles").delete().eq("id", cur.p.id));
  await audit(actor, "user.delete", { username: cur.p.username });
  return { deleted: id };
}

export async function setPassword(actor: Actor, id: number, pw: string) {
  const cur = await byStaffNo(id);
  const { error } = await supabaseAdmin.auth.admin.updateUserById(cur.p.id, { password: pw });
  if (error) throw new HttpError(400, `Password not accepted: ${error.message}`);
  await killSessions(cur.p.id);
  await audit(actor, "user.password", { id });
}
