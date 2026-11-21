/**
 * Data layer (server only). Port of the original SQLite store onto Lovable Cloud.
 * Every write is a small, single-purpose change; a database trigger bumps `live_version`
 * after each one, which is what open pages listen to and what the state cache keys on.
 * Positions are never stored: they are worked out from finish order or field measurements.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError, bad, str, int, oneOf, csvRow } from "@/lib/sportsday/util";
import * as S from "@/lib/sportsday/scoring";
import {
  computeState,
  resultsCsv,
  type AthleteRow,
  type EntryRow,
  type EventRow,
  type HouseRow,
  type Settings,
} from "@/lib/sportsday/report";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export type Actor = {
  id: number;
  uid: string;
  username: string;
  display_name: string;
  role: "admin" | "recorder";
  device_id?: string;
  device_label?: string;
  ip?: string;
} | null;
type Body = Any;

const db = () => supabaseAdmin as unknown as SupabaseClient;
const now = () => Date.now();

export const LEVELS = [
  "Lower Junior",
  "Junior",
  "Intermediate",
  "Senior",
  "Open",
  "Mixed",
] as const;
const ATHLETE_LEVELS = ["Lower Junior", "Junior", "Intermediate", "Senior", "Open"] as const;
const GENDERS = ["F", "M"] as const;
const KINDS = ["individual", "relay"] as const;
const MEASURES = ["time", "distance"] as const;
const relayLegCount = (value: unknown) => {
  const count = int(value, { field: "Relay legs", min: 4, max: 8 });
  if (count !== 4 && count !== 8) throw bad("Relay legs must be 4 or 8");
  return count;
};
const DEFAULT_SETTINGS: Settings = {
  title: "Inter-House Sports Day 2026",
  date: "2026-11-20",
  start: "08:00",
  venue: "Setsoto Stadium, Maseru",
  scheme: S.DEFAULT_SCHEME,
  nameDisplay: "full",
  finalised: false,
  finalisedAt: null,
};

/** Unwrap a query result; map database conflicts to friendly 409s. */
async function q<T = Any>(
  p: PromiseLike<{ data: Any; error: Any; count?: number | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw dbError(error);
  return data as T;
}
async function countOf(p: PromiseLike<{ count: number | null; error: Any }>): Promise<number> {
  const { count, error } = await p;
  if (error) throw dbError(error);
  return count || 0;
}
export function dbError(error: Any): Error {
  const code = String(error?.code || "");
  if (code === "P0001")
    return new HttpError(409, error?.message || "That change conflicts with existing data");
  if (code === "23505" || code === "23503" || code === "23514")
    return new HttpError(409, "That change conflicts with existing data");
  return new Error(error?.message || "Database error");
}
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export async function audit(
  actor: Actor,
  action: string,
  detail: unknown,
  usernameOverride?: string,
) {
  let auditDetail: Record<string, unknown> = {};
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    auditDetail = detail as Record<string, unknown>;
  } else if (typeof detail === "string" && detail) {
    auditDetail = { value: detail };
  }
  if (actor?.device_id) auditDetail.device_id = actor.device_id;
  if (actor?.device_label) auditDetail.device = actor.device_label;
  if (actor?.ip) auditDetail.ip = actor.ip;
  await db()
    .from("audit")
    .insert({
      ts: now(),
      user_id: actor ? actor.id : null,
      username: usernameOverride ?? (actor ? actor.username : null),
      action,
      detail: JSON.stringify(auditDetail),
    });
}

export async function machcollUsageStatus(
  deviceKey: string,
  usageDay: string,
): Promise<boolean | null> {
  const { data, error } = await db()
    .from("machcoll_daily_usage")
    .select("device_key")
    .eq("device_key", deviceKey)
    .eq("usage_day", usageDay)
    .maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return null;
    throw dbError(error);
  }
  return !!data;
}

export async function consumeMachcollUsage(
  deviceKey: string,
  usageDay: string,
): Promise<boolean | null> {
  const { error } = await db()
    .from("machcoll_daily_usage")
    .insert({ device_key: deviceKey, usage_day: usageDay });
  if (!error) return true;
  if (error.code === "23505") return false;
  if (error.code === "PGRST205" || error.code === "42P01") return null;
  throw dbError(error);
}

// ---- version + settings + houses -----------------------------------------------------------------
export async function version(): Promise<number> {
  const row = await q<{ v: number } | null>(
    db().from("live_version").select("v").eq("id", 1).maybeSingle(),
  );
  return row ? Number(row.v) : 0;
}
export async function getSettings(): Promise<Settings> {
  const row = await q<{ value: Partial<Settings> } | null>(
    db().from("app_settings").select("value").eq("key", "settings").maybeSingle(),
  );
  return { ...DEFAULT_SETTINGS, ...(row ? row.value : {}) };
}
const saveSettings = (s: Settings) =>
  q(db().from("app_settings").upsert({ key: "settings", value: s }));
export const listHouses = () =>
  q<HouseRow[]>(db().from("houses").select("id,name,color,sort").order("sort").order("id"));
async function getHouse(id: unknown): Promise<HouseRow> {
  const h = await q<HouseRow | null>(
    db()
      .from("houses")
      .select("id,name,color,sort")
      .eq("id", int(id, { field: "House" }))
      .maybeSingle(),
  );
  if (!h) throw bad("Unknown house");
  return h;
}

export async function updateSettings(actor: Actor, b: Body) {
  const next = { ...(await getSettings()) };
  if (b.title !== undefined)
    next.title = str(b.title, { field: "Title", required: true, max: 120 });
  if (b.venue !== undefined) next.venue = str(b.venue, { field: "Venue", max: 120 });
  if (b.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || isNaN(Date.parse(b.date)))
      throw bad("Date must look like 2026-11-20");
    next.date = b.date;
  }
  if (b.start !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)) throw bad("Start time must look like 08:00");
    next.start = b.start;
  }
  if (b.nameDisplay !== undefined)
    next.nameDisplay = oneOf(b.nameDisplay, ["full", "initial"] as const, "Name display");
  if (b.scheme !== undefined) next.scheme = S.normaliseScheme(b.scheme);
  let houses: { id: number; name: string; color: string }[] | null = null;
  if (b.houses !== undefined) {
    if (!Array.isArray(b.houses)) throw bad("houses must be a list");
    houses = [];
    for (const h of b.houses) {
      const id = int(h.id, { field: "House id" });
      await getHouse(id);
      const color = String(h.color || "");
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw bad("House colours must look like #2ec46a");
      houses.push({
        id,
        name: str(h.name, { field: "House name", required: true, max: 30 }),
        color,
      });
    }
    if (new Set(houses.map((h) => h.name.toLowerCase())).size !== houses.length)
      throw bad("House names must be different");
  }
  await saveSettings(next);
  if (houses) {
    // Two-step rename so swapping names between houses never hits the unique name rule.
    for (const h of houses)
      await q(
        db()
          .from("houses")
          .update({ name: `~${h.id}~${h.name}` })
          .eq("id", h.id),
      );
    for (const h of houses)
      await q(db().from("houses").update({ name: h.name, color: h.color }).eq("id", h.id));
  }
  await audit(actor, "settings.update", { scheme: next.scheme, nameDisplay: next.nameDisplay });
  return { settings: await getSettings(), houses: await listHouses() };
}

