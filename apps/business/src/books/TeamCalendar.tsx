"use client";

// The team calendar (Joshua, 2026-10-20, after Outlook's): a month of day
// squares showing everyone's schedule, on-call days as all-day bars that run
// across the days they cover, shifts as chips under them, "N more" when a day
// is full. Tapping a day opens it by the hour: an "All day" row for who's on
// call, then the hours with each shift as a block (shifts that overlap sit
// side by side; a night shift carries into the next morning). Both sides use
// it, the business and everyone who works there; it only draws what it's
// given (books/team_schedule.ts `calendarEntries`).

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { addDays, blockMinutes, overnight, scheduleWeekOf, timeLabel } from "./schedule";
import type { CalendarEntry } from "./team_schedule";

/** One colour per person, in a fixed order (never cycled by rank: a person keeps theirs). */
const COLORS = ["#18dccb", "#f8d084", "#81c784", "#e57373", "#64b5f6", "#ba68c8", "#ffb74d", "#4db6ac", "#f06292", "#aed581", "#9575cd", "#4fc3f7"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHOWN = 3; // chips a day square shows before "N more"
const HOUR_PX = 44;
const DATE_PX = 28; // the day number's row in a square
const LANE_PX = 18; // one on-call bar

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const monthOf = (date: string) => date.slice(0, 7);
/** "7a", "3:30p". */
const short = (t: string) => {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "a" : "p"}`;
};
const firstName = (name: string) => name.split(/\s+/)[0] ?? name;
const longDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export type TeamCalendarProps = {
  entries: readonly CalendarEntry[];
  today: string;
  /** Whose entries stand out (the person's own, on their side). */
  highlight?: string;
  /** Shown under the day view, for that day (the business's edit link, say). */
  dayFooter?: (date: string) => React.ReactNode;
};

export function TeamCalendar({ entries, today, highlight, dayFooter }: TeamCalendarProps) {
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState<string | null>(null);
  // Colours by first appearance, so a person keeps theirs as the months change.
  const colorOf = useMemo(() => {
    const order = [...new Set([...entries].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => e.key))];
    const map = new Map(order.map((k, i) => [k, COLORS[i % COLORS.length]!]));
    return (key: string) => map.get(key) ?? COLORS[0]!;
  }, [entries]);
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) if (!seen.has(e.key)) seen.set(e.key, e.name);
    return [...seen.entries()];
  }, [entries]);

  if (day) return <DayView day={day} entries={entries} today={today} colorOf={colorOf} highlight={highlight} onDay={setDay} onBack={() => setDay(null)} footer={dayFooter?.(day)} />;

  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const weeks: string[] = [];
  for (let w = scheduleWeekOf(first); w <= last; w = addDays(w, 7)) weeks.push(w);
  const shiftMonth = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {MONTHS[m - 1]} {y}
        </h3>
        <div className="flex items-center gap-1">
          {month !== monthOf(today) && (
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setMonth(monthOf(today))}>
              Today
            </Button>
          )}
          <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Earlier month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Later month" onClick={() => shiftMonth(1)}>
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <div className="-mx-4 overflow-hidden border-y sm:mx-0 sm:rounded-lg sm:border">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((w) => (
          <WeekRow key={w} weekStart={w} month={month} entries={entries} today={today} colorOf={colorOf} highlight={highlight} onDay={setDay} />
        ))}
      </div>
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Who's on the calendar">
          {people.map(([key, name]) => (
            <li key={key} className={cn("flex items-center gap-1.5", key === highlight && "font-medium text-foreground")}>
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: colorOf(key) }} />
              {name}
              {key === highlight && " (you)"}
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
    </div>
  );
}

type Span = { key: string; name: string; start: number; end: number; draft: boolean };

/** On-call runs within a week, per person (consecutive days make one bar), each given a lane. */
function spansOf(weekStart: string, entries: readonly CalendarEntry[]): { spans: (Span & { lane: number })[]; lanes: number } {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byPerson = new Map<string, { name: string; on: boolean[]; draft: boolean }>();
  for (const e of entries) {
    if (e.kind !== "onCall") continue;
    const i = days.indexOf(e.date);
    if (i < 0) continue;
    const p = byPerson.get(e.key) ?? { name: e.name, on: Array(7).fill(false), draft: false };
    p.on[i] = true;
    p.draft ||= !!e.draft;
    byPerson.set(e.key, p);
  }
  const spans: Span[] = [];
  for (const [key, p] of byPerson) {
    for (let i = 0; i < 7; i++) {
      if (!p.on[i]) continue;
      let j = i;
      while (j + 1 < 7 && p.on[j + 1]) j++;
      spans.push({ key, name: p.name, start: i, end: j, draft: p.draft });
      i = j;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const laneEnds: number[] = [];
  const placed = spans.map((s) => {
    let lane = laneEnds.findIndex((end) => end < s.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.end;
    return { ...s, lane };
  });
  return { spans: placed, lanes: laneEnds.length };
}

function WeekRow({
  weekStart,
  month,
  entries,
  today,
  colorOf,
  highlight,
  onDay,
}: {
  weekStart: string;
  month: string;
  entries: readonly CalendarEntry[];
  today: string;
  colorOf: (key: string) => string;
  highlight: string | undefined;
  onDay: (date: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const { spans, lanes } = spansOf(weekStart, entries);
  const shownLanes = Math.min(lanes, SHOWN);
  return (
    <div className="relative grid grid-cols-7 border-b last:border-b-0">
      {days.map((d, i) => {
        const shifts = entries.filter((e) => e.kind === "shift" && e.date === d).sort((a, b) => (a.start! < b.start! ? -1 : 1));
        const hiddenSpans = spans.filter((s) => s.lane >= SHOWN && s.start <= i && i <= s.end).length;
        const room = Math.max(0, SHOWN - shownLanes);
        const more = Math.max(0, shifts.length - room) + hiddenSpans;
        const onCallCount = entries.filter((e) => e.kind === "onCall" && e.date === d).length;
        const label = `${longDay(d)}: ${shifts.length} ${shifts.length === 1 ? "shift" : "shifts"}${onCallCount ? `, ${onCallCount} on call` : ""}`;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onDay(d)}
            aria-label={label}
            className={cn("relative flex min-h-24 flex-col border-r text-left last:border-r-0 hover:bg-accent/40 sm:min-h-28", monthOf(d) !== month && "bg-muted/30")}
          >
            <span className="flex h-7 shrink-0 items-start justify-center pt-0.5 text-xs">
              <span className={cn("grid size-6 place-items-center rounded-full tabular-nums", d === today && "bg-foreground font-semibold text-background", monthOf(d) !== month && d !== today && "text-muted-foreground")}>
                {d.endsWith("-01") ? `${MONTHS[Number(d.slice(5, 7)) - 1]!.slice(0, 3)} 1` : Number(d.slice(8))}
              </span>
            </span>
            <span aria-hidden style={{ height: shownLanes * LANE_PX }} className="shrink-0" />
            <span className="flex flex-col gap-0.5 px-0.5 pb-1">
              {shifts.slice(0, room).map((e, j) => (
                <Chip key={j} color={colorOf(e.key)} draft={!!e.draft} strong={e.key === highlight}>
                  {firstName(e.name)} {short(e.start!)}
                </Chip>
              ))}
              {more > 0 && <span className="rounded-sm bg-muted px-1 text-center text-[10px] leading-4 text-muted-foreground">{more} more</span>}
            </span>
          </button>
        );
      })}
      {spans
        .filter((s) => s.lane < SHOWN)
        .map((s) => (
          <span
            key={`${s.key}-${s.start}`}
            aria-hidden
            className="pointer-events-none absolute z-10 px-0.5"
            style={{ top: DATE_PX + s.lane * LANE_PX, left: `${(s.start / 7) * 100}%`, width: `${((s.end - s.start + 1) / 7) * 100}%` }}
          >
            <Chip color={colorOf(s.key)} draft={s.draft} strong={s.key === highlight}>
              On call · {firstName(s.name)}
            </Chip>
          </span>
        ))}
    </div>
  );
}

function Chip({ color, draft, strong, children }: { color: string; draft: boolean; strong: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn("block truncate rounded-sm border-l-[3px] px-1 text-[11px] leading-4", strong && "font-semibold", draft && "border-dashed opacity-70")}
      style={{ backgroundColor: `${color}33`, borderLeftColor: color }}
    >
      {children}
    </span>
  );
}

type Block = { entry: CalendarEntry; from: number; to: number; carried: boolean };

/** The day's shifts as blocks in minutes from midnight; a night shift from the day before carries in from 0. */
function blocksOf(day: string, entries: readonly CalendarEntry[]): (Block & { lane: number; lanes: number })[] {
  const yesterday = addDays(day, -1);
  const blocks: Block[] = [];
  for (const e of entries) {
    if (e.kind !== "shift" || !e.start || !e.end) continue;
    const b = { start: e.start, end: e.end };
    if (e.date === day) blocks.push({ entry: e, from: minutesOf(e.start), to: overnight(b) ? 24 * 60 : minutesOf(e.end), carried: false });
    else if (e.date === yesterday && overnight(b) && minutesOf(e.end) > 0) blocks.push({ entry: e, from: 0, to: minutesOf(e.end), carried: true });
  }
  blocks.sort((a, b) => a.from - b.from || b.to - a.to);
  // Lanes for overlapping blocks; each cluster of overlaps shares its lane count.
  const out: (Block & { lane: number; lanes: number })[] = [];
  let cluster: (Block & { lane: number; lanes: number })[] = [];
  let clusterEnd = -1;
  const close = () => {
    const n = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = n;
    out.push(...cluster);
    cluster = [];
  };
  for (const b of blocks) {
    if (b.from >= clusterEnd && cluster.length > 0) close();
    const used = new Set(cluster.filter((c) => c.to > b.from).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...b, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, b.to);
  }
  if (cluster.length > 0) close();
  return out;
}

function DayView({
  day,
  entries,
  today,
  colorOf,
  highlight,
  onDay,
  onBack,
  footer,
}: {
  day: string;
  entries: readonly CalendarEntry[];
  today: string;
  colorOf: (key: string) => string;
  highlight: string | undefined;
  onDay: (date: string) => void;
  onBack: () => void;
  footer: React.ReactNode;
}) {
  const week = Array.from({ length: 7 }, (_, i) => addDays(scheduleWeekOf(day), i));
  const onCall = entries.filter((e) => e.kind === "onCall" && e.date === day);
  const blocks = blocksOf(day, entries);
  const [y, m] = day.split("-").map(Number) as [number, number];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={onBack}>
          <ChevronLeft aria-hidden className="size-4" />
          {MONTHS[m - 1]} {y}
        </Button>
        <span className="text-sm font-medium">{longDay(day)}</span>
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {week.map((d, i) => (
          <button key={d} type="button" onClick={() => onDay(d)} className="flex flex-col items-center gap-1 py-1" aria-label={longDay(d)} aria-pressed={d === day}>
            <span className="text-muted-foreground">{WEEKDAYS[i]}</span>
            <span
              className={cn(
                "grid size-8 place-items-center rounded-full text-sm tabular-nums",
                d === day ? "bg-foreground font-semibold text-background" : d === today ? "font-semibold text-primary" : "",
              )}
            >
              {Number(d.slice(8))}
            </span>
          </button>
        ))}
      </div>
      <div className="flex gap-2 border-y py-2">
        <span className="w-12 shrink-0 pt-0.5 text-xs text-muted-foreground">All day</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {onCall.length === 0 ? (
            <span className="text-xs text-muted-foreground">Nobody on call.</span>
          ) : (
            onCall.map((e) => (
              <Chip key={e.key} color={colorOf(e.key)} draft={!!e.draft} strong={e.key === highlight}>
                On call · {e.name}
                {e.draft && " (not published)"}
              </Chip>
            ))
          )}
        </div>
      </div>
      <div className="relative" style={{ height: 24 * HOUR_PX }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute inset-x-0 flex border-t border-border/60" style={{ top: h * HOUR_PX }}>
            <span className="-mt-2 w-12 shrink-0 bg-background pr-1 text-right text-[11px] tabular-nums text-muted-foreground">{String(h).padStart(2, "0")}:00</span>
          </div>
        ))}
        <div className="absolute bottom-0 left-14 right-0 top-0">
          {blocks.map((b, i) => {
            const e = b.entry;
            const color = colorOf(e.key);
            const height = Math.max(((b.to - b.from) / 60) * HOUR_PX, 22);
            return (
              <div
                key={i}
                className={cn("absolute overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-xs", e.key === highlight && "font-semibold", e.draft && "border-dashed opacity-70")}
                style={{
                  top: (b.from / 60) * HOUR_PX,
                  height,
                  left: `${(b.lane / b.lanes) * 100}%`,
                  width: `calc(${100 / b.lanes}% - 2px)`,
                  backgroundColor: `${color}40`,
                  borderLeftColor: color,
                }}
              >
                <span className="block truncate">{e.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {timeLabel(e.start!)} – {timeLabel(e.end!)}
                  {b.carried ? " (from the night before)" : overnight({ start: e.start!, end: e.end! }) ? " (next day)" : ""} · {Math.round(blockMinutes({ start: e.start!, end: e.end! }) / 6) / 10} h
                  {e.draft && " · not published"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {footer}
    </div>
  );
}
