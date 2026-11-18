import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Lock, Plus, Trash2, Unlock, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSportsData } from "@/hooks/use-sports-data";
import { useResultMutations } from "@/hooks/use-result-mutations";
import { pointsFor, rankByPerformance, type PointsScale } from "@/lib/scoring";
import {
  GENDER_LABEL,
  HOUSE_META,
  HOUSES,
  LEVEL_LABEL,
  MEASURE_HINT,
  MEASURE_LABEL,
  type EventStatus,
  type House,
  type SportEvent,
  type SportResult,
} from "@/lib/sports";
import { HouseBadge, HousePicker } from "@/components/sports/house";
import { PositionMark } from "@/components/sports/medal";
import { StatusBadge } from "@/components/sports/status-badge";
import { EmptyState, LoadingBlock, SectionTitle } from "@/components/sports/page";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/events/$eventId")({
  head: () => ({
    meta: [
      { title: "Event Results — Machabeng Sports Day 2026" },
      {
        name: "description",
        content: "Live placings, performances and house points for this Sports Day event.",
      },
      { property: "og:title", content: "Event Results — Machabeng Sports Day 2026" },
      {
        property: "og:description",
        content: "Live placings, performances and house points for this Sports Day event.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EventPage,
});

function sortResults(rows: SportResult[]) {
  return [...rows].sort((a, b) => {
    if (a.position && b.position)
      return a.position - b.position || a.created_at.localeCompare(b.created_at);
    if (a.position) return -1;
    if (b.position) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

function EventPage() {
  const { eventId } = Route.useParams();
  const { events, results, scale, isLoading } = useSportsData();
  const { canRecord, isAdmin } = useAuth();
  const event = events.find((e) => e.id === eventId);
  const rows = useMemo(
    () => sortResults(results.filter((r) => r.event_id === eventId)),
    [results, eventId],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <LoadingBlock />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <EmptyState title="Event not found">
          <Link to="/events" className="underline">
            Back to events
          </Link>
        </EmptyState>
      </div>
    );
  }

  const locked = event.status === "finalised";
  const canEdit = isAdmin || (canRecord && !locked);
  const houseTotals = HOUSES.map((h) => ({
    house: h,
    points: rows
      .filter((r) => r.house === h)
      .reduce((s, r) => s + pointsFor(r.position, scale, event.points_multiplier), 0),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:py-7">
      <Link
        to="/events"
        className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Events
      </Link>

      <header className="sticky top-0 z-30 -mx-4 border-y-2 border-black/10 bg-ink px-4 py-4 text-chalk shadow-lift">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow text-signal">
              {event.measure === "time" ? "Track" : "Field"} · {LEVEL_LABEL[event.level]} ·{" "}
              {GENDER_LABEL[event.gender]}
              {event.is_team && " · Team event"}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold uppercase leading-none sm:text-4xl">
              {event.name}
            </h1>
            <p className="mt-1 text-xs text-chalk/75">
              {[event.scheduled_time, event.venue, MEASURE_LABEL[event.measure]]
                .filter(Boolean)
                .join(" · ")}
              {Number(event.points_multiplier) !== 1 &&
                ` · ×${Number(event.points_multiplier)} points`}
            </p>
          </div>
          {canRecord ? (
            <StatusControls event={event} isAdmin={isAdmin} />
          ) : (
            <StatusBadge status={event.status} className="w-fit text-sm" />
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {houseTotals.map((total) => (
          <div
            key={total.house}
            className={cn("rounded-lg px-3 py-2 text-center", HOUSE_META[total.house].solid)}
          >
            <p className="font-display text-xs font-semibold uppercase tracking-wider opacity-90">
              {HOUSE_META[total.house].label}
            </p>
            <p className="font-display text-2xl font-extrabold tabular leading-none">
              {total.points} pts
            </p>
          </div>
        ))}
      </div>

      {canRecord && locked && !isAdmin && (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm">
          <Lock className="size-4" /> This event is finalised. Ask an admin to reopen it to make
          changes.
        </p>
      )}

      {canEdit && <AddResultForm event={event} />}

      <section>
        <SectionTitle
          aside={
            canEdit && event.measure !== "placing" && rows.length > 0 ? (
              <AutoRankButton event={event} rows={rows} />
            ) : null
          }
        >
          Entries · {rows.length}
        </SectionTitle>
        {rows.length === 0 ? (
          <EmptyState title="No entries yet">
            {canEdit ? "Add the first participant above." : "Results will appear here live."}
          </EmptyState>
        ) : canEdit ? (
          <div className="space-y-2">
            {rows.map((r) => (
              <EditableRow key={r.id} row={r} event={event} scale={scale} rows={rows} />
            ))}
          </div>
        ) : (
          <ReadOnlyTable rows={rows} event={event} scale={scale} />
        )}
      </section>
    </div>
  );
}

function StatusControls({ event, isAdmin }: { event: SportEvent; isAdmin: boolean }) {
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: async (status: EventStatus) => {
      const { error } = await supabase.from("events").update({ status }).eq("id", event.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const steps: { status: EventStatus; label: string }[] = [
    { status: "scheduled", label: "Upcoming" },
    { status: "in_progress", label: "Live" },
    { status: "completed", label: "Done" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Event status"
        className="flex rounded-lg border border-white/30 p-1"
      >
        {steps.map((step) => {
          const active =
            event.status === step.status ||
            (event.status === "finalised" && step.status === "completed");
          return (
            <button
              key={step.status}
              type="button"
              aria-pressed={active}
              disabled={setStatus.isPending || event.status === "finalised"}
              onClick={() => setStatus.mutate(step.status)}
              className={cn(
                "min-h-10 rounded-md px-3 text-xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed",
                active ? "bg-signal text-signal-foreground" : "text-chalk hover:bg-white/10",
              )}
            >
              {step.label}
            </button>
          );
        })}
      </div>
      {isAdmin && event.status !== "finalised" && (
        <Button
          variant="outline"
          size="sm"
          className="border-white/40 bg-transparent text-chalk hover:bg-white/10 hover:text-chalk"
          onClick={() => setStatus.mutate("finalised")}
          disabled={setStatus.isPending}
          aria-label="Finalise event"
        >
          <Lock /> Finalise
        </Button>
      )}
      {isAdmin && event.status === "finalised" && (
        <Button
          variant="outline"
          size="sm"
          className="border-white/40 bg-transparent text-chalk hover:bg-white/10 hover:text-chalk"
          onClick={() => setStatus.mutate("completed")}
          disabled={setStatus.isPending}
        >
          <Unlock /> Reopen
        </Button>
      )}
    </div>
  );
}

function AddResultForm({ event }: { event: SportEvent }) {
  const { user } = useAuth();
  const { add } = useResultMutations();
  const [name, setName] = useState("");
  const [house, setHouse] = useState<House | null>(null);
  const [performance, setPerformance] = useState("");
  const [position, setPosition] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!house) {
      toast.error("Pick a house");
      return;
    }
    const participant = name.trim() || (event.is_team ? `${HOUSE_META[house].label} team` : "");
    if (!participant) {
      toast.error("Enter the participant's name");
      return;
    }
    const pos = position ? Number(position) : null;
    if (pos !== null && (!Number.isInteger(pos) || pos < 1 || pos > 50)) {
      toast.error("Position must be 1–50");
      return;
    }
    await add.mutateAsync({
      event_id: event.id,
      participant_name: participant,
      house,
      performance: performance.trim() || null,
      position: pos,
      recorded_by: user?.id ?? null,
    });
    setName("");
    setPerformance("");
    setPosition("");
    if (event.is_team) setHouse(null);
    nameRef.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl border-2 border-ink/15 bg-card p-4 shadow-card sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-primary">Quick entry</p>
        <span className="text-xs font-semibold text-muted-foreground">
          {MEASURE_LABEL[event.measure]}
        </span>
      </div>
      <Input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={event.is_team ? "Team name (optional, e.g. Ravens A)" : "Full name"}
        className="h-14 border-2 border-input bg-white text-lg font-semibold text-foreground placeholder:text-muted-foreground"
        maxLength={120}
        autoComplete="off"
        autoFocus
        aria-label={event.is_team ? "Team name" : "Athlete name"}
      />
      <HousePicker value={house} onChange={setHouse} />
      <div
        className={cn(
          "grid gap-2",
          event.measure === "placing" ? "grid-cols-[1fr_6rem_auto]" : "grid-cols-[1fr_auto]",
        )}
      >
        <Input
          value={performance}
          onChange={(e) => setPerformance(e.target.value)}
          placeholder={MEASURE_HINT[event.measure]}
          className="h-14 border-2 border-input bg-white text-lg tabular text-foreground placeholder:text-muted-foreground"
          maxLength={40}
          inputMode={event.measure === "placing" ? "text" : "decimal"}
          aria-label={MEASURE_LABEL[event.measure]}
        />
        {event.measure === "placing" && (
          <Input
            value={position}
            onChange={(e) => setPosition(e.target.value.replace(/\D/g, ""))}
            placeholder="Place"
            className="h-14 border-2 border-input bg-white text-center text-lg text-foreground placeholder:text-muted-foreground"
            inputMode="numeric"
            aria-label="Position"
          />
        )}
        <Button type="submit" size="xl" className="h-14 px-5 text-base" disabled={add.isPending}>
          <Plus /> Add entry
        </Button>
      </div>
    </form>
  );
}

function AutoRankButton({ event, rows }: { event: SportEvent; rows: SportResult[] }) {
  const { update } = useResultMutations();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const ranks = rankByPerformance(rows, event.measure);
    const changes = rows.filter((r) => (ranks.get(r.id) ?? null) !== r.position);
    if (changes.length === 0) {
      toast("Positions already match performances");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        changes.map((r) =>
          update.mutateAsync({ id: r.id, patch: { position: ranks.get(r.id) ?? null } }),
        ),
      );
      toast.success(
        `Ranked ${rows.length} entries by ${MEASURE_LABEL[event.measure].toLowerCase()}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={run}
      disabled={busy}
      title="Set positions from performances"
    >
      <Wand2 /> Auto-rank
    </Button>
  );
}

function EditableRow({
  row,
  event,
  scale,
  rows,
}: {
  row: SportResult;
  event: SportEvent;
  scale: PointsScale;
  rows: SportResult[];
}) {
  const { update, remove } = useResultMutations();
  const [name, setName] = useState(row.participant_name);
  const [performance, setPerformance] = useState(row.performance ?? "");
  const [position, setPosition] = useState(row.position ? String(row.position) : "");
  const [focused, setFocused] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Accept changes from other officials unless this row is being edited right now.
  useEffect(() => {
    if (focused) return;
    setName(row.participant_name);
    setPerformance(row.performance ?? "");
    setPosition(row.position ? String(row.position) : "");
  }, [row.participant_name, row.performance, row.position, focused]);

  const commit = () => {
    setFocused(false);
    const patch: Partial<SportResult> = {};
    const n = name.trim();
    if (n && n !== row.participant_name) patch.participant_name = n;
    if (!n) setName(row.participant_name);
    const p = performance.trim() || null;
    if (p !== row.performance) patch.performance = p;
    const pos = position ? Number(position) : null;
    if (pos !== null && (pos < 1 || pos > 50)) {
      toast.error("Position must be 1–50");
      setPosition(row.position ? String(row.position) : "");
    } else if (pos !== row.position) patch.position = pos;
    if (Object.keys(patch).length) update.mutate({ id: row.id, patch });
  };

  const tie =
    row.position !== null && rows.some((r) => r.id !== row.id && r.position === row.position);
  const pts = pointsFor(row.position, scale, event.points_multiplier);
  const inputProps = {
    onFocus: () => setFocused(true),
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    },
  };

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 bg-card p-2.5 shadow-card",
        HOUSE_META[row.house].border,
      )}
    >
      <div className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2">
        <Input
          value={position}
          onChange={(e) => setPosition(e.target.value.replace(/\D/g, ""))}
          {...inputProps}
          className="h-11 text-center font-display text-xl font-bold"
          inputMode="numeric"
          placeholder="–"
          aria-label="Position"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...inputProps}
          className="h-11 text-base font-semibold"
          aria-label="Name"
          maxLength={120}
        />
        <div className="w-14 text-right">
          <p className="font-display text-xl font-bold tabular leading-none">{pts}</p>
          <p className="text-[10px] uppercase text-muted-foreground">pts</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_9rem_auto]">
        <HousePicker
          size="sm"
          value={row.house}
          onChange={(h) => h !== row.house && update.mutate({ id: row.id, patch: { house: h } })}
        />
        <Input
          value={performance}
          onChange={(e) => setPerformance(e.target.value)}
          {...inputProps}
          placeholder={MEASURE_HINT[event.measure]}
          className="h-8"
          aria-label={MEASURE_LABEL[event.measure]}
          maxLength={40}
        />
        <div className="flex items-center justify-end gap-2">
          {tie && (
            <span className="rounded bg-signal px-1.5 py-0.5 text-[10px] font-bold uppercase text-signal-foreground">
              Tie
            </span>
          )}
          {update.isSuccess && !focused && (
            <Check className="size-4 text-primary" aria-label="Saved" />
          )}
          {confirmDelete ? (
            <>
              <Button size="sm" variant="destructive" onClick={() => remove.mutate(row.id)}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete entry"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyTable({
  rows,
  event,
  scale,
}: {
  rows: SportResult[];
  event: SportEvent;
  scale: PointsScale;
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-card">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-3 py-3">
          <PositionMark position={r.position} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{r.participant_name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <HouseBadge house={r.house} />
              {r.performance && (
                <span className="text-sm tabular text-muted-foreground">{r.performance}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-bold tabular leading-none">
              {pointsFor(r.position, scale, event.points_multiplier)}
            </p>
            <p className="text-[10px] uppercase text-muted-foreground">pts</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
