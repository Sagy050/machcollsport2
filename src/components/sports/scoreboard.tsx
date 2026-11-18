import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { HOUSE_META } from "@/lib/sports";
import type { HouseStanding } from "@/lib/scoring";
import { MedalCounts } from "./medal";

export function Scoreboard({ standings }: { standings: HouseStanding[] }) {
  const top = Math.max(1, ...standings.map((standing) => standing.points));

  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {standings.map((standing) => {
        const meta = HOUSE_META[standing.house];
        const leader = standing.rank === 1 && standing.points > 0;
        return (
          <li
            key={standing.house}
            className={cn(
              "overflow-hidden rounded-2xl border bg-card shadow-card transition-shadow hover:shadow-lift",
              leader && "ring-2 ring-gold",
            )}
          >
            <div className={cn("flex items-center justify-between gap-2 px-4 py-3", meta.solid)}>
              <h3 className="font-display text-xl font-bold uppercase tracking-wide">
                {meta.label}
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-black/10 px-2.5 py-1 text-xs font-bold uppercase">
                {leader && <Crown className="size-3.5" aria-hidden />}
                {standing.rank}
                {standing.rank === 1
                  ? "st"
                  : standing.rank === 2
                    ? "nd"
                    : standing.rank === 3
                      ? "rd"
                      : "th"}
              </span>
            </div>
            <div className="p-4">
              <div className="flex items-end justify-between gap-3">
                <p className="font-display text-5xl font-extrabold tabular leading-none">
                  {standing.points}
                </p>
                <span className="pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  points
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700", meta.solid)}
                  style={{ width: `${(standing.points / top) * 100}%` }}
                />
              </div>
              <div className="mt-3">
                <MedalCounts
                  gold={standing.gold}
                  silver={standing.silver}
                  bronze={standing.bronze}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