export async function setFinalised(actor: Actor, finalised: boolean, force?: boolean) {
  const open = await countOf(
    db()
      .from("sd_events")
      .select("id", { count: "exact", head: true })
      .in("status", ["scheduled", "live"]),
  );
  if (finalised && open > 0 && !force)
    throw new HttpError(409, `${open} event${open === 1 ? " is" : "s are"} not finished yet`, {
      open,
    });
  const s = await getSettings();
  s.finalised = !!finalised;
  s.finalisedAt = finalised ? now() : null;
  await saveSettings(s);
  if (finalised) {
    const completed = await q<{ id: number }[]>(
      db().from("sd_events").select("id").eq("status", "completed"),
    );
    const live = await q<{ id: number }[]>(
      db().from("sd_events").select("id").eq("status", "live"),
    );
    let liveWithResults: number[] = [];
    if (live.length) {
      const rows = await q<{ event_id: number }[]>(
        db()
          .from("sd_entries")
          .select("event_id")
          .in(
            "event_id",
            live.map((e) => e.id),
          )
          .eq("status", "ok")
          .not("perf_value", "is", null),
      );
      liveWithResults = [...new Set(rows.map((r) => r.event_id))];
    }
    const ids = [...completed.map((e) => e.id), ...liveWithResults];
    if (ids.length)
      await q(db().from("sd_events").update({ status: "final", updated_at: now() }).in("id", ids));
  } else {
    await q(
      db()
        .from("sd_events")
        .update({ status: "completed", updated_at: now() })
        .eq("status", "final"),
    );
  }
  await audit(actor, finalised ? "day.finalise" : "day.reopen", { open });
  return s;
}

// ---- events --------------------------------------------------------------------------------------
const getEvent = (id: number) =>
  q<EventRow | null>(db().from("sd_events").select("*").eq("id", id).maybeSingle());
async function mustEvent(id: number) {
  const e = await getEvent(id);
  if (!e) throw new HttpError(404, "Event not found");
  return e;
}
const hasResults = async (eventId: number) => {
  const [entries, teams] = await Promise.all([
    countOf(
      db()
        .from("sd_entries")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .or("perf_value.not.is.null,status.neq.ok"),
    ),
    q<{ id: number }[]>(
      db().from("sd_entries").select("id").eq("event_id", eventId).is("athlete_id", null),
    ),
  ]);
  if (entries) return true;
  if (!teams.length) return false;
  return (
    (await countOf(
      db()
        .from("relay_splits")
        .select("entry_id", { count: "exact", head: true })
        .in(
          "entry_id",
          teams.map((team) => team.id),
        ),
    )) > 0
  );
};
const assertEditable = (actor: Actor, ev: EventRow) => {
  if (ev.status === "final" && actor?.role !== "admin")
    throw new HttpError(423, "This event is finalised. Ask an admin to reopen it");
};

type EventFields = {
  name: string;
  level: string;
  gender: string | null;
  kind: string;
  measure: string;
  sched_time: string;
  relay_legs: number;
};
function cleanEvent(b: Body, cur: EventRow | null): EventFields {
  const kind =
    b.kind !== undefined || !cur ? oneOf(b.kind || "individual", KINDS, "Kind") : cur.kind;
  const defaultRelayLegs = /8\s*[x×]\s*50/i.test(String(b.name ?? cur?.name ?? "")) ? 8 : 4;
  const f: EventFields = {
    name:
      b.name !== undefined || !cur
        ? str(b.name, { field: "Event name", required: true, max: 80 })
        : cur.name,
    level: b.level !== undefined || !cur ? oneOf(b.level, LEVELS, "Level") : cur.level,
    gender: cur ? cur.gender : null,
    kind,
    measure:
      kind === "relay"
        ? "time"
        : b.measure !== undefined || !cur
          ? oneOf(b.measure || "time", MEASURES, "Measure")
          : cur.measure,
    sched_time: cur ? cur.sched_time : "",
    relay_legs:
      kind === "relay"
        ? relayLegCount(
            b.relay_legs !== undefined ? b.relay_legs : cur?.relay_legs || defaultRelayLegs,
          )
        : 0,
  };
  if (b.gender !== undefined)
    f.gender = b.gender === "" || b.gender === null ? null : oneOf(b.gender, GENDERS, "Gender");
  if (b.sched_time !== undefined) {
    const t = str(b.sched_time, { field: "Time", max: 5 });
    if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw bad("Time must look like 09:30");
    f.sched_time = t;
  }
  if (f.measure === "time") f.sched_time = "";
  return f;
}

async function nextSort() {
  const row = await q<{ sort: number } | null>(
    db()
      .from("sd_events")
      .select("sort")
      .order("sort", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return (row ? row.sort : 0) + 1;
}
async function insertEvents(list: EventFields[]): Promise<EventRow[]> {
  if (!list.length) return [];
  const base = await nextSort();
  const t = now();
  return q<EventRow[]>(
    db()
      .from("sd_events")
      .insert(
        list.map((f, i) => ({
          ...f,
          status: "scheduled",
          sort: base + i,
          created_at: t,
          updated_at: t,
        })),
      )
      .select("*")
      .order("id"),
  );
}

export async function createEvent(actor: Actor, b: Body) {
  const f = cleanEvent(b, null);
  const [ev] = await insertEvents([f]);
  if (!ev) throw new Error("Event was not created");
  const added = b.autofill === false ? 0 : await fillEntries(ev, null, actor);
  await audit(actor, "event.create", { ...f, entries: added });
  return { ...(await getEvent(ev.id)), entries: added };
}

/** Create each selected event for every chosen age group and division. */
export async function bulkEvents(actor: Actor, b: Body) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw bad("Choose at least one event");
  const levels = (Array.isArray(b.levels) && b.levels.length ? b.levels : ATHLETE_LEVELS).map(
    (l: unknown) => oneOf(l, ATHLETE_LEVELS, "Level"),
  );
  const genders = (Array.isArray(b.genders) ? b.genders : ["F", "M"]).map((g: unknown) =>
    g === "Mixed" ? null : oneOf(g, GENDERS, "Gender"),
  );
  const plan: EventFields[] = [];
  for (const it of items) {
    const name = str(it.name, { field: "Event name", required: true, max: 80 });
    const kind = oneOf(it.kind || "individual", KINDS, "Kind");
    const measure = kind === "relay" ? "time" : oneOf(it.measure || "time", MEASURES, "Measure");
    const relayLegs =
      kind === "relay"
        ? relayLegCount(
            it.relay_legs !== undefined ? it.relay_legs : /8\s*[x×]\s*50/i.test(name) ? 8 : 4,
          )
        : 0;
    for (const level of levels)
      for (const g of genders.length ? genders : [null])
        plan.push({ name, level, gender: g, kind, measure, sched_time: "", relay_legs: relayLegs });
  }
  if (plan.length > 200) throw bad("That would create more than 200 events. Choose fewer.");
  const existing = await q<EventRow[]>(db().from("sd_events").select("name,level,gender,kind"));
  const key = (e: { name: string; level: string; gender: string | null; kind: string }) =>
    `${e.name}|${e.level}|${e.gender || ""}|${e.kind}`;
  const seen = new Set(existing.map(key));
  const todo: EventFields[] = [];
  let skipped = 0;
  for (const f of plan) {
    if (seen.has(key(f))) {
      skipped++;
      continue;
    }
    seen.add(key(f));
    todo.push(f);
  }
  const created = await insertEvents(todo);
  let entries = 0;
  if (b.autofill !== false && created.length) entries = await fillMany(created, actor);
  await audit(actor, "event.bulk", { created: created.length, skipped, entries });
  return { created: created.length, skipped, entries };
}

export async function updateEvent(actor: Actor, id: number, b: Body) {
  const cur = await mustEvent(id);
  const f = cleanEvent(b, cur);
  if ((f.kind !== cur.kind || f.measure !== cur.measure) && (await hasResults(id)))
    throw new HttpError(409, "Clear this event's results before changing its type");
  await q(
    db()
      .from("sd_events")
      .update({ ...f, updated_at: now() })
      .eq("id", id),
  );
  await audit(actor, "event.update", { id, ...f });
  return getEvent(id);
}

export async function deleteEvent(actor: Actor, id: number) {
  const cur = await mustEvent(id);
  const n = await countOf(
    db().from("sd_entries").select("id", { count: "exact", head: true }).eq("event_id", id),
  );
  await q(db().from("sd_events").delete().eq("id", id));
  await audit(actor, "event.delete", { id, name: cur.name, entries: n });
  return { deleted: id, entriesDeleted: n };
}

// ---- athletes ------------------------------------------------------------------------------------
const ATHLETE_PHOTO_BUCKET = "athlete-photos";
const ADS_IMAGE_BUCKET = "ads-images";
const MEDIA_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

async function signedMediaUrls(bucket: string, paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((path): path is string => !!path))];
  if (!unique.length) return new Map<string, string>();
  const files = await q<{ path: string; signedUrl: string | null }[]>(
    db().storage.from(bucket).createSignedUrls(unique, MEDIA_URL_TTL_SECONDS),
  );
  return new Map(
    files.filter((file) => file.signedUrl).map((file) => [file.path, file.signedUrl!]),
  );
}

