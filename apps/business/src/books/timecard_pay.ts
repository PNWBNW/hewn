// ---------------------------------------------------------------------------
// From timecards to a paycheck (Joshua, 2026-10-19): the hours a pay run pays
// are the stretches the team sent, not a number typed by hand. For one team
// member and one pay period, `unpaidHours` gathers every stretch on their
// cards that falls in the period and hasn't been paid; the run pays that
// many hours, and `markPaid` writes the run's id and date on each stretch,
// so it is never paid twice and the card says which paycheck covered it.
// Pure; the vault is the only store.
// ---------------------------------------------------------------------------

import { labelOvertime } from "./hours";
import type { Mailbox, ReceivedEntry, ReceivedHours } from "./mailbox";
import { validateMailbox } from "./mailbox";
import { type Rail, linkFor } from "./rail";
import { type PayRules, payRulesOf } from "./work_week";

/** One stretch to pay, with the card it sits on and its share of regular and overtime minutes. */
export type PayableShift = {
  agreementId: string;
  seq: number;
  weekStart: string;
  date: string;
  in: string;
  out: string;
  minutes: number;
  regular: number;
  overtime: number;
  long?: true;
  /** A callout: kept out of regular and overtime, paid on its own line. */
  callout?: true;
};

/** One callout: its stretches (a callout past midnight is two), the time worked, and what it pays after the minimum. */
export type Callout = { date: string; in: string; out: string; workedMinutes: number; paidMinutes: number };

export type UnpaidHours = {
  minutes: number;
  /** Of those, paid at the rate, and at the overtime rate. */
  regularMinutes: number;
  overtimeMinutes: number;
  /** The overtime multiplier the agreement sets (time and a half without one). */
  overtimeRate: number;
  /** The callouts among the shifts, each paid at least the agreed minimum, at the overtime rate. */
  callouts: Callout[];
  calloutPaidMinutes: number;
  shifts: PayableShift[];
  /** The weeks the shifts come from, first day of each, in order. */
  weeks: string[];
};

/** The rules a team member's hours are paid by, from the work week in their offer's terms (books/work_week.ts). */
export function payRulesFor(rail: Rail | null | undefined, workerId: string): PayRules {
  const terms = rail ? linkFor(rail, workerId)?.terms : undefined;
  return payRulesOf(terms?.version === 2 ? terms.workWeek : undefined);
}

/**
 * Each stretch of a week's card with its regular and overtime minutes, laid against the whole week
 * (paid stretches included). A callout is neither (Joshua, 2026-10-20: always overtime, on its own
 * line), and its time doesn't count toward the week's thresholds.
 */
function labelled(card: ReceivedHours, rules: PayRules): (ReceivedEntry & { regular: number; overtime: number })[] {
  const worked = card.entries.filter((e) => !e.callout);
  const labels = labelOvertime(worked, rules);
  return card.entries.map((e) => (e.callout ? { ...e, regular: 0, overtime: 0 } : { ...e, ...labels[worked.indexOf(e)]! }));
}

/** Callout stretches grouped into callouts (one ending where the next begins is the same callout, split at midnight). */
export function calloutsOf(shifts: readonly PayableShift[], minimumMinutes: number): Callout[] {
  const out: Callout[] = [];
  for (const s of shifts.filter((x) => x.callout).sort((a, b) => (a.in < b.in ? -1 : 1))) {
    const last = out.at(-1);
    if (last && last.out === s.in) {
      last.out = s.out;
      last.workedMinutes += s.minutes;
    } else out.push({ date: s.date, in: s.in, out: s.out, workedMinutes: s.minutes, paidMinutes: 0 });
  }
  for (const c of out) c.paidMinutes = Math.max(c.workedMinutes, minimumMinutes);
  return out;
}

const shiftOf = (card: ReceivedHours, e: ReceivedEntry & { regular: number; overtime: number }): PayableShift => ({
  agreementId: card.agreementId,
  seq: card.seq,
  weekStart: card.weekStart,
  date: e.date,
  in: e.in,
  out: e.out,
  minutes: e.minutes,
  regular: e.regular,
  overtime: e.overtime,
  ...(e.long ? { long: true as const } : {}),
  ...(e.callout ? { callout: true as const } : {}),
});

