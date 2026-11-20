/**
 * Turns raw database rows into the "state" object that every screen (public site, staff app, final report) renders.
 * Pure function: same rows in, same state out. Positions come from the recorded results, points from positions.
 */
import { formatName, pointsFor, rankByPerformance, type Scheme } from "./scoring";
import { csvRow } from "./util";

export type Settings = {
  title: string;
  date: string;
  start: string;
  venue: string;
  scheme: Scheme;
  nameDisplay: "full" | "initial";
  finalised: boolean;
  finalisedAt: number | null;
};
export type HouseRow = { id: number; name: string; color: string; sort: number };
export type AthleteRow = {
  id: number;
  bib: string;
  full_name: string;
  house_id: number;
  level: string | null;
  levels: string[];
  gender: string | null;
  created_at: number;
  photo_path?: string | null;
  photo_consent?: string;
  has_photo?: boolean;
  photo_url?: string | null;
};
export type EventRow = {
  id: number;
  name: string;
  level: string;
  gender: string | null;
  kind: string;
  measure: string;
  relay_legs: number;
  sched_time: string;
  status: string;
  heat_starts: Record<string, number>;
  heat_ends?: Record<string, number>;
  sort: number;
  created_at: number;
  updated_at: number;
};
export type EntryRow = {
  id: number;
  event_id: number;
  athlete_id: number | null;
  name: string;
  house_id: number;
  heat: number;
  performance: string;
  perf_value: number | null;
  status: string;
  updated_by: number | null;
  updated_at: number;
  by_name?: string | null;
};
export type RelayMemberRow = {
  entry_id: number;
  leg: number;
  athlete_id: number;
  bib: string;
  full_name: string;
  house_id: number;
};
export type RelaySplitRow = { entry_id: number; leg: number; cumulative_ms: number };
export type RawData = {
  settings: Settings;
  houses: HouseRow[];
  events: EventRow[];
  entries: EntryRow[];
  athletes: AthleteRow[];
  relayMembers?: RelayMemberRow[];
  relaySplits?: RelaySplitRow[];
};

const LEVELS = ["Lower Junior", "Junior", "Intermediate", "Senior", "Open"];
type Tally = { points: number; gold: number; silver: number; bronze: number; events: number };
const cmpStats = (a: Tally, b: Tally) => b.points - a.points || b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze;
const sameStats = (a: Tally, b: Tally) => a.points === b.points && a.gold === b.gold && a.silver === b.silver && a.bronze === b.bronze;

function medalTally(rows: { points: number; position: number | null }[]): Tally {
  const t = { points: 0, gold: 0, silver: 0, bronze: 0, events: 0 };
  for (const r of rows) {
    t.points += r.points;
    if (r.position === 1) t.gold++;
    else if (r.position === 2) t.silver++;
    else if (r.position === 3) t.bronze++;
    t.events++;
  }
  return t;
}

function champion<T extends Tally & { name: string }>(list: T[]): (T & { joint: boolean }) | null {
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => cmpStats(a, b) || a.name.localeCompare(b.name));
  const first = sorted[0];
  const second = sorted[1];
  if (!first || first.points <= 0) return null;
  return { ...first, joint: !!second && sameStats(first, second) };
}

/** Positions for every entry, worked out per event from the recorded times/distances (heats ranked together). */
export function positionsFor(events: EventRow[], entries: EntryRow[]): Map<number, number> {
  const byEvent = new Map<number, EntryRow[]>();
  for (const e of entries) {
    if (!byEvent.has(e.event_id)) byEvent.set(e.event_id, []);
    byEvent.get(e.event_id)!.push(e);
  }
  const out = new Map<number, number>();
  for (const ev of events) {
    const ranks = rankByPerformance(byEvent.get(ev.id) || [], ev.measure);
    ranks.forEach((p, id) => out.set(id, p));
  }
  return out;
}