export async function listAthletes() {
  const [athletes, entries, events] = await Promise.all([
    q<AthleteRow[]>(db().from("athletes").select("*").order("bib")),
    selectAll<{ id: number; athlete_id: number | null; event_id: number }>(
      "sd_entries",
      "id,athlete_id,event_id",
    ),
    selectAll<{ id: number; name: string }>("sd_events", "id,name"),
  ]);
  const eventById = new Map(events.map((event) => [event.id, event.name]));
  const athleteEvents = new Map<number, Set<number>>();
  const addEvent = (athleteId: number, eventId: number) => {
    const eventIds = athleteEvents.get(athleteId) || new Set<number>();
    eventIds.add(eventId);
    athleteEvents.set(athleteId, eventIds);
  };
  for (const entry of entries)
    if (entry.athlete_id !== null) addEvent(entry.athlete_id, entry.event_id);
  const urls = await signedMediaUrls(
    ATHLETE_PHOTO_BUCKET,
    athletes
      .filter((athlete) => athlete.photo_consent === "granted")
      .map((athlete) => athlete.photo_path),
  );
  return athletes.map((athlete) => {
    const eventIds = athleteEvents.get(athlete.id) || new Set<number>();
    const eventNames = [...eventIds]
      .map((id) => eventById.get(id))
      .filter((name): name is string => name !== undefined)
      .sort((a, b) => a.localeCompare(b));
    const { photo_path, ...visible } = athlete;
    return {
      ...visible,
      has_photo: !!photo_path && athlete.photo_consent === "granted",
      photo_url:
        athlete.photo_consent === "granted" && photo_path ? urls.get(photo_path) || null : null,
      entries: eventIds.size,
      event_names: eventNames,
    };
  });
}
export async function chatAthleteNames() {
  const rows = await q<{ full_name: string }[]>(db().from("athletes").select("full_name"));
  return rows.map((row) => row.full_name);
}
export async function chatEventTimes() {
  return q<{ id: number; sched_time: string }[]>(db().from("sd_events").select("id,sched_time"));
}
const getAthlete = (id: number) =>
  q<AthleteRow | null>(db().from("athletes").select("*").eq("id", id).maybeSingle());

function cleanBib(v: unknown) {
  const b = str(v, { field: "Bib", max: 8 }).toUpperCase();
  if (b && !/^[A-Z0-9-]+$/.test(b)) throw bad("Bib may only use letters, numbers and dashes");
  return b;
}
function bibFrom(letter: string, bibs: string[]) {
  const nums = bibs
    .map((b) => /^[A-Z](\d+)$/i.exec(b))
    .filter(Boolean)
    .map((m) => Number((m as RegExpExecArray)[1]));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return letter + String(n).padStart(2, "0");
}
async function nextBib(house: HouseRow) {
  const letter = (house.name.trim()[0] || "X").toUpperCase();
  const rows = await q<{ bib: string }[]>(
    db()
      .from("athletes")
      .select("bib")
      .like("bib", likeEscape(letter) + "%"),
  );
  return bibFrom(
    letter,
    rows.map((r) => r.bib),
  );
}

type AthleteFields = {
  full_name: string;
  house_id: number;
  level: string | null;
  levels: string[];
  gender: string | null;
  bib: string;
};
function cleanLevels(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[;,|]/);
  return [
    ...new Set(
      values
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .map((item) => oneOf(item, ATHLETE_LEVELS, "Age group")),
    ),
  ];
}
async function cleanAthlete(b: Body, cur: AthleteRow | null): Promise<AthleteFields> {
  const levels =
    b.levels !== undefined
      ? cleanLevels(b.levels)
      : b.level !== undefined
        ? cleanLevels(b.level)
        : cur?.levels?.length
          ? cur.levels
          : cur?.level
            ? [cur.level]
            : [];
  const primaryLevel = cur?.level && levels.includes(cur.level) ? cur.level : levels[0] || null;
  const out: AthleteFields = {
    full_name:
      b.full_name !== undefined || !cur
        ? str(b.full_name, { field: "Full name", required: true, min: 2, max: 80 })
        : cur.full_name,
    house_id: b.house_id !== undefined || !cur ? (await getHouse(b.house_id)).id : cur.house_id,
    level: primaryLevel,
    levels,
    gender: cur ? cur.gender : null,
    bib: b.bib !== undefined ? cleanBib(b.bib) : cur ? cur.bib : "",
  };
  if (b.gender !== undefined)
    out.gender = b.gender === "" || b.gender === null ? null : oneOf(b.gender, GENDERS, "Gender");
  return out;
}
const sameNameInHouse = (name: string, houseId: number) =>
  q<{ id: number }[]>(
    db().from("athletes").select("id").ilike("full_name", likeEscape(name)).eq("house_id", houseId),
  );
const bibOwner = (bib: string) =>
  q<{ id: number }[]>(db().from("athletes").select("id").eq("bib", bib));

export async function createAthlete(actor: Actor, b: Body) {
  const f = await cleanAthlete(b, null);
  if ((await sameNameInHouse(f.full_name, f.house_id)).length)
    throw new HttpError(409, `${f.full_name} is already on the list for that house`);
  if (!f.bib) f.bib = await nextBib(await getHouse(f.house_id));
  else if ((await bibOwner(f.bib)).length) throw new HttpError(409, `Bib ${f.bib} is already used`);
  const row = await q<AthleteRow>(
    db()
      .from("athletes")
      .insert({ ...f, created_at: now() })
      .select("*")
      .single(),
  );
  await audit(actor, "athlete.create", f);
  return row;
}

