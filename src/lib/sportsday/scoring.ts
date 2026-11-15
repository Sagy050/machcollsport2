/**
 * Pure scoring helpers: no database, no HTTP. Unit-tested in src/test/sportsday-scoring.test.ts.
 *
 * POINTS SYSTEM (default, editable by an admin):
 *   1st = 10, 2nd = 7, 3rd = 5, 4th = 3, 5th and below = 1.
 *   DNS / DNF / DQ score 0. Relays use the same scale as individual events.
 *   Points and positions are never stored: they are recalculated from the recorded times/distances,
 *   so changing the scale (or correcting a result) instantly re-scores the whole day consistently.
 */
import { bad } from "./util";

export type Scheme = { points: number[]; rest: number };
export type EntryStatus = "ok" | "dns" | "dnf" | "dq";

export const DEFAULT_SCHEME: Scheme = { points: [10, 7, 5, 3], rest: 1 };
export const STATUSES: EntryStatus[] = ["ok", "dns", "dnf", "dq"];

export function normaliseScheme(s: unknown): Scheme {
  const x = s as Partial<Scheme> | null;
  if (!x || !Array.isArray(x.points) || x.points.length < 1 || x.points.length > 10)
    throw bad("Points scale needs between 1 and 10 positions");
  const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000;
  if (!x.points.every(ok) || !ok(x.rest)) throw bad("Points must be whole numbers between 0 and 1000");
  return { points: x.points.slice(), rest: x.rest as number };
}

export function pointsFor(position: number | null | undefined, status: string | null | undefined, scheme: Scheme): number {
  if (status && status !== "ok") return 0;
  if (!Number.isInteger(position) || (position as number) < 1) return 0;
  const p = position as number;
  return p <= scheme.points.length ? scheme.points[p - 1] : scheme.rest;
}

/**
 * Parse what a recorder typed. Returns { text, value } where value is a number used for ranking.
 *   time:     "12.34", "12,34", "1:02.5", "1:02:03.1", "12.34s"  -> seconds
 *   distance: "5.43", "5,43m", "5.43 m"                          -> metres
 */
export function parsePerformance(measure: string, raw: unknown): { text: string; value: number | null } {
  const text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, 40);
  if (!text) return { text: "", value: null };
  if (measure === "none") return { text, value: null };
  const t = text.replace(",", ".");
  if (measure === "time") {
    const m = /^(?:(\d{1,2}):)?(?:(\d{1,2}):)?(\d{1,3}(?:\.\d{1,3})?)\s*s?$/i.exec(t);
    if (!m) throw bad(`"${text}" is not a valid time. Use 12.34 or 1:02.50`);
    const parts = t.replace(/\s*s$/i, "").split(":").map(Number);
    if (parts.some((n) => !isFinite(n))) throw bad(`"${text}" is not a valid time`);
    if (parts.length > 1 && parts.slice(1).some((n) => n >= 60)) throw bad(`"${text}" is not a valid time (seconds must be below 60)`);
    const value = parts.reduce((acc, n) => acc * 60 + n, 0);
    return { text, value };
  }
  const m = /^(\d{1,5}(?:\.\d{1,3})?)\s*(m|pts|points)?$/i.exec(t);
  if (!m) throw bad(`"${text}" is not a valid ${measure}. Use a number like ${measure === "distance" ? "5.43" : "87"}`);
  return { text, value: Number(m[1]) };
}

/** Lower is better for time, higher is better for distance. */
export const lowerIsBetter = (measure: string) => measure === "time";

/**
 * Competition ranking ("1224"): equal performances share a position and the next position is skipped.
 * Returns Map(entryId -> position) for entries that are status 'ok' and have a numeric performance.
 */
export function rankByPerformance(
  entries: { id: number; status: string; perf_value: number | null | undefined }[],
  measure: string,
): Map<number, number> {
  const ranked = entries.filter((e) => e.status === "ok" && e.perf_value !== null && e.perf_value !== undefined);
  const better = lowerIsBetter(measure) ? (a: number, b: number) => a < b : (a: number, b: number) => a > b;
  const out = new Map<number, number>();
  for (const e of ranked) out.set(e.id, 1 + ranked.filter((o) => better(o.perf_value as number, e.perf_value as number)).length);
  return out;
}

/** "Thabo Mokoena" -> "Thabo M." (used when the admin chooses to hide full names from the public). */
export function formatName(name: string, mode: string): string {
  if (mode !== "initial") return name;
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Seconds -> "12.34" or "1:02.50". Truncates to hundredths, like a stopwatch does. */
export function formatTime(sec: number): string {
  const cs = Math.floor(sec * 100 + 1e-6);
  const m = Math.floor(cs / 6000),
    s = (cs % 6000) / 100;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}
