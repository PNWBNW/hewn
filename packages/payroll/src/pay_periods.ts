// ---------------------------------------------------------------------------
// Each person's own pay period (docs/PAY_PERIODS.md).
//
// A person's next pay period starts the day after the last day any of their
// paychecks covers, settled, pending or failed: a pending payment may still
// land, and a failed one is paid by its own Retry. It is one period of their
// pay frequency:
//
//   weekly           seven days from that day
//   every two weeks  fourteen days from that day
//   twice a month    to the 15th, or to the month's last day; then the 1st to
//                    the 15th and the 16th to the end
//   monthly          to the month's last day; then calendar months
//
// A leftover shorter than seven days (fourteen, monthly) joins the next half
// or month, so no paycheck pays for a few odd days on their own.
//
// A period is due on a pay date when it ends on or before it. Missed periods
// are each their own paycheck, oldest first, at most the twelve most recent;
// those that ended more than 31 days before the pay date start unticked. When
// nothing is due, the next period is offered, unticked, for paying ahead.
//
// Someone never paid joins their teammates: weekly and every-two-weeks people
// take the period most of the team on that frequency is paid for, with pay
// counted from their start date; twice a month and monthly follow the
// calendar.
//
// Pure and deterministic: dates are UTC calendar days ("YYYY-MM-DD"), worked
// out from the history every time, so two devices with the same books get the
// same periods. Nothing here is stored.
// ---------------------------------------------------------------------------

import type { IsoDate } from "@pnw/ledger";
import { PayrollError } from "./errors";
import type { PayFrequency, Payroll } from "./payroll";

/** A pay period's first and last day, both counted: the same fields a pay run carries. */
export type PeriodDates = { periodStart: IsoDate; periodEnd: IsoDate };

/** One period from a given day; `folded` when a leftover too short to pay on its own joined the next half or month. */
export type PeriodFrom = PeriodDates & { folded: boolean };

/**
 * The longest one period of each frequency can be, in days, both ends counted: a week, two weeks,
 * and a half or a month with a short leftover folded in (Jan 10 to 31; Jul 19 to Aug 31).
 */
export const LONGEST_PERIOD_DAYS: Readonly<Record<PayFrequency, number>> = Object.freeze({ weekly: 7, biweekly: 14, semimonthly: 22, monthly: 44 });

/** At most this many due periods are listed for one person; the earlier ones are counted. */
const LISTED = 12;
/** A due period that ended more than this many days before the pay date starts unticked. */
const LONG_AGO_DAYS = 31;
/** A leftover shorter than this joins the next half (twice a month) or month (monthly). */
const SHORTEST_LEFTOVER: Partial<Record<PayFrequency, number>> = { semimonthly: 7, monthly: 14 };

// ---- Calendar days -----------------------------------------------------------
// Inside this module a day is a whole number: days since 1970-01-01, UTC.

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads a "YYYY-MM-DD" date, refusing anything else with a payroll error that names what it was. */
function dayOf(date: unknown, what: string): number {
  const m = typeof date === "string" ? DATE.exec(date) : null;
  if (!m) throw new PayrollError(`${what} isn't a date (YYYY-MM-DD): ${JSON.stringify(date ?? null)}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const probe = new Date(t);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new PayrollError(`${what} isn't a day on the calendar: "${date}"`);
  }
  return t / DAY_MS;
}

/** A day as "YYYY-MM-DD"; the books hold the years 100 to 9999 (the ledger reads no others). */
function isoOf(day: number): IsoDate {
  const iso = new Date(day * DAY_MS).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso) || iso < "0100") throw new PayrollError("Those pay periods run past the dates the books can hold");
  return iso.slice(0, 10);
}

/** Year, month (1 to 12) and day of the month. */
function partsOf(day: number): [number, number, number] {
  const d = new Date(day * DAY_MS);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/**
 * The day `date` of month `month` (1-based; 13 is next January, day 0 the last of the month
 * before). Built with setUTCFullYear, not Date.UTC, which reads the years 0 to 99 as 1900 to 1999.
 */
function dayIn(year: number, month: number, date: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, date);
  return t.getTime() / DAY_MS;
}
/** The last day of month `month` (1-based; 13 is next January). */
const monthEnd = (year: number, month: number) => dayIn(year, month + 1, 0);