export async function updateAthlete(actor: Actor, id: number, b: Body) {
  const cur = await getAthlete(id);
  if (!cur) throw new HttpError(404, "Athlete not found");
  const f = await cleanAthlete(b, cur);
  if (!f.bib) f.bib = cur.bib;
  if ((await sameNameInHouse(f.full_name, f.house_id)).some((r) => r.id !== id))
    throw new HttpError(409, "Another athlete with that name is already in that house");
  if ((await bibOwner(f.bib)).some((r) => r.id !== id))
    throw new HttpError(409, `Bib ${f.bib} is already used`);
  await q(db().from("athletes").update(f).eq("id", id));
  await q(
    db()
      .from("sd_entries")
      .update({ name: f.full_name, house_id: f.house_id, updated_at: now() })
      .eq("athlete_id", id),
  );
  await audit(actor, "athlete.update", { id, ...f });
  return getAthlete(id);
}

export async function updateAthleteEvents(actor: Actor, id: number, eventIds: unknown) {
  if (!Array.isArray(eventIds) || eventIds.length > 200) throw bad("Choose up to 200 events");
  const ids = eventIds.map((eventId) => int(eventId, { field: "Event" }));
  if (new Set(ids).size !== ids.length) throw bad("An event can only be selected once");
  const athlete = await getAthlete(id);
  if (!athlete) throw new HttpError(404, "Athlete not found");

  const [current, events] = await Promise.all([
    q<{ id: number; event_id: number; perf_value: number | null; status: string }[]>(
      db().from("sd_entries").select("id,event_id,perf_value,status").eq("athlete_id", id),
    ),
    q<EventRow[]>(db().from("sd_events").select("*")),
  ]);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const currentByEvent = new Map(current.map((entry) => [entry.event_id, entry]));
  for (const eventId of ids) {
    const event = eventById.get(eventId);
    if (!event) throw bad("One or more selected events no longer exist");
    if (event.kind === "relay")
      throw bad("Relay teams are entered by house, not assigned to individual athletes");
    if (!currentByEvent.has(eventId) && !fits(event, athlete)) {
      throw bad(`${event.name} does not match this athlete’s age group and gender`);
    }
  }

  const selected = new Set(ids);
  const removed = current.filter((entry) => !selected.has(entry.event_id));
  for (const entry of removed) {
    const event = eventById.get(entry.event_id);
    if (entry.perf_value !== null || entry.status !== "ok") {
      throw new HttpError(
        409,
        `Clear ${event?.name || "the event"} result before removing this assignment`,
      );
    }
  }
  if (removed.length) {
    await q(
      db()
        .from("sd_entries")
        .delete()
        .in(
          "id",
          removed.map((entry) => entry.id),
        ),
    );
  }

  const addedEvents = ids.filter((eventId) => !currentByEvent.has(eventId));
  if (addedEvents.length) {
    const updatedAt = now();
    await q(
      db()
        .from("sd_entries")
        .insert(
          addedEvents.map((eventId) => ({
            event_id: eventId,
            athlete_id: id,
            name: athlete.full_name,
            house_id: athlete.house_id,
            heat: 1,
            status: "ok",
            updated_by: actor?.id || null,
            updated_at: updatedAt,
          })),
        ),
    );
  }
  await audit(actor, "athlete.events_update", {
    athlete_id: id,
    added: addedEvents.length,
    removed: removed.length,
  });
  return { added: addedEvents.length, removed: removed.length, athlete: await getAthlete(id) };
}

export async function setAthletePhoto(actor: Actor, id: number, image: Uint8Array) {
  if (!image.length || image.length > 512 * 1024)
    throw bad("Upload a JPEG photo no larger than 512 KB");
  const cur = await getAthlete(id);
  if (!cur) throw new HttpError(404, "Athlete not found");
  const previousPath = cur.photo_path || null;
  const path = `${id}/${crypto.randomUUID()}.jpg`;
  await q(
    db()
      .storage.from(ATHLETE_PHOTO_BUCKET)
      .upload(path, image, { contentType: "image/jpeg", upsert: false }),
  );
  try {
    await q(
      db().from("athletes").update({ photo_path: path, photo_consent: "granted" }).eq("id", id),
    );
  } catch (error) {
    try {
      await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove([path]));
    } catch (cleanupError) {
      console.error("Could not remove an unused athlete photo", cleanupError);
    }
    throw error;
  }
  if (previousPath) await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove([previousPath]));
  await audit(actor, "athlete.photo_upload", { id });
  return (await listAthletes()).find((athlete) => athlete.id === id) || null;
}

export async function setAthletePhotoConsent(actor: Actor, id: number, status: unknown) {
  const consent = oneOf(status, ["pending", "granted", "declined"], "Photo consent");
  const cur = await getAthlete(id);
  if (!cur) throw new HttpError(404, "Athlete not found");
  const photoPath = consent === "granted" ? cur.photo_path : null;
  await q(
    db().from("athletes").update({ photo_consent: consent, photo_path: photoPath }).eq("id", id),
  );
  if (cur.photo_path && !photoPath)
    await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove([cur.photo_path]));
  await audit(actor, "athlete.photo_consent", { id, status: consent });
  return (await listAthletes()).find((athlete) => athlete.id === id) || null;
}

export async function removeAthletePhoto(actor: Actor, id: number) {
  const cur = await getAthlete(id);
  if (!cur) throw new HttpError(404, "Athlete not found");
  await q(db().from("athletes").update({ photo_path: null }).eq("id", id));
  if (cur.photo_path) await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove([cur.photo_path]));
  await audit(actor, "athlete.photo_remove", { id });
  return (await listAthletes()).find((athlete) => athlete.id === id) || null;
}

type AdRow = {
  id: number;
  club_name: string;
  title: string;
  description: string;
  price: string;
  location: string;
  representative_name: string;
  phone: string;
  whatsapp: string;
  selling_when: string;
  image_path: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
};

function cleanAd(body: Body, current: AdRow | null) {
  const phone =
    body.phone === undefined && current
      ? current.phone
      : str(body.phone, { field: "Phone", required: true, min: 7, max: 24 });
  const whatsapp =
    body.whatsapp === undefined && current
      ? current.whatsapp
      : str(body.whatsapp, { field: "WhatsApp number", max: 24 });
  const validPhone = (value: string) =>
    /^\+?[\d ()-]+$/.test(value) &&
    value.replace(/\D/g, "").length >= 7 &&
    value.replace(/\D/g, "").length <= 15;
  if (!validPhone(phone)) throw bad("Phone must include 7 to 15 digits");
  if (whatsapp && !validPhone(whatsapp)) throw bad("WhatsApp number must include 7 to 15 digits");
  const active =
    body.is_active === undefined && current ? current.is_active : body.is_active === true;
  if (body.is_active !== undefined && typeof body.is_active !== "boolean")
    throw bad("Ad visibility must be true or false");
  return {
    club_name:
      body.club_name === undefined && current
        ? current.club_name
        : str(body.club_name, { field: "Club name", required: true, min: 2, max: 80 }),
    title:
      body.title === undefined && current
        ? current.title
        : str(body.title, { field: "Title", required: true, min: 2, max: 120 }),
    description:
      body.description === undefined && current
        ? current.description
        : str(body.description, { field: "Description", max: 600 }),
    price:
      body.price === undefined && current
        ? current.price
        : str(body.price, { field: "Price", max: 80 }),
    location:
      body.location === undefined && current
        ? current.location
        : str(body.location, { field: "Location", max: 160 }),
    representative_name:
      body.representative_name === undefined && current
        ? current.representative_name
        : str(body.representative_name, {
            field: "Representative name",
            required: true,
            min: 2,
            max: 80,
          }),
    phone,
    whatsapp,
    selling_when:
      body.selling_when === undefined && current
        ? current.selling_when
        : str(body.selling_when, { field: "Selling date or time", max: 100 }),
    is_active: active,
  };
}