export function computeState(raw: RawData, { staff = false, version = 0 }: { staff?: boolean; version?: number } = {}) {
  const { settings, houses, events, entries, athletes } = raw;
  const scheme = settings.scheme;
  const mode = staff ? "full" : settings.nameDisplay;
  const athleteById = new Map(athletes.map((a) => [a.id, a]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const positions = positionsFor(events, entries);
  const relayMembersByEntry = new Map<number, RelayMemberRow[]>();
  for (const member of raw.relayMembers || []) {
    if (!relayMembersByEntry.has(member.entry_id)) relayMembersByEntry.set(member.entry_id, []);
    relayMembersByEntry.get(member.entry_id)!.push(member);
  }
  const relaySplitsByEntry = new Map<number, { leg: number; cumulativeMs: number; splitMs: number }[]>();
  for (const split of raw.relaySplits || []) {
    const list = relaySplitsByEntry.get(split.entry_id) || [];
    const previous = list.length ? list[list.length - 1]!.cumulativeMs : 0;
    list.push({ leg: split.leg, cumulativeMs: split.cumulative_ms, splitMs: split.cumulative_ms - previous });
    relaySplitsByEntry.set(split.entry_id, list);
  }

  // Score every entry once.
  const scored = entries.map((e) => {
    const position = e.status === "ok" ? (positions.get(e.id) ?? null) : null;
    return { ...e, position, points: pointsFor(position, e.status, scheme) };
  });
  type Scored = (typeof scored)[number];
  const scoredOk = scored.filter((e) => e.status === "ok" && e.position !== null);

  // House standings. Tie-break: points, then golds, then silvers, then bronzes.
  const standings = houses
    .map((h) => {
      const t = medalTally(scoredOk.filter((e) => e.house_id === h.id));
      return { house_id: h.id, name: h.name, color: h.color, ...t, rank: 0 };
    })
    .sort((a, b) => cmpStats(a, b) || a.name.localeCompare(b.name));
  standings.forEach((s, i) => {
    const prev = i > 0 ? standings[i - 1] : undefined;
    s.rank = prev && sameStats(s, prev) ? prev.rank : i + 1;
  });

  // Events with their entries.
  const entriesByEvent = new Map<number, Scored[]>();
  for (const e of scored) {
    if (!entriesByEvent.has(e.event_id)) entriesByEvent.set(e.event_id, []);
    entriesByEvent.get(e.event_id)!.push(e);
  }
  const shape = (e: Scored) => {
    const a = e.athlete_id === null ? null : athleteById.get(e.athlete_id);
    const out: Record<string, unknown> = {
      id: e.id,
      name: mode === "full" || e.athlete_id === null ? e.name : formatName(e.name, mode),
      bib: a ? a.bib : "",
      athlete_id: e.athlete_id,
      house_id: e.house_id,
      heat: e.heat,
      performance: e.performance,
      position: e.position,
      status: e.status,
      points: e.points,
      relayMembers: (relayMembersByEntry.get(e.id) || [])
        .slice()
        .sort((a, b) => a.leg - b.leg)
        .map((m) => ({
          leg: m.leg,
          athlete_id: m.athlete_id,
          bib: m.bib,
          name: m.full_name,
          full_name: m.full_name,
          house_id: m.house_id,
        })),
      relaySplits: relaySplitsByEntry.get(e.id) || [],
    };
    if (e.position === 1 && a?.photo_url) out.photoUrl = a.photo_url;
    if (staff) Object.assign(out, { by: e.by_name || null, at: e.updated_at, level: a ? a.level : null, levels: a ? a.levels : [], gender: a ? a.gender : null });
    return out;
  };
  const evList = events
    .slice()
    .sort((a, b) => (a.sched_time || "99:99").localeCompare(b.sched_time || "99:99") || a.sort - b.sort || a.id - b.id)
    .map((ev) => {
      const list = (entriesByEvent.get(ev.id) || [])
        .slice()
        .sort(
          (a, b) =>
            (a.position ?? 999) - (b.position ?? 999) ||
            (a.status === "ok" ? 0 : 1) - (b.status === "ok" ? 0 : 1) ||
            a.name.localeCompare(b.name),
        );
      const finished = list.filter((x) => x.position !== null || x.status !== "ok").length;
      return {
        id: ev.id,
        name: ev.name,
        level: ev.level,
        gender: ev.gender,
        kind: ev.kind,
        measure: ev.measure,
        relayLegs: ev.relay_legs || 4,
        time: ev.sched_time,
        status: ev.status,
        entries: list.map(shape),
        count: list.length,
        finished,
        ...(staff
          ? {
              heatStarts: ev.heat_starts || {},
              heatEnds: ev.heat_ends || {},
              heats: Math.max(1, ...list.map((x) => x.heat)),
            }
          : {}),
      };
    });

  // Progress.
  const count = (s: string) => events.filter((e) => e.status === s).length;
  const progress = {
    total: events.length,
    scheduled: count("scheduled"),
    live: count("live"),
    completed: count("completed"),
    final: count("final"),
    done: count("completed") + count("final"),
    withResults: events.filter((e) => (entriesByEvent.get(e.id) || []).some((x) => x.position !== null)).length,
  };

  // Latest results feed (newest first).
  const recent = scoredOk
    .slice()
    .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id)
    .slice(0, 15)
    .map((e) => {
      const ev = eventById.get(e.event_id);
      const athlete = e.athlete_id === null ? null : athleteById.get(e.athlete_id);
      return {
        id: e.id,
        at: e.updated_at,
        event_id: e.event_id,
        event: ev ? ev.name : "",
        level: ev ? ev.level : "",
        name: mode === "full" || e.athlete_id === null ? e.name : formatName(e.name, mode),
        photoUrl: e.position === 1 ? athlete?.photo_url || null : null,
        house_id: e.house_id,
        position: e.position,
        performance: e.performance,
        points: e.points,
      };
    });

  // Individual awards (relay entries have no athlete and score for the house only).
  const stats = new Map<number, Scored[]>();
  for (const e of scoredOk) {
    if (e.athlete_id === null) continue;
    if (!stats.has(e.athlete_id)) stats.set(e.athlete_id, []);
    stats.get(e.athlete_id)!.push(e);
  }
  const athleteStats = [...stats.entries()]
    .filter(([id]) => athleteById.has(id))
    .map(([id, rows]) => {
      const a = athleteById.get(id)!;
      return { athlete_id: id, name: formatName(a.full_name, mode), house_id: a.house_id, level: a.level, gender: a.gender, ...medalTally(rows) };
    });
  type AStat = (typeof athleteStats)[number];
  const byRank = (list: AStat[]) => list.slice().sort((a, b) => cmpStats(a, b) || a.name.localeCompare(b.name));
  const top = byRank(athleteStats).filter((a) => a.points > 0);
  const ageStats = new Map<number, Map<string, Scored[]>>();
  for (const e of scoredOk) {
    if (e.athlete_id === null) continue;
    const level = eventById.get(e.event_id)?.level;
    if (!level) continue;
    if (!ageStats.has(e.athlete_id)) ageStats.set(e.athlete_id, new Map());
    const byLevel = ageStats.get(e.athlete_id)!;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(e);
  }
  const athleteAgeStats: (AStat & { level: string })[] = [];
  for (const [id, byLevel] of ageStats) {
    const a = athleteById.get(id);
    if (!a) continue;
    for (const [level, rows] of byLevel) {
      athleteAgeStats.push({
        athlete_id: id,
        name: formatName(a.full_name, mode),
        house_id: a.house_id,
        level,
        gender: a.gender,
        ...medalTally(rows),
      });
    }
  }
  const GL: Record<string, string> = { F: "girls", M: "boys" };
  const ageGroups: Record<string, unknown>[] = [];
  for (const lvl of LEVELS) {
    const inLevel = athleteAgeStats.filter((a) => a.level === lvl);
    const all = champion(inLevel);
    if (all) ageGroups.push({ label: lvl, ...all, photoUrl: athleteById.get(all.athlete_id)?.photo_url || null });
    for (const g of ["F", "M"]) {
      const c = champion(inLevel.filter((a) => a.gender === g));
      if (c) ageGroups.push({ label: `${lvl} ${GL[g]}`, ...c, photoUrl: athleteById.get(c.athlete_id)?.photo_url || null });
    }
  }
  const topAthletes = top
    .slice(0, 10)
    .map((a, i) => {
      const prev = i > 0 ? top[i - 1] : undefined;
      return { ...a, photoUrl: athleteById.get(a.athlete_id)?.photo_url || null, rank: (prev && sameStats(a, prev) ? null : i + 1) as number | null };
    });
  // Give tied top athletes the shared rank number.
  let lastRank = 0;
  topAthletes.forEach((a) => {
    if (a.rank === null) a.rank = lastRank;
    else lastRank = a.rank;
  });
  const awards = {
    topAthletes,
    bestPerHouse: houses.map((h) => {
      const athlete = champion(athleteStats.filter((a) => a.house_id === h.id));
      return {
        house_id: h.id,
        athlete: athlete ? { ...athlete, photoUrl: athleteById.get(athlete.athlete_id)?.photo_url || null } : null,
      };
    }),
    ageGroups,
  };

  const winner = progress.total > 0 && standings[0] && standings[0].points > 0 ? standings.filter((s) => s.rank === 1).map((s) => s.house_id) : [];

  return {
    v: version,
    generatedAt: Date.now(),
    settings: {
      title: settings.title,
      date: settings.date,
      start: settings.start,
      venue: settings.venue,
      finalised: !!settings.finalised,
      finalisedAt: settings.finalisedAt || null,
      scheme,
      nameDisplay: settings.nameDisplay,
    },
    houses: houses.map((h) => ({ id: h.id, name: h.name, color: h.color })),
    standings,
    progress,
    events: evList,
    recent,
    awards,
    winner,
  };
}
export type AppState = ReturnType<typeof computeState>;

/** One row per entry, for Excel / Google Sheets. */
export function resultsCsv(state: AppState): string {
  const house = new Map(state.houses.map((h) => [h.id, h.name]));
  const rows = [csvRow(["Event", "Level", "Status", "Position", "Bib", "Name", "House", "Performance", "Entry status", "Points"])];
  for (const ev of state.events) {
    for (const e of ev.entries as { position: number | null; bib: string; name: string; house_id: number; performance: string; status: string; points: number }[]) {
      rows.push(csvRow([ev.name, ev.level, ev.status, e.position ?? "", e.bib, e.name, house.get(e.house_id), e.performance, e.status, e.points]));
    }
  }
  return rows.join("\r\n") + "\r\n";
}