function knownFrequency(frequency: unknown): PayFrequency {
  if (typeof frequency !== "string" || !Object.prototype.hasOwnProperty.call(LONGEST_PERIOD_DAYS, frequency)) {
    throw new PayrollError(`Unknown pay frequency: ${JSON.stringify(frequency ?? null)}`);
  }
  return frequency as PayFrequency;
}

const isCalendar = (f: PayFrequency) => f === "semimonthly" || f === "monthly";
/** Weekly and every two weeks: the length every period has. */
const rhythmLength = (f: PayFrequency) => (f === "weekly" ? 7 : 14);

type Span = { start: number; end: number; folded: boolean };

/** One period of `f` from day `s`. */
function spanFrom(f: PayFrequency, s: number): Span {
  if (!isCalendar(f)) return { start: s, end: s + rhythmLength(f) - 1, folded: false };
  const [y, m, d] = partsOf(s);
  const end = f === "monthly" || d > 15 ? monthEnd(y, m) : dayIn(y, m, 15);
  const onCalendar = d === 1 || (f === "semimonthly" && d === 16);
  if (onCalendar || end - s + 1 >= SHORTEST_LEFTOVER[f]!) return { start: s, end, folded: false };
  // Too short to pay on its own: it joins the next half or month.
  const next = f === "monthly" ? monthEnd(y, m + 1) : d <= 15 ? monthEnd(y, m) : dayIn(y, m + 1, 15);
  return { start: s, end: next, folded: true };
}

/** The calendar half or month that holds day `x`. */
function calendarHolding(f: PayFrequency, x: number): Span {
  const [y, m, d] = partsOf(x);
  if (f === "monthly") return { start: dayIn(y, m, 1), end: monthEnd(y, m), folded: false };
  return d <= 15 ? { start: dayIn(y, m, 1), end: dayIn(y, m, 15), folded: false } : { start: dayIn(y, m, 16), end: monthEnd(y, m), folded: false };
}

/** The latest calendar half or month that ends on or before day `x`. */
function calendarEndingBy(f: PayFrequency, x: number): Span {
  const holding = calendarHolding(f, x);
  return holding.end <= x ? holding : calendarHolding(f, holding.start - 1);
}

/** The period of a weekly or two-weekly rhythm (one of whose periods ends on `anchor`) that holds day `x`. */
function rhythmHolding(f: PayFrequency, anchor: number, x: number): Span {
  const n = rhythmLength(f);
  const start = anchor + 1 + Math.floor((x - anchor - 1) / n) * n;
  return { start, end: start + n - 1, folded: false };
}

/** The latest period of that rhythm that ends on or before day `x`. */
function rhythmEndingBy(f: PayFrequency, anchor: number, x: number): Span {
  const n = rhythmLength(f);
  const end = anchor + Math.floor((x - anchor) / n) * n;
  return { start: end - n + 1, end, folded: false };
}

// ---- One period ----------------------------------------------------------------

/**
 * One pay period of `frequency` starting on `start`. Weekly and every two weeks run seven and
 * fourteen days from it. Twice a month runs to the 15th, or to the month's last day after the
 * 15th; monthly runs to the month's last day. Such a leftover shorter than seven days (fourteen,
 * monthly) joins the next half or month: from Feb 15 twice a month is Feb 15 to 28, and from
 * Oct 31 monthly is Oct 31 to Nov 30. The period after any of these starts on the calendar.
 */
export function periodFrom(frequency: PayFrequency, start: IsoDate): PeriodFrom {
  const f = knownFrequency(frequency);
  const s = spanFrom(f, dayOf(start, "A pay period's first day"));
  return { periodStart: isoOf(s.start), periodEnd: isoOf(s.end), folded: s.folded };
}

// ---- What has been paid ------------------------------------------------------------

type Covered = { runId: string; payDate: IsoDate; periodStart: IsoDate; periodEnd: IsoDate; start: number; end: number; status: string };