async function adsWithUrls(rows: AdRow[]) {
  const urls = await signedMediaUrls(
    ADS_IMAGE_BUCKET,
    rows.map((row) => row.image_path),
  );
  return rows.map(({ image_path, ...row }) => ({
    ...row,
    has_image: !!image_path,
    image_url: image_path ? urls.get(image_path) || null : null,
  }));
}

export async function listAds(activeOnly = false) {
  let query = db().from("ads").select("*").order("updated_at", { ascending: false }).order("id");
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new HttpError(503, "The ads database is not set up. Apply migration 0009, then retry.");
    }
    throw dbError(error);
  }
  const rows = data as AdRow[];
  return adsWithUrls(rows);
}

export async function saveAd(
  actor: Actor,
  id: number | null,
  body: Body,
  image: Uint8Array | null,
) {
  const current =
    id === null
      ? null
      : await q<AdRow | null>(db().from("ads").select("*").eq("id", id).maybeSingle());
  if (id !== null && !current) throw new HttpError(404, "Ad not found");
  if (image && (!image.length || image.length > 512 * 1024))
    throw bad("Upload a JPEG image no larger than 512 KB");
  const fields = cleanAd(body, current);
  const imagePath = image ? `ads/${crypto.randomUUID()}.jpg` : current?.image_path || null;
  if (image) {
    await q(
      db()
        .storage.from(ADS_IMAGE_BUCKET)
        .upload(imagePath!, image, { contentType: "image/jpeg", upsert: false }),
    );
  }
  const values = { ...fields, image_path: imagePath, updated_at: now() };
  let saved: AdRow;
  try {
    saved =
      id === null
        ? await q<AdRow>(
            db()
              .from("ads")
              .insert({ ...values, created_at: values.updated_at })
              .select("*")
              .single(),
          )
        : await q<AdRow>(db().from("ads").update(values).eq("id", id).select("*").single());
  } catch (error) {
    if (image && imagePath) {
      try {
        await q(db().storage.from(ADS_IMAGE_BUCKET).remove([imagePath]));
      } catch (cleanupError) {
        console.error("Could not remove an unused ad image", cleanupError);
      }
    }
    throw error;
  }
  await audit(actor, id === null ? "ad.create" : "ad.update", {
    id: saved.id,
    club_name: saved.club_name,
    is_active: saved.is_active,
  });
  if (image && current?.image_path)
    await q(db().storage.from(ADS_IMAGE_BUCKET).remove([current.image_path]));
  return (await adsWithUrls([saved]))[0];
}

export async function deleteAd(actor: Actor, id: number) {
  const current = await q<AdRow | null>(db().from("ads").select("*").eq("id", id).maybeSingle());
  if (!current) throw new HttpError(404, "Ad not found");
  await q(db().from("ads").delete().eq("id", id));
  if (current.image_path) await q(db().storage.from(ADS_IMAGE_BUCKET).remove([current.image_path]));
  await audit(actor, "ad.delete", { id, club_name: current.club_name, title: current.title });
  return { deleted: id };
}

export async function deleteAthlete(actor: Actor, id: number) {
  const cur = await getAthlete(id);
  if (!cur) throw new HttpError(404, "Athlete not found");
  const n = await countOf(
    db()
      .from("sd_entries")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", id)
      .or("perf_value.not.is.null,status.neq.ok"),
  );
  if (n > 0)
    throw new HttpError(
      409,
      `${cur.full_name} already has ${n} result${n === 1 ? "" : "s"}. Clear those first`,
    );
  await q(db().from("sd_entries").delete().eq("athlete_id", id));
  await q(db().from("athletes").delete().eq("id", id));
  if (cur.photo_path) await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove([cur.photo_path]));
  await audit(actor, "athlete.delete", { id, name: cur.full_name });
  return { deleted: id };
}

