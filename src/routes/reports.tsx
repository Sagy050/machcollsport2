import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Printer, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock, SectionTitle } from "@/components/sports/page";
import { HouseBadge, HouseDot } from "@/components/sports/house";
import { MedalCounts } from "@/components/sports/medal";
import { useSportsData } from "@/hooks/use-sports-data";
import { downloadCsv } from "@/lib/export";
import {
  athleteSummaries,
  houseStandings,
  levelChampions,
  pointsFor,
  type AthleteSummary,
} from "@/lib/scoring";
import { HOUSE_META, LEVEL_LABEL } from "@/lib/sports";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Final Results & Awards — Machabeng Sports Day 2026" },
      {
        name: "description",
        content: "Overall house ranking, top athletes and age-group champions.",
      },
      { property: "og:title", content: "Final Results & Awards — Machabeng Sports Day 2026" },
      {
        property: "og:description",
        content: "Overall house ranking, top athletes and age-group champions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reports,
});

function Reports() {
  const { events, results, scale, isLoading } = useSportsData();
  const standings = useMemo(() => houseStandings(events, results, scale), [events, results, scale]);
  const athletes = useMemo(
    () => athleteSummaries(events, results, scale),
    [events, results, scale],
  );
  const champions = useMemo(() => levelChampions(events, results, scale), [events, results, scale]);
  const finalised = events.filter((event) => event.status === "finalised").length;
  const allFinal = events.length > 0 && finalised === events.length;

  const exportAll = () => {
    const eventById = new Map(events.map((event) => [event.id, event]));
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`sports-day-standings-${date}.csv`, [
      ["Rank", "House", "Points", "Gold", "Silver", "Bronze"],
      ...standings.map((standing) => [
        standing.rank,
        HOUSE_META[standing.house].label,
        standing.points,
        standing.gold,
        standing.silver,
        standing.bronze,
      ]),
      [],
      ["Top athletes"],
      ["Rank", "Name", "House", "Points", "Gold", "Silver", "Bronze", "Events"],
      ...athletes.map((athlete, index) => [
        index + 1,
        athlete.name,
        HOUSE_META[athlete.house].label,
        athlete.points,
        athlete.gold,
        athlete.silver,
        athlete.bronze,
        athlete.events,
      ]),
      [],
      ["All results"],
      ["Event", "Level", "Gender", "Status", "Position", "Name", "House", "Performance", "Points"],
      ...results
        .map((result) => ({ result, event: eventById.get(result.event_id) }))
        .filter((entry) => entry.event)
        .sort(
          (a, b) =>
            a.event!.name.localeCompare(b.event!.name) ||
            (a.result.position ?? 99) - (b.result.position ?? 99),
        )
        .map(({ result, event }) => [
          event!.name,
          LEVEL_LABEL[event!.level],
          event!.gender,
          event!.status,
          result.position ?? "",
          result.participant_name,
          HOUSE_META[result.house].label,
          result.performance ?? "",
          pointsFor(result.position, scale, event!.points_multiplier),
        ]),
    ]);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <LoadingBlock />
      </div>
    );
  }

  const winner = standings[0];
  const podium = standings.slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-7 sm:py-10">
      <header>
        <p className="eyebrow text-primary">
          {allFinal ? "Official results" : `Provisional · ${finalised}/${events.length} finalised`}
        </p>
        <h1 className="mt-1 text-4xl font-extrabold uppercase leading-none sm:text-5xl">Awards</h1>
      </header>

      <section>
        <SectionTitle>House podium</SectionTitle>
        {!winner || winner.points <= 0 ? (
          <EmptyState title="The podium is waiting">
            House champions appear as results are recorded.
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            {podium.map((standing) => {
              const champion = standing.rank === 1;
              const place = standing.rank;
              return (
                <article
                  key={standing.house}
                  className={cn(
                    "relative order-2 overflow-hidden rounded-2xl p-5 shadow-card",
                    champion
                      ? cn(
                          "order-1 sm:order-2 sm:-translate-y-2 sm:py-8",
                          HOUSE_META[standing.house].solid,
                        )
                      : cn(standing.rank === 2 ? "sm:order-1" : "sm:order-3", "border bg-card"),
                  )}
                >
                  {champion && (
                    <Trophy className="absolute right-4 top-4 size-8 opacity-80" aria-hidden />
                  )}
                  <p className={cn("eyebrow", champion ? "opacity-75" : "text-muted-foreground")}>
                    {place === 1
                      ? allFinal
                        ? "Champion house"
                        : "Leading house"
                      : `${place}${place === 2 ? "nd" : "rd"} place`}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    {!champion && <HouseDot house={standing.house} className="size-3" />}
                    <h3 className="font-display text-3xl font-extrabold uppercase leading-none sm:text-4xl">
                      {HOUSE_META[standing.house].label}
                    </h3>
                  </div>
                  <p className="mt-3 font-display text-5xl font-extrabold tabular leading-none">
                    {standing.points}
                    <span className="ml-2 text-sm font-bold uppercase">pts</span>
                  </p>
                  <div className="mt-4">
                    <MedalCounts
                      gold={standing.gold}
                      silver={standing.silver}
                      bronze={standing.bronze}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Individual champions</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {champions.map(({ level, champion, runnerUp }) => (
            <article key={level} className="rounded-2xl border bg-card p-4 shadow-card sm:p-5">
              <p className="eyebrow text-primary">{LEVEL_LABEL[level]} champion</p>
              {champion ? (
                <>
                  <ChampionLine athlete={champion} />
                  {runnerUp && (
                    <div className="mt-4 border-t pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Runner-up
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{runnerUp.name}</span>
                        <HouseBadge house={runnerUp.house} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No individual results yet</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-ink p-5 text-chalk sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div>
          <p className="eyebrow text-signal">Share the finish</p>
          <h2 className="mt-1 font-display text-2xl font-bold uppercase">
            Print or take the results with you
          </h2>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
          <Button
            variant="outline"
            onClick={() => window.print()}
            className="no-print border-white/40 bg-transparent text-chalk hover:bg-white/10 hover:text-chalk"
          >
            <Printer /> Print awards
          </Button>
          <Button onClick={exportAll} className="no-print">
            <Download /> Export CSV
          </Button>
        </div>
      </section>
    </div>
  );
}

function ChampionLine({ athlete }: { athlete: AthleteSummary }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <Trophy className="size-5 shrink-0 text-gold" aria-hidden />
        <p className="font-display text-2xl font-bold uppercase leading-tight">{athlete.name}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <HouseBadge house={athlete.house} />
        <span className="text-sm font-bold tabular">{athlete.points} pts</span>
      </div>
      <div className="mt-3">
        <MedalCounts gold={athlete.gold} silver={athlete.silver} bronze={athlete.bronze} />
      </div>
    </div>
  );
}