/** Every paycheck of one person, with the days its run covers; a period that can't be read is refused, not skipped. */
function coveredBy(payroll: Pick<Payroll, "runs">, workerId: string): Covered[] {
  const out: Covered[] = [];
  for (const run of payroll.runs) {
    for (const p of run.paychecks) {
      if (p.workerId !== workerId) continue;
      const start = dayOf(run.periodStart, `The pay period of the run of ${run.payDate}`);
      const end = dayOf(run.periodEnd, `The pay period of the run of ${run.payDate}`);
      if (end < start) throw new PayrollError(`The pay period of the run of ${run.payDate} ends before it starts`);
      out.push({ runId: run.id, payDate: run.payDate, periodStart: run.periodStart, periodEnd: run.periodEnd, start, end, status: p.settlement.status });
    }
  }
  return out;
}

function lastCovered(covered: readonly Covered[]): number | undefined {
  return covered.length === 0 ? undefined : Math.max(...covered.map((c) => c.end));
}

/**
 * The last day any of this person's paychecks covers, or undefined when they've never been paid.
 * Every paycheck counts, in any mode and whatever its payment status: settled; pending, because it
 * may still land; failed, because its own Retry pays those days; and one with nothing to pay.
 * Overlapping periods (the old two-week default paid weekly people in windows a week apart)
 * simply join up: the latest last day is what counts.
 */
export function paidThrough(payroll: Pick<Payroll, "runs">, workerId: string): IsoDate | undefined {
  const last = lastCovered(coveredBy(payroll, workerId));
  return last === undefined ? undefined : isoOf(last);
}

/** The day ending one period of the rhythm most of the team on `f` keeps, or undefined. */
function teamAnchor(payroll: Pick<Payroll, "runs" | "workers">, f: PayFrequency, except?: string): number | undefined {
  if (isCalendar(f)) return undefined;
  const n = rhythmLength(f);
  // People whose last periods end a whole number of periods apart keep the same rhythm.
  const rhythms = new Map<number, { people: number; latest: number }>();
  for (const w of payroll.workers) {
    if (!w.active || w.frequency !== f || w.id === except) continue;
    const last = lastCovered(coveredBy(payroll, w.id));
    if (last === undefined) continue;
    const key = ((last % n) + n) % n;
    const seen = rhythms.get(key);
    rhythms.set(key, { people: (seen?.people ?? 0) + 1, latest: Math.max(seen?.latest ?? last, last) });
  }
  let best: { people: number; latest: number } | undefined;
  for (const r of rhythms.values()) {
    if (!best || r.people > best.people || (r.people === best.people && r.latest > best.latest)) best = r;
  }
  return best?.latest;
}

/**
 * The weekly or every-two-weeks rhythm a new hire on `frequency` joins: the last day of a period
 * that most active people on that frequency were paid through (people whose last periods are whole
 * periods apart keep one rhythm), ties going to the latest. Undefined when nobody else on that
 * frequency has been paid, and for twice a month and monthly, which follow the calendar.
 * `except` leaves one person out (the one being placed).
 */
export function teamRhythm(payroll: Pick<Payroll, "runs" | "workers">, frequency: PayFrequency, except?: string): IsoDate | undefined {
  const anchor = teamAnchor(payroll, knownFrequency(frequency), except);
  return anchor === undefined ? undefined : isoOf(anchor);
}

// ---- What is due ---------------------------------------------------------------------

export type DuePeriodsOptions = {
  /**
   * When they started: their offer's start date. Places the first period of someone never paid,
   * and their first paycheck counts from it. Once they've been paid, their history decides.
   */
  startDate?: IsoDate;
  /**
   * The first day they're owed pay (a "Pay starts" date the business sets): no period ending
   * before it is offered, and the period it falls in counts pay from it. For someone never paid it
   * also places their first period, ahead of the start date.
   */
  floor?: IsoDate;
  /**
   * The first day this payroll pays them for, when the business moved it ("Owed from"): their
   * periods follow from it instead of from what was paid. It can't reach back over a paycheck that
   * failed: that one is paid by its own Retry.
   */
  owedFrom?: IsoDate;
  /** A revised offer changed their pay frequency since their last paycheck: the next period starts one of the new frequency, with no question asked. */
  frequencyChanged?: boolean;
};