export async function clearRoster(actor: Actor) {
  const [results, relayResults, athletes, entries, photos] = await Promise.all([
    countOf(
      db()
        .from("sd_entries")
        .select("id", { count: "exact", head: true })
        .or("perf_value.not.is.null,status.neq.ok"),
    ),
    countOf(db().from("relay_splits").select("entry_id", { count: "exact", head: true })),
    countOf(db().from("athletes").select("id", { count: "exact", head: true })),
    countOf(db().from("sd_entries").select("id", { count: "exact", head: true })),
    q<{ photo_path: string }[]>(
      db().from("athletes").select("photo_path").not("photo_path", "is", null),
    ),
  ]);
  if (results || relayResults)
    throw new HttpError(409, "Clear all event results before clearing the roster");
  const backup = `before-roster-clear-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await q(
    db()
      .from("backups")
      .insert({ created_at: now(), label: backup, data: await backupData() }),
  );
  await q(db().from("sd_entries").delete().gt("id", 0));
  await q(db().from("athletes").delete().gt("id", 0));
  const photoPaths = photos.map((photo) => photo.photo_path);
  if (photoPaths.length) await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove(photoPaths));
  await audit(actor, "roster.clear", { athletes, entries });
  return { athletes, entries, backup };
}

const LV = (v: unknown) => {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  const compact = s.replace(/[\s_-]+/g, "");
  const aliases: Record<string, (typeof ATHLETE_LEVELS)[number]> = {
    lowerjunior: "Lower Junior",
    lowerjuniors: "Lower Junior",
    "s1&s2": "Lower Junior",
    s1: "Lower Junior",
    s2: "Lower Junior",
    s3: "Junior",
    "s4&s5": "Intermediate",
    s4: "Intermediate",
    s5: "Intermediate",
    ibdp1: "Senior",
    ibdp2: "Open",
    all: "Open",
    open: "Open",
  };
  return !s
    ? null
    : aliases[compact] ||
        ATHLETE_LEVELS.find(
          (l) => l.toLowerCase() === s || (s.length === 1 && l.charAt(0).toLowerCase() === s),
        );
};
const GN = (v: unknown) => {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (["f", "g", "girl", "girls", "female", "w"].includes(s)) return "F";
  if (["m", "b", "boy", "boys", "male"].includes(s)) return "M";
  return undefined;
};

/** rows: [{full_name, house, level, gender, bib}]. House is its name (or first letter). Skips duplicates, reports bad rows. */
export async function importAthletes(actor: Actor, rows: unknown) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000)
    throw bad("Send between 1 and 2000 rows");
  const houses = await listHouses();
  const existing = await q<AthleteRow[]>(db().from("athletes").select("bib,full_name,house_id"));
  const names = new Set(existing.map((a) => `${a.full_name.toLowerCase()}|${a.house_id}`));
  const bibs = existing.map((a) => a.bib);
  const bibSet = new Set(bibs);
  const errors: string[] = [];
  let skipped = 0;
  const toInsert: (AthleteFields & { created_at: number })[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    try {
      const hv = String(r.house || "")
        .trim()
        .toLowerCase();
      const house =
        houses.find((h) => h.name.toLowerCase() === hv) ||
        (hv.length === 1 ? houses.find((h) => h.name.charAt(0).toLowerCase() === hv) : null);
      if (!house) throw bad(`unknown house "${r.house}"`);
      const requestedLevels = Array.isArray(r.levels)
        ? r.levels
        : String(r.levels ?? r.level ?? "").split(/[;,|]/);
      const levels: string[] = [];
      for (const value of requestedLevels) {
        const label = String(value ?? "").trim();
        if (!label) continue;
        const level = LV(label);
        if (level === undefined || level === null) throw bad(`unknown age group "${label}"`);
        if (!levels.includes(level)) levels.push(level);
      }
      const gender = GN(r.gender);
      if (gender === undefined) throw bad(`unknown gender "${r.gender}"`);
      const full_name = str(r.full_name, { field: "Full name", required: true, min: 2, max: 80 });
      let bib = r.bib ? cleanBib(r.bib) : "";
      const nk = `${full_name.toLowerCase()}|${house.id}`;
      if (names.has(nk)) {
        skipped++;
        continue;
      }
      if (!bib)
        bib = bibFrom(
          (house.name.trim()[0] || "X").toUpperCase(),
          bibs.filter((b) => b.startsWith((house.name.trim()[0] || "X").toUpperCase())),
        );
      else if (bibSet.has(bib)) throw bad(`bib ${bib} is already used`);
      names.add(nk);
      bibs.push(bib);
      bibSet.add(bib);
      toInsert.push({
        full_name,
        house_id: house.id,
        level: levels[0] || null,
        levels,
        gender,
        bib,
        created_at: now(),
      });
    } catch (e) {
      errors.push(`Row ${i + 1}: ${(e as Error).message}`);
    }
  }
  for (let i = 0; i < toInsert.length; i += 500)
    await q(
      db()
        .from("athletes")
        .insert(toInsert.slice(i, i + 500)),
    );
  await audit(actor, "athlete.import", {
    created: toInsert.length,
    skipped,
    errors: errors.length,
  });
  return {
    created: toInsert.length,
    skipped,
    errors: errors.slice(0, 50),
    errorCount: errors.length,
  };
}

// ---- entries (who runs in which event) -----------------------------------------------------------
const getEntry = (id: number) =>
  q<EntryRow | null>(db().from("sd_entries").select("*").eq("id", id).maybeSingle());
async function mustEntry(id: number) {
  const e = await getEntry(id);
  if (!e) throw new HttpError(404, "That entry no longer exists");
  return e;
}

/** PostgREST returns at most 1000 rows per request; page through bigger tables. */
async function selectAll<T>(
  table: string,
  cols: string,
  filter?: (b: Any) => Any,
  orderBy: string | string[] = "id",
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let b = db().from(table).select(cols);
    for (const column of Array.isArray(orderBy) ? orderBy : [orderBy]) b = b.order(column);
    b = b.range(from, from + 999);
    if (filter) b = filter(b);
    const rows = await q<T[]>(b);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const fits = (ev: EventRow, a: AthleteRow) =>
  (ev.level === "Mixed" || (a.levels || (a.level ? [a.level] : [])).includes(ev.level)) &&
  (!ev.gender || a.gender === ev.gender);

/** Add athletes to several new events at once (everyone who fits). Relays get one entry per house. */
async function fillMany(events: EventRow[], actor: Actor) {
  const [athletes, houses] = await Promise.all([
    selectAll<AthleteRow>("athletes", "*"),
    listHouses(),
  ]);
  athletes.sort((a, b) => a.bib.localeCompare(b.bib, undefined, { numeric: true }));
  const rows: Record<string, unknown>[] = [];
  const t = now();
  for (const ev of events) {
    if (ev.kind === "relay") for (const h of houses) rows.push(entryRow(ev, null, h, actor, t));
    else for (const a of athletes) if (fits(ev, a)) rows.push(entryRow(ev, a, null, actor, t));
  }
  for (let i = 0; i < rows.length; i += 500)
    await q(
      db()
        .from("sd_entries")
        .insert(rows.slice(i, i + 500)),
    );
  return rows.length;
}
const entryRow = (
  ev: EventRow,
  a: AthleteRow | null,
  h: HouseRow | null,
  actor: Actor,
  t: number,
) => ({
  event_id: ev.id,
  athlete_id: a ? a.id : null,
  name: a ? a.full_name : `${h!.name} team`,
  house_id: h ? h.id : a!.house_id,
  heat: 1,
  status: "ok",
  updated_by: actor ? actor.id : null,
  updated_at: t,
});

/** Add athletes to an event (ids = list, or null for "everyone who fits"). Relays get one entry per house. */
async function fillEntries(ev: EventRow, ids: number[] | null, actor: Actor) {
  const existing = await q<{ athlete_id: number | null; house_id: number }[]>(
    db().from("sd_entries").select("athlete_id,house_id").eq("event_id", ev.id),
  );
  const t = now();
  const rows: Record<string, unknown>[] = [];
  if (ev.kind === "relay") {
    for (const h of await listHouses())
      if (!existing.some((e) => e.athlete_id === null && e.house_id === h.id))
        rows.push(entryRow(ev, null, h, actor, t));
    for (let i = 0; i < rows.length; i += 500)
      await q(
        db()
          .from("sd_entries")
          .insert(rows.slice(i, i + 500)),
      );
    return rows.length;
  } else {
    const have = new Set(existing.map((e) => e.athlete_id));
    let list: AthleteRow[];
    if (ids) {
      list = [];
      for (let i = 0; i < ids.length; i += 300)
        list.push(
          ...(await q<AthleteRow[]>(
            db()
              .from("athletes")
              .select("*")
              .in("id", ids.slice(i, i + 300)),
          )),
        );
    } else list = (await selectAll<AthleteRow>("athletes", "*")).filter((a) => fits(ev, a));
    list.sort((a, b) => a.bib.localeCompare(b.bib, undefined, { numeric: true }));
    for (const a of list)
      if (!have.has(a.id)) {
        have.add(a.id);
        rows.push(entryRow(ev, a, null, actor, t));
      }
  }
  for (let i = 0; i < rows.length; i += 500)
    await q(
      db()
        .from("sd_entries")
        .insert(rows.slice(i, i + 500)),
    );
  return rows.length;
}

export async function addEntries(actor: Actor, eventId: number, b: Body) {
  const ids = b.all
    ? null
    : Array.isArray(b.athlete_ids)
      ? b.athlete_ids.map((x: unknown) => int(x, { field: "Athlete" }))
      : [];
  if (ids && (!ids.length || ids.length > 2000)) throw bad("Choose between 1 and 2000 athletes");
  const ev = await mustEvent(eventId);
  assertEditable(actor, ev);
  const added = await fillEntries(ev, ids, actor);
  await audit(actor, "entries.add", { event: ev.name, level: ev.level, added });
  const total = await countOf(
    db().from("sd_entries").select("id", { count: "exact", head: true }).eq("event_id", eventId),
  );
  return { added, total };
}

export async function removeEntry(actor: Actor, id: number) {
  const cur = await getEntry(id);
  if (!cur) return { deleted: id };
  const ev = await mustEvent(cur.event_id);
  assertEditable(actor, ev);
  await q(db().from("sd_entries").delete().eq("id", id));
  await audit(actor, "entry.remove", { event: ev.name, name: cur.name });
  return { deleted: id };
}

export async function setHeat(actor: Actor, id: number, heat: unknown) {
  const h = int(heat, { field: "Heat", min: 1, max: 30 });
  const cur = await mustEntry(id);
  assertEditable(actor, await mustEvent(cur.event_id));
  await q(db().from("sd_entries").update({ heat: h }).eq("id", id));
  return getEntry(id);
}

/** Split an event's entries into heats of about `size`, mixing houses so every heat is fair. */
export async function makeHeats(actor: Actor, eventId: number, size: unknown) {
  const n = int(size, { field: "Heat size", min: 2, max: 30 });
  const ev = await mustEvent(eventId);
  assertEditable(actor, ev);
  const list = await q<{ id: number; house_id: number; athletes: { bib: string } | null }[]>(
    db().from("sd_entries").select("id,house_id,athletes(bib)").eq("event_id", eventId),
  );
  list.sort(
    (a, b) =>
      a.house_id - b.house_id ||
      (a.athletes?.bib || "").localeCompare(b.athletes?.bib || "") ||
      a.id - b.id,
  );
  const heats = Math.max(1, Math.ceil(list.length / n));
  const byHeat = new Map<number, number[]>();
  list.forEach((e, i) => {
    const h = (i % heats) + 1;
    if (!byHeat.has(h)) byHeat.set(h, []);
    byHeat.get(h)!.push(e.id);
  });
  for (const [h, ids] of byHeat) await q(db().from("sd_entries").update({ heat: h }).in("id", ids));
  await audit(actor, "event.heats", { event: ev.name, heats });
  return { heats, entries: list.length };
}

// ---- recording (what a recorder does on the day) -------------------------------------------------
async function touch(
  actor: Actor,
  ev: EventRow,
  id: number,
  fields: { performance?: string; perf_value?: number | null; status?: string },
) {
  const f = { performance: "", perf_value: null as number | null, status: "ok", ...fields };
  await q(
    db()
      .from("sd_entries")
      .update({ ...f, updated_by: actor!.id, updated_at: now() })
      .eq("id", id),
  );
  if (ev.status === "scheduled")
    await q(
      db()
        .from("sd_events")
        .update({ status: "live", updated_at: now() })
        .eq("id", ev.id)
        .eq("status", "scheduled"),
    );
}
async function entryAndEvent(actor: Actor, id: number) {
  const cur = await mustEntry(id);
  const ev = await mustEvent(cur.event_id);
  assertEditable(actor, ev);
  return { cur, ev };
}

export async function recordTime(actor: Actor, id: number, ms: unknown) {
  const { ev } = await entryAndEvent(actor, id);
  void ms;
  if (ev.measure === "time") throw bad("Timed events now record finish order, not measured times");
  throw bad("This event is measured in distance, not time");
}

const HEAT_ORDER_STRIDE = 100_000;
const ORDER_ID_SCALE = 2_147_483_648;

export async function recordFinish(actor: Actor, id: number) {
  const { cur, ev } = await entryAndEvent(actor, id);
  if (ev.measure !== "time") throw bad("Finish order is only used for timed track events");
  if (cur.status !== "ok" || cur.perf_value !== null)
    throw bad("Clear this result before recording a new finish");
  const recordedInHeat = await q<{ perf_value: number | null; status: string }[]>(
    db().from("sd_entries").select("perf_value,status").eq("event_id", ev.id).eq("heat", cur.heat),
  );
  const count = recordedInHeat.filter(
    (entry) => entry.status === "ok" && entry.perf_value !== null,
  ).length;
  if (count + 1 >= HEAT_ORDER_STRIDE) throw bad("This heat has too many recorded finishers");
  const order = cur.heat * HEAT_ORDER_STRIDE + count + 1 + cur.id / ORDER_ID_SCALE;
  await q(db().from("relay_splits").delete().eq("entry_id", id));
  await touch(actor, ev, id, { performance: "", perf_value: order });
  await audit(actor, "entry.finish", { event: ev.name, name: cur.name, heat: cur.heat });
  return getEntry(id);
}

export async function recordRelaySplit(actor: Actor, id: number, leg: unknown, elapsedMs: unknown) {
  const { ev } = await entryAndEvent(actor, id);
  void leg;
  void elapsedMs;
  if (ev.kind !== "relay") throw bad("This event is not a relay");
  throw bad("Relay events now record finish order, not split times");
}

export async function undoRelaySplit(actor: Actor, id: number) {
  const { cur, ev } = await entryAndEvent(actor, id);
  if (ev.kind !== "relay") throw bad("This event is not a relay");
  const result = await q<{ leg: number }>(
    db().rpc("sd_undo_relay_split", { _entry: id, _actor: actor!.id, _now: now() }),
  );
  await audit(actor, "relay.split.undo", {
    event: ev.name,
    house_id: cur.house_id,
    leg: result.leg,
  });
  return { ...result, entry: await getEntry(id) };
}

export async function recordMark(actor: Actor, id: number, value: unknown) {
  const { cur, ev } = await entryAndEvent(actor, id);
  if (ev.measure !== "distance") throw bad("This event is timed, not measured in distance");
  const p = S.parsePerformance("distance", String(value == null ? "" : value));
  if (p.value === null || p.value <= 0) throw bad("Enter a distance such as 5.43");
  await touch(actor, ev, id, { performance: p.value.toFixed(2), perf_value: p.value });
  await audit(actor, "entry.mark", { event: ev.name, name: cur.name, value: p.value });
  return getEntry(id);
}

export async function clearResult(actor: Actor, id: number) {
  const { cur, ev } = await entryAndEvent(actor, id);
  await q(db().from("relay_splits").delete().eq("entry_id", id));
  await touch(actor, ev, id, {});
  await audit(actor, "entry.clear", { event: ev.name, name: cur.name });
  return getEntry(id);
}

export async function setEntryStatus(actor: Actor, id: number, status: unknown) {
  const st = oneOf(status, S.STATUSES, "Status");
  const { cur, ev } = await entryAndEvent(actor, id);
  await touch(
    actor,
    ev,
    id,
    st === "ok" ? { performance: cur.performance, perf_value: cur.perf_value } : { status: st },
  );
  await audit(actor, "entry.status", { event: ev.name, name: cur.name, status: st });
  return getEntry(id);
}

/** Fix the finishing order: two athletes trade results (a time can be tapped against the wrong name). */
export async function swapResults(actor: Actor, aId: number, bId: number) {
  const a = await mustEntry(aId),
    b = await mustEntry(bId);
  if (a.event_id !== b.event_id) throw bad("Both athletes must be in the same event");
  const ev = await mustEvent(a.event_id);
  assertEditable(actor, ev);
  await q(db().rpc("sd_swap_results", { _a: aId, _b: bId, _actor: actor!.id, _now: now() }));
  await audit(actor, "entry.swap", { event: ev.name, a: a.name, b: b.name });
  return { a: await getEntry(aId), b: await getEntry(bId) };
}

/** Start the stopwatch of one heat. `at` is the moment the recorder pressed the button (server time), if believable. */
export async function startHeat(actor: Actor, eventId: number, heat: unknown, at: unknown) {
  const h = int(heat, { field: "Heat", min: 1, max: 30 });
  const ev = await mustEvent(eventId);
  assertEditable(actor, ev);
  const n = now();
  const t =
    Number.isFinite(Number(at)) && Number(at) <= n + 500 && Number(at) >= n - 5000
      ? Math.round(Number(at))
      : n;
  const r = await q<{ started_at: number; already: boolean }>(
    db().rpc("sd_start_heat", { _event: eventId, _heat: h, _at: t, _now: n }),
  );
  if (!r.already) await audit(actor, "heat.start", { event: ev.name, heat: h });
  return { started_at: Number(r.started_at), now: now(), already: !!r.already };
}

/** Reset a heat's clock. If times were already recorded in it, `force` is needed and they are cleared. */
export async function resetHeat(actor: Actor, eventId: number, heat: unknown, force: boolean) {
  const h = int(heat, { field: "Heat", min: 1, max: 30 });
  const ev = await mustEvent(eventId);
  assertEditable(actor, ev);
  const result = await q<{ cleared: number }>(
    db().rpc("sd_reset_heat", {
      _event: eventId,
      _heat: h,
      _force: force,
      _actor: actor!.id,
      _now: now(),
    }),
  );
  await audit(actor, "heat.reset", { event: ev.name, heat: h, cleared: result.cleared });
  return result;
}

/** Finish an event. Anyone without a result is marked "did not start" (rest = 'dns') or left alone (rest = 'none'). */
export async function completeEvent(actor: Actor, eventId: number, rest: unknown) {
  const mode = oneOf(rest || "dns", ["dns", "none"] as const, "rest");
  const ev = await mustEvent(eventId);
  assertEditable(actor, ev);
  let marked = 0;
  if (mode === "dns") {
    const rows = await q<{ id: number }[]>(
      db()
        .from("sd_entries")
        .update({ status: "dns", updated_by: actor!.id, updated_at: now() })
        .eq("event_id", eventId)
        .eq("status", "ok")
        .is("perf_value", null)
        .select("id"),
    );
    marked = rows.length;
  }
  await q(
    db().from("sd_events").update({ status: "completed", updated_at: now() }).eq("id", eventId),
  );
  await audit(actor, "event.complete", { event: ev.name, markedDns: marked });
  return { event: await getEvent(eventId), markedDns: marked };
}

export async function reopenEvent(actor: Actor, eventId: number) {
  const ev = await mustEvent(eventId);
  assertEditable(actor, ev);
  await q(db().from("sd_events").update({ status: "live", updated_at: now() }).eq("id", eventId));
  await audit(actor, "event.reopen", { event: ev.name });
  return getEvent(eventId);
}

// ---- reset, backup, export -----------------------------------------------------------------------
export async function backupData() {
  const [settings, houses, athletes, events, entries, relayMembers, relaySplits] =
    await Promise.all([
      getSettings(),
      listHouses(),
      selectAll("athletes", "*"),
      selectAll("sd_events", "*"),
      selectAll("sd_entries", "*"),
      selectAll("relay_members", "*", undefined, ["entry_id", "leg"]),
      selectAll("relay_splits", "*", undefined, ["entry_id", "leg"]),
    ]);
  return {
    app: "machabeng-sports-day",
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    houses,
    athletes,
    events,
    entries,
    relayMembers,
    relaySplits,
  };
}

/** 'results' wipes every time/distance and puts events back to "scheduled"; 'all' also deletes events, entries and athletes. */
export async function reset(actor: Actor, scope: unknown) {
  const sc = oneOf(scope, ["results", "all"] as const, "Scope");
  const [results, relayResults] = await Promise.all([
    countOf(
      db()
        .from("sd_entries")
        .select("id", { count: "exact", head: true })
        .or("perf_value.not.is.null,status.neq.ok"),
    ),
    countOf(db().from("relay_splits").select("entry_id", { count: "exact", head: true })),
  ]);
  const n = results + relayResults;
  // Always keep a safety copy first.
  const label = `before-reset-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await q(
    db()
      .from("backups")
      .insert({ created_at: now(), label, data: await backupData() }),
  );
  if (sc === "all") {
    const photos = await q<{ photo_path: string }[]>(
      db().from("athletes").select("photo_path").not("photo_path", "is", null),
    );
    await q(db().from("sd_entries").delete().gt("id", 0));
    await q(db().from("sd_events").delete().gt("id", 0));
    await q(db().from("athletes").delete().gt("id", 0));
    const photoPaths = photos.map((photo) => photo.photo_path);
    if (photoPaths.length) await q(db().storage.from(ATHLETE_PHOTO_BUCKET).remove(photoPaths));
  } else {
    await q(db().from("relay_splits").delete().gt("entry_id", 0));
    await q(
      db()
        .from("sd_entries")
        .update({ performance: "", perf_value: null, status: "ok", updated_at: now() })
        .gt("id", 0),
    );
    await q(
      db()
        .from("sd_events")
        .update({ status: "scheduled", heat_starts: {}, heat_ends: {}, updated_at: now() })
        .gt("id", 0),
    );
  }
  const s = await getSettings();
  s.finalised = false;
  s.finalisedAt = null;
  await saveSettings(s);
  await audit(actor, "data.reset", { scope: sc, resultsCleared: n });
  return { scope: sc, resultsCleared: n, backup: label };
}

