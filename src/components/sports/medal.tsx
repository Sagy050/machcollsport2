import { cn } from "@/lib/utils";

const COLORS: Record<number, string> = {
  1: "bg-gold text-ink",
  2: "bg-silver text-ink",
  3: "bg-bronze text-chalk",
};

export function PositionMark({
  position,
  className,
}: {
  position: number | null;
  className?: string;
}) {
  if (!position)
    return (
      <span
        className={cn(
          "inline-flex size-8 items-center justify-center text-muted-foreground",
          className,
        )}
      >
        –
      </span>
    );
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full font-display text-base font-bold tabular",
        COLORS[position] ?? "bg-muted text-foreground",
        className,
      )}
    >
      {position}
    </span>
  );
}

export function MedalCounts({
  gold,
  silver,
  bronze,
}: {
  gold: number;
  silver: number;
  bronze: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs tabular">
      <span
        className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-1 font-semibold text-foreground"
        aria-label={`${gold} gold medals`}
      >
        <span className="size-2 rounded-full bg-gold" aria-hidden />
        {gold}
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-full bg-silver/30 px-2 py-1 font-semibold text-foreground"
        aria-label={`${silver} silver medals`}
      >
        <span className="size-2 rounded-full bg-silver" aria-hidden />
        {silver}
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-full bg-bronze/15 px-2 py-1 font-semibold text-foreground"
        aria-label={`${bronze} bronze medals`}
      >
        <span className="size-2 rounded-full bg-bronze" aria-hidden />
        {bronze}
      </span>
    </span>
  );
}
