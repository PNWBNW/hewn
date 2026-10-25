// ---------------------------------------------------------------------------
// A paystub's place in its year, for the card's log of rings (docs/HEWN_ART.md):
// which paycheck of the year this is, and how many the year holds. Each side
// counts from what it holds: the person from the paystubs that arrived from
// the same agreement, the business from its own pay runs. Nothing here reads
// an amount: the count comes from dates, and the rings' widths from the
// paystub's hash. Pure.
// ---------------------------------------------------------------------------

import { type PayFrequency, type PayRun, type Payroll, perYear } from "@pnw/payroll";
import { paystubFromCanonical } from "./paystub_document";
import type { ReceivedPaystub } from "./work";

export type RingPlace = {
  /** This paycheck's number in its calendar year, from 1. */
  n: number;
  /** Paychecks in the year, never fewer than `n`. */
  of: number;
};

const DAY = 24 * 3600 * 1000;

/**
 * Paychecks a year, from the pay period's length (a received paystub carries its dates, not the
 * schedule): weekly periods run to 10 days, two-week ones 11 to 14, half-month ones 15 to 20 (and
 * a February 16th to the 28th), anything longer a month.
 */
export function paychecksAYear(periodStart: string, periodEnd: string): number {
  const days = Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / DAY) + 1;
  if (!Number.isFinite(days) || days <= 0) return 26;
  if (days <= 10) return 52;
  if (days === 13 || (days >= 15 && days <= 20)) return 24;
  if (days <= 14) return 26;
  return 12;
}

/** Which paycheck of its calendar year a pay date is, counting the earlier dates of that year in `payDates`. */
export function paycheckNumber(payDate: string, payDates: readonly string[]): number {
  const year = payDate.slice(0, 4);
  return 1 + payDates.filter((d) => d.slice(0, 4) === year && d < payDate).length;
}

const place = (n: number, of: number): RingPlace => ({ n, of: Math.max(of, n) });

const readDoc = (p: ReceivedPaystub) => {
  try {
    return paystubFromCanonical(p.document);
  } catch {
    return null;
  }
};

/** A received paystub's place among the ones from the same agreement; null when it can't be read. */
export function receivedPlace(paystub: ReceivedPaystub, all: readonly ReceivedPaystub[]): RingPlace | null {
  const doc = readDoc(paystub);
  if (!doc) return null;
  const dates = all.filter((p) => p.agreementId === paystub.agreementId).flatMap((p) => readDoc(p)?.payDate ?? []);
  return place(paycheckNumber(doc.payDate, dates), paychecksAYear(doc.periodStart, doc.periodEnd));
}

/** A paycheck's place in the business's own runs for this person, at their pay frequency. */
export function runPlace(payroll: Pick<Payroll, "runs">, workerId: string, run: Pick<PayRun, "payDate">, frequency: PayFrequency): RingPlace {
  const dates = payroll.runs.filter((r) => r.paychecks.some((p) => p.workerId === workerId)).map((r) => r.payDate);
  return place(paycheckNumber(run.payDate, dates), perYear(frequency));
}
