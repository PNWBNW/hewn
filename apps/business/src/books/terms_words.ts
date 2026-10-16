// ---------------------------------------------------------------------------
// How an offer's terms put pay and dates into words. One definition for the
// draft the business starts from (chain/agreement_draft.ts) and for keeping
// those words in step when a counter-offer changes the pay or the start
// date (books/thread.ts). Pure.
// ---------------------------------------------------------------------------

import { formatCents } from "@pnw/ledger";
import { PAY_FREQUENCIES, type PayFrequency, type Worker } from "@pnw/payroll";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-11-02` as `November 2, 2026`; anything else comes back as typed. */
export function longDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : date;
}

/** What each paycheck is for, in a few words: "$30.00 an hour, paid every two weeks". */
export function payLine(payType: Worker["payType"], rate: bigint, frequency: PayFrequency): string {
  const label = PAY_FREQUENCIES.find((f) => f.id === frequency)?.label.toLowerCase() ?? frequency;
  const amount = `$${formatCents(rate)}`;
  return payType === "hourly" ? `${amount} an hour, paid ${label}` : `${amount} a year, paid ${label}`;
}