/** One period offered for a person, as a line they can be paid for. */
export type DuePeriod = PeriodDates & {
  /** It ends on or before the pay date. The one period that isn't due is the next, offered only when nothing is. */
  due: boolean;
  /** Paid unless someone unticks it: due, not long ago, and not a salaried bridge. */
  ticked: boolean;
  /** Due, and not the latest due period: a payday passed without it. */
  missed: boolean;
  /** A leftover too short to pay on its own joined the next half or month. */
  folded: boolean;
  /**
   * Twice a month or monthly, the first period after a paycheck that didn't end on the calendar
   * (the 15th or the month's end), long enough not to fold. That last paycheck paid a full half or
   * month whatever its dates, so a salaried person's bridge starts unticked: only the business
   * knows whether those days are owed. An hourly person's is ticked: their hours say.
   */
  bridge: boolean;
  /** Ended more than 31 days before the pay date, so it starts unticked (back from leave, seasonal work). */
  longAgo: boolean;
  /** Pay counts from this day, inside the period: a first paycheck from a start date, or from Pay starts. */
  paysFrom?: IsoDate;
};

/** Where the first period worked out for a person came from. */
export type PeriodBasis =
  /** The day after the last day their paychecks cover. */
  | "paid"
  /** The day the business chose ("Owed from"). */
  | "owedFrom"
  /** Never paid: the period their teammates on that frequency are paid for. */
  | "team"
  /** Never paid: from their start date (nobody else on a weekly or two-weekly frequency, or the calendar). */
  | "start"
  /** Never paid, no start date known: the latest whole period ending on or before the pay date. */
  | "payDate";

/** A paycheck of theirs whose payment isn't settled: its days count as paid all the same. */
export type UnsettledPaycheck = PeriodDates & { runId: string; payDate: IsoDate; status: "pending" | "failed" };

export type DuePeriods = {
  workerId: string;
  frequency: PayFrequency;
  /** The last day their paychecks cover; absent when never paid. */
  paidThrough?: IsoDate;
  basis: PeriodBasis;
  frequencyChanged: boolean;
  /** Oldest first: the due periods (at most 12, the most recent), or the next one when nothing is due. */
  periods: DuePeriod[];
  /** Due periods before those listed, left off the list. */
  earlier: number;
  /** The first day of the oldest of those. */
  earlierFrom?: IsoDate;
  /** Their paychecks not settled yet, oldest period first. */
  unsettled: UnsettledPaycheck[];
};

/**
 * The pay periods one person is owed on a pay date. Their periods start the day after the last
 * day their paychecks cover (`paidThrough`), or on "Owed from" when the business moved it, and
 * follow one another at their pay frequency (`periodFrom`). Someone never paid joins their
 * teammates on the same weekly or two-weekly frequency, or the calendar, from their start date.
 *
 * Every period ending on or before the pay date is due, each its own paycheck: the 12 most recent
 * are listed oldest first, and the earlier ones counted. Due periods are ticked, except those that
 * ended more than 31 days before the pay date and a salaried bridge. When nothing is due, the next
 * period is offered unticked, for a business that pays ahead.
 */