export const listAudit = (limit: unknown = 100) =>
  q(
    db()
      .from("audit")
      .select("id,ts,username,action,detail")
      .order("id", { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 1000)),
  );

export async function athletesCsv() {
  const hs = new Map((await listHouses()).map((h) => [h.id, h.name]));
  return (
    [csvRow(["Name", "House", "Age group", "Gender", "Bib"])]
      .concat(
        (await listAthletes()).map((a) =>
          csvRow([
            a.full_name,
            hs.get(a.house_id),
            (a.levels || []).join("; "),
            a.gender || "",
            a.bib,
          ]),
        ),
      )
      .join("\r\n") + "\r\n"
  );
}

// ---- state snapshots (cached per data version, per server instance) ------------------------------
async function loadRaw() {
  const [settings, houses, events, entries, athletes, staff] = await Promise.all([
    getSettings(),
    listHouses(),
    selectAll<EventRow>("sd_events", "*"),
    selectAll<EntryRow>("sd_entries", "*"),
    selectAll<AthleteRow>("athletes", "*"),
    q<{ staff_no: number; display_name: string | null }[]>(
      db().from("profiles").select("staff_no,display_name"),
    ),
  ]);
  const names = new Map(staff.map((s) => [s.staff_no, s.display_name]));
  const photoUrls = await signedMediaUrls(
    ATHLETE_PHOTO_BUCKET,
    athletes
      .filter((athlete) => athlete.photo_consent === "granted")
      .map((athlete) => athlete.photo_path),
  );
  const publicAthletes = athletes.map((athlete) => ({
    ...athlete,
    photo_url:
      athlete.photo_consent === "granted" && athlete.photo_path
        ? photoUrls.get(athlete.photo_path) || null
        : null,
  }));
  for (const e of entries)
    e.by_name = e.updated_by === null ? null : names.get(e.updated_by) || null;
  return { settings, houses, events, entries, athletes: publicAthletes };
}

type Snap = { v: number; json: string; etag: string; state: ReturnType<typeof computeState> };
const snaps: { public: Snap | null; staff: Snap | null } = { public: null, staff: null };

/** kind: 'public' (names optionally shortened) or 'staff' (full detail). */
export async function snapshot(kind: "public" | "staff"): Promise<Snap> {
  const v = await version(); // read the version first, so the data loaded below is at least this new
  const hit = snaps[kind];
  if (hit && hit.v === v) return hit;
  const state = computeState(await loadRaw(), { staff: kind === "staff", version: v });
  const snap = { v, state, json: JSON.stringify(state), etag: `"${kind[0]}${v}"` };
  snaps[kind] = snap;
  return snap;
}
export const csvOf = async (kind: "public" | "staff") => resultsCsv((await snapshot(kind)).state);
