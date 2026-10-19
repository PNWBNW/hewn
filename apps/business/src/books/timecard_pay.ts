// ---------------------------------------------------------------------------
// From timecards to a paycheck (Joshua, 2026-10-19): the hours a pay run pays
// are the stretches the team sent, not a number typed by hand. For one team
// member and one pay period, `unpaidHours` gathers every stretch on their
// cards that falls in the period and hasn't been paid; the run pays that
// many hours, and `markPaid` writes the run's id and date on each stretch,
// so it is never paid twice and the card says which paycheck covered it.
// Pure; the vault is the only store.
// ---------------------------------------------------------------------------

import type { Mailbox, ReceivedEntry, ReceivedHours } from "./mailbox";
import { validateMailbox } from "./mailbox";

/** One stretch to pay, with the card it sits on. */
export type PayableShift = { agreementId: string; seq: number; weekStart: string; date: string; in: string; out: string; minutes: number; long?: true };

export type UnpaidHours = {
  minutes: number;
  shifts: PayableShift[];
  /** The weeks the shifts come from, first day of each, in order. */
  weeks: string[];
};

const inPeriod = (date: string, start: string, end: string) => start <= date && date <= end;

/** The stretches on a team member's cards dated within the period (inclusive) that no pay run has paid, oldest first. */
export function unpaidHours(mailbox: Mailbox | null | undefined, workerId: string, periodStart: string, periodEnd: string): UnpaidHours {
  const shifts: PayableShift[] = [];
  for (const card of mailbox?.hours ?? []) {
    if (card.workerId !== workerId) continue;
    for (const e of card.entries) {
      if (e.paid || !inPeriod(e.date, periodStart, periodEnd)) continue;
      shifts.push({ agreementId: card.agreementId, seq: card.seq, weekStart: card.weekStart, date: e.date, in: e.in, out: e.out, minutes: e.minutes, ...(e.long ? { long: true as const } : {}) });
    }
  }
  shifts.sort((a, b) => (a.in < b.in ? -1 : a.in > b.in ? 1 : 0));
  return { minutes: shifts.reduce((t, s) => t + s.minutes, 0), shifts, weeks: [...new Set(shifts.map((s) => s.weekStart))].sort() };
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
export function paidByRun(mailbox: Mailbox | null | undefined, runId: string): Map<string, PayableShift[]> {
  const by = new Map<string, PayableShift[]>();
  for (const card of mailbox?.hours ?? []) {
    for (const e of card.entries) {
      if (e.paid?.runId !== runId) continue;
      const list = by.get(card.workerId) ?? [];
      list.push({ agreementId: card.agreementId, seq: card.seq, weekStart: card.weekStart, date: e.date, in: e.in, out: e.out, minutes: e.minutes, ...(e.long ? { long: true as const } : {}) });
      by.set(card.workerId, list);
    }
  }
  for (const list of by.values()) list.sort((a, b) => (a.in < b.in ? -1 : a.in > b.in ? 1 : 0));
  return by;
}

/** "45m across 2 shifts, week of Oct 19" in the pieces a screen puts together: the count and the weeks. */
export const shiftCount = (n: number): string => (n === 1 ? "1 shift" : `${n} shifts`);