export function duePeriods(payroll: Pick<Payroll, "runs" | "workers">, workerId: string, payDate: IsoDate, options: DuePeriodsOptions = {}): DuePeriods {
  const worker = payroll.workers.find((w) => w.id === workerId);
  if (!worker) throw new PayrollError("Team member not found");
  const f = knownFrequency(worker.frequency);
  const pay = dayOf(payDate, "The pay date");
  const startDate = options.startDate === undefined ? undefined : dayOf(options.startDate, "The start date");
  const floor = options.floor === undefined ? undefined : dayOf(options.floor, "Pay starts");
  const owedFrom = options.owedFrom === undefined ? undefined : dayOf(options.owedFrom, "Owed from");
  if (options.frequencyChanged !== undefined && typeof options.frequencyChanged !== "boolean") {
    throw new PayrollError("Whether their pay frequency changed must be yes or no");
  }
  const frequencyChanged = options.frequencyChanged === true;

  const covered = coveredBy(payroll, worker.id);
  const through = lastCovered(covered);

  // Where their first period starts.
  let first: Span;
  let basis: PeriodBasis;
  /** For someone never paid, the day their pay counts from. */
  let begins: number | undefined;
  if (owedFrom !== undefined) {
    first = spanFrom(f, owedFrom);
    basis = "owedFrom";
  } else if (through !== undefined) {
    first = spanFrom(f, through + 1);
    basis = "paid";
  } else {
    begins = floor ?? startDate;
    const anchor = teamAnchor(payroll, f, worker.id);
    if (anchor !== undefined) {
      basis = "team";
      first = begins !== undefined ? rhythmHolding(f, anchor, begins) : rhythmEndingBy(f, anchor, pay);
    } else if (begins !== undefined) {
      basis = "start";
      first = isCalendar(f) ? calendarHolding(f, begins) : spanFrom(f, begins);
    } else {
      basis = "payDate";
      first = isCalendar(f) ? calendarEndingBy(f, pay) : { start: pay - rhythmLength(f) + 1, end: pay, folded: false };
    }
  }
  const countsFrom = begins ?? floor;

  // Walk the periods from there: the due ones (keeping the most recent), then the next.
  const listed: Span[] = [];
  let dueCount = 0;
  let oldestDue: number | undefined;
  let next: Span | undefined;
  for (let p = first; ; p = spanFrom(f, p.end + 1)) {
    if (floor !== undefined && p.end < floor) continue;
    if (p.end > pay) {
      next = p;
      break;
    }
    dueCount++;
    oldestDue ??= p.start;
    listed.push(p);
    if (listed.length > LISTED) listed.shift();
  }
  const spans = listed.length > 0 ? listed : [next!];

  // Owed from can't reach back over a paycheck that failed: its own Retry pays those days.
  if (basis === "owedFrom") {
    const reach = spans[spans.length - 1]!.end;
    const failed = covered.filter((c) => c.status === "failed" && c.start <= reach && owedFrom! <= c.end).sort((a, b) => a.start - b.start)[0];
    if (failed) {
      throw new PayrollError(
        `${worker.name}'s paycheck for ${failed.periodStart} to ${failed.periodEnd} (run of ${failed.payDate}) failed. Retry it from that run in Pay runs: a new paycheck for those days isn't posted while that one can still be paid.`,
      );
    }
  }

  // A bridge: twice a month or monthly, the first period after paychecks that didn't end on the calendar.
  const firstDay = partsOf(first.start)[2];
  const offCalendar = firstDay !== 1 && !(f === "semimonthly" && firstDay === 16);
  const bridgeStart = basis === "paid" && isCalendar(f) && offCalendar && !first.folded && !frequencyChanged ? first.start : undefined;
  const periods: DuePeriod[] = spans.map((s, i) => {
    const due = s.end <= pay;
    const longAgo = due && pay - s.end > LONG_AGO_DAYS;
    const bridge = s.start === bridgeStart;
    const paysFrom = countsFrom !== undefined && countsFrom > s.start && countsFrom <= s.end ? isoOf(countsFrom) : undefined;
    return {
      periodStart: isoOf(s.start),
      periodEnd: isoOf(s.end),
      due,
      ticked: due && !longAgo && !(bridge && worker.payType === "salary"),
      missed: due && i < spans.length - 1,
      folded: s.folded,
      bridge,
      longAgo,
      ...(paysFrom ? { paysFrom } : {}),
    };
  });

  const earlier = dueCount - listed.length;
  const unsettled: UnsettledPaycheck[] = covered
    .filter((c): c is Covered & { status: "pending" | "failed" } => c.status === "pending" || c.status === "failed")
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((c) => ({ runId: c.runId, payDate: c.payDate, periodStart: c.periodStart, periodEnd: c.periodEnd, status: c.status }));
  return {
    workerId: worker.id,
    frequency: f,
    ...(through !== undefined ? { paidThrough: isoOf(through) } : {}),
    basis,
    frequencyChanged,
    periods,
    earlier,
    ...(earlier > 0 ? { earlierFrom: isoOf(oldestDue!) } : {}),
    unsettled,
  };
}
