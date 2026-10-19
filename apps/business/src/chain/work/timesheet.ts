// ---------------------------------------------------------------------------
// Sending a week to the employer as a letter on chain (chain/letters.ts; one
// Shield approval): the timesheet payload (books/hours.ts), deflated when
// that's smaller, sealed with the agreement's parties key under the
// `timesheet` kind, for the next unused slot shared with that employer.
// `timesheet` is not among the kinds the mailbox package names, which is a
// package the person's side may not edit.
//
// A slot already sent under counts as sent: only this person can have
// filled it, with this same week. Anything else throws and the vault is
// untouched. Nothing here logs a key, a lookup or an hour.
// ---------------------------------------------------------------------------

import { MailboxError, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { type TimesheetPayload, buildTimesheet, timecardPunchIds } from "../../books/hours";
import { type SentTimesheet, type Work, WorkError, agreementFor, nextWorkSeq } from "../../books/work";
import { packPayload } from "../compress";

export const TIMESHEET_KIND = "timesheet";

export type SendInput = {
  work: Work;
  agreementId: string;
  /** The first day of the work week, YYYY-MM-DD. */
  weekStart: string;
  /** A letter box to the employer (chain/letters.ts); a fake with `put` does for tests. */
  client: { put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string; feeMode?: FeeMode }): Promise<unknown> };
  /** How the letter's fee is paid; the device's switch when left out. */
  feeMode?: FeeMode;
  now?: () => Date;
};

export type SendResult = { sent: SentTimesheet; payload: TimesheetPayload; slotTaken: boolean };

/** Seals the week and sends it to the employer; the caller records `sent` in the vault. */
export async function sendTimesheet({ work, agreementId, weekStart, client, now, feeMode }: SendInput): Promise<SendResult> {
  const agreement = agreementFor(work, agreementId);
  if (!agreement) throw new WorkError("No agreement with that id");
  if (agreement.status !== "active") throw new WorkError("This agreement isn't active");
  const at = (now ?? (() => new Date()))();
  const payload = buildTimesheet(work, agreementId, weekStart, at);
  const seq = nextWorkSeq(work, agreementId, "timesheet");
  const key = partiesKeyFromHex(agreement.partiesKey);
  let sealed;
  try {
    sealed = await seal(key, TIMESHEET_KIND, seq, await packPayload(new TextEncoder().encode(JSON.stringify(payload))));
  } finally {
    key.fill(0);
  }
  let slotTaken = false;
  try {
    await (feeMode ? client.put(sealed.lookup, sealed.envelope, { feeMode }) : client.put(sealed.lookup, sealed.envelope));
  } catch (e) {
    if (e instanceof MailboxError && e.code === "CONFLICT") slotTaken = true;
    else throw e;
  }
  const sent: SentTimesheet = { agreementId, weekStart, seq, lookup: sealed.lookup, totalMinutes: payload.totalMinutes, sentAt: payload.sentAt, punchIds: timecardPunchIds(work, agreementId, weekStart, at) };
  return { sent, payload, slotTaken };
}
