import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Radio } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import trackImg from "@/assets/track-lanes.jpg";
import { HouseBadge } from "@/components/sports/house";
import { LoadingBlock, EmptyState, SectionTitle } from "@/components/sports/page";
import { PositionMark } from "@/components/sports/medal";
import { Scoreboard } from "@/components/sports/scoreboard";
import { StatusBadge } from "@/components/sports/status-badge";
import { useSportsData } from "@/hooks/use-sports-data";
import { houseStandings, pointsFor, rankByPerformance } from "@/lib/scoring";
import { eventTitle } from "@/lib/sports";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live House Standings — Machabeng Sports Day 2026" },
      {
        name: "description",
        content:
          "Live scores for Ravens, Hawks, Eagles and Falcons at the Machabeng College Inter-House Sports Day.",
      },
      { property: "og:title", content: "Live House Standings — Machabeng Sports Day 2026" },
      {
        property: "og:description",
        content:
          "Live scores for Ravens, Hawks, Eagles and Falcons at the Machabeng College Inter-House Sports Day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { events, results, scale, isLoading } = useSportsData();
  const standings = useMemo(() => houseStandings(events, results, scale), [events, results, scale]);
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const running = events.filter((event) => event.status === "in_progress");
  const featuredEvent = running[0];
  const featuredResults = useMemo(
    () => (featuredEvent ? results.filter((result) => result.event_id === featuredEvent.id) : []),
    [featuredEvent, results],
  );
  const performanceRanks = useMemo(
    () => (featuredEvent ? rankByPerformance(featuredResults, featuredEvent.measure) : new Map()),
    [featuredEvent, featuredResults],
  );
  const liveLeader =
    featuredResults.find((result) => performanceRanks.get(result.id) === 1) ??
    featuredResults.find((result) => result.position === 1);
  const recent = useMemo(
    () =>
      [...results]
        .filter((result) => result.position)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 8),
    [results],
  );
  const done = events.filter(
    (event) => event.status === "completed" || event.status === "finalised",
  ).length;

  return (
    <div>
      <section className="relative isolate overflow-hidden bg-ink text-chalk">
        <img
          src={trackImg}
          alt=""
          width={1920}
          height={768}
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-scrim" />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <p className="eyebrow text-signal">Machabeng College · 20 Nov 2026</p>
          <h1 className="mt-2 max-w-2xl text-5xl font-extrabold uppercase leading-[0.9] sm:text-7xl">
            Sports Day,
            <br />
            live.
          </h1>
          <div className="mt-6 flex flex-wrap gap-x-7 gap-y-3">
            <Stat label="Events complete" value={`${done}/${events.length}`} />
            <Stat label="Live now" value={String(running.length)} />
            <Stat label="Results" value={String(results.length)} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-7 sm:py-9">
        <section>
          <SectionTitle
            aside={<span className="text-xs font-semibold text-primary">Scores update live</span>}
          >
            House scoreboard
          </SectionTitle>
          {isLoading ? <LoadingBlock /> : <Scoreboard standings={standings} />}
        </section>

        <section>
          <SectionTitle>Happening now</SectionTitle>
          {featuredEvent ? (
            <Link
              to="/events/$eventId"
              params={{ eventId: featuredEvent.id }}
              className="group grid gap-4 rounded-2xl bg-ink p-5 text-chalk shadow-lift transition-transform hover:-translate-y-0.5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-7"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-signal">
                  <Radio className="size-4 animate-live" aria-hidden />
                  <span className="eyebrow">
                    Live event{running.length > 1 ? ` · +${running.length - 1} more` : ""}
                  </span>
                </div>
                <h3 className="mt-2 truncate font-display text-3xl font-bold uppercase sm:text-4xl">
                  {eventTitle(featuredEvent)}
                </h3>
                <p className="mt-1 text-sm text-chalk/70">
                  {[featuredEvent.venue, featuredEvent.scheduled_time]
                    .filter(Boolean)
                    .join(" · ") || "Results are coming in"}
                </p>
                {liveLeader ? (
                  <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-chalk/70">Current leader</span>
                    <span className="font-bold">{liveLeader.participant_name}</span>
                    <HouseBadge house={liveLeader.house} />
                    {liveLeader.performance && (
                      <span className="tabular text-chalk/70">{liveLeader.performance}</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-chalk/70">Waiting for the first result</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                <StatusBadge status={featuredEvent.status} />
                <span className="inline-flex items-center gap-2 text-sm font-bold text-signal">
                  Follow event{" "}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          ) : (
            <EmptyState title="No events live right now">
              Events will appear here as soon as an official starts them.
            </EmptyState>
          )}
        </section>

        <section>
          <SectionTitle
            aside={
              <Link to="/events" className="text-xs font-semibold text-primary">
                All events <ArrowRight className="ml-1 inline size-3" />
              </Link>
            }
          >
            Latest results
          </SectionTitle>
          {recent.length === 0 ? (
            <EmptyState title="No results yet">
              Placings appear here as soon as they are recorded.
            </EmptyState>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recent.map((result) => {
                const event = eventById.get(result.event_id);
                if (!event) return null;
                return (
                  <li key={result.id}>
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: event.id }}
                      className="flex min-h-20 items-center gap-3 rounded-xl border bg-card p-3 shadow-card transition-colors hover:border-primary/50 hover:bg-accent/40"
                    >
                      <PositionMark position={result.position} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{result.participant_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {eventTitle(event)} ·{" "}
                          {formatDistanceToNowStrict(new Date(result.updated_at), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <HouseBadge house={result.house} />
                        <span className="text-xs font-bold tabular">
                          +{pointsFor(result.position, scale, event.points_multiplier)} pts
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Link
          to="/reports"
          className="flex items-center justify-between rounded-xl bg-primary px-4 py-4 font-display text-lg font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Awards & final report <ArrowRight className="size-5" />
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-3xl font-bold tabular leading-none">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-chalk/70">{label}</p>
    </div>
  );
}