const inPeriod = (date: string, start: string, end: string) => start <= date && date <= end;

/**
 * The stretches on a team member's cards dated within the period (inclusive)
 * that no pay run has paid, oldest first, each with its share of overtime
 * under `rules` (the whole week counts toward the thresholds, paid or not).
 */
export function unpaidHours(mailbox: Mailbox | null | undefined, workerId: string, periodStart: string, periodEnd: string, rules: PayRules = payRulesOf(undefined)): UnpaidHours {
  const shifts: PayableShift[] = [];
  for (const card of mailbox?.hours ?? []) {
    if (card.workerId !== workerId) continue;
    for (const e of labelled(card, rules)) {
      if (e.paid || !inPeriod(e.date, periodStart, periodEnd)) continue;
      shifts.push(shiftOf(card, e));
    }
  }
  shifts.sort((a, b) => (a.in < b.in ? -1 : a.in > b.in ? 1 : 0));
  const sum = (f: (s: PayableShift) => number) => shifts.reduce((t, s) => t + f(s), 0);
  const callouts = calloutsOf(shifts, rules.calloutMinimumMinutes);
  return {
    minutes: sum((s) => s.minutes),
    regularMinutes: sum((s) => s.regular),
    overtimeMinutes: sum((s) => s.overtime),
    overtimeRate: rules.overtimeRate,
    callouts,
    calloutPaidMinutes: callouts.reduce((t, c) => t + c.paidMinutes, 0),
    shifts,
    weeks: [...new Set(shifts.map((s) => s.weekStart))].sort(),
  };
}

/** Minutes as the hours box takes them: to the hundredth, written the one way ("0.75", "40", "37.5"). */
export function hoursText(minutes: number): string {
  const hundredths = Math.round((minutes / 60) * 100);
  return String(hundredths / 100);
}

const sameStretch = (a: { agreementId: string; seq: number; in: string; out: string }, b: { agreementId: string; seq: number; in: string; out: string }) =>
  a.agreementId === b.agreementId && a.seq === b.seq && a.in === b.in && a.out === b.out;

/** Writes the pay run on each stretch it paid. A stretch already paid, or not found, is left as it is. */
export function markPaid(mailbox: Mailbox, shifts: readonly PayableShift[], runId: string, payDate: string): Mailbox {
  if (!runId) throw new Error("A pay run needs an id");
  const hours: ReceivedHours[] = mailbox.hours.map((card) => {
    const mine = shifts.filter((s) => s.agreementId === card.agreementId && s.seq === card.seq);
    if (mine.length === 0) return card;
    const entries: ReceivedEntry[] = card.entries.map((e) => (!e.paid && mine.some((s) => sameStretch(s, { ...e, agreementId: card.agreementId, seq: card.seq })) ? { ...e, paid: { runId, payDate } } : e));
    return { ...card, entries };
  });
  return validateMailbox({ ...mailbox, hours });
}

/** The stretches a pay run paid, per team member: what a paycheck's hours were made of. */
export function paidByRun(mailbox: Mailbox | null | undefined, runId: string, rules: PayRules = payRulesOf(undefined)): Map<string, PayableShift[]> {
  const by = new Map<string, PayableShift[]>();
  for (const card of mailbox?.hours ?? []) {
    for (const e of labelled(card, rules)) {
      if (e.paid?.runId !== runId) continue;
      const list = by.get(card.workerId) ?? [];
      list.push(shiftOf(card, e));
      by.set(card.workerId, list);
    }
  }
  for (const list of by.values()) list.sort((a, b) => (a.in < b.in ? -1 : a.in > b.in ? 1 : 0));
  return by;
}

/** "45m across 2 shifts, week of Oct 19" in the pieces a screen puts together: the count and the weeks. */
export const shiftCount = (n: number): string => (n === 1 ? "1 shift" : `${n} shifts`);
