// ---------------------------------------------------------------------------
// Sending a week to the employer through the mailbox: the timesheet payload
// (books/hours.ts) sealed with the agreement's parties key under the
// `timesheet` kind, in the next unused slot shared with that employer. The
// mailbox takes any lower-case kind; `timesheet` is not among the kinds the
// mailbox package names, which is a package the person's side may not edit.
//
// A slot already taken (409) counts as sent: only this person can have
// filled it, with this same week. Anything else throws and the vault is
// untouched. Nothing here logs a key, a lookup or an hour.
// ---------------------------------------------------------------------------

import { MailboxError, type MailboxClient, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { type TimesheetPayload, buildTimesheet } from "../../books/hours";
import { type SentTimesheet, type Work, WorkError, agreementFor, nextWorkSeq } from "../../books/work";

export const TIMESHEET_KIND = "timesheet";

export type SendInput = {
  work: Work;
  agreementId: string;
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  client: Pick<MailboxClient, "put">;
  now?: () => Date;
};

export type SendResult = { sent: SentTimesheet; payload: TimesheetPayload; slotTaken: boolean };

export const isMailboxOff = (e: unknown): boolean => e instanceof MailboxError && e.code === "NOT_CONFIGURED";

/** Seals the week and puts it in the employer's mailbox; the caller records `sent` in the vault. */
export async function sendTimesheet({ work, agreementId, weekStart, client, now }: SendInput): Promise<SendResult> {
  const agreement = agreementFor(work, agreementId);
  if (!agreement) throw new WorkError("No agreement with that id");
  if (agreement.status !== "active") throw new WorkError("This agreement isn't active");
  const at = (now ?? (() => new Date()))();
  const payload = buildTimesheet(work, agreementId, weekStart, at);
  const seq = nextWorkSeq(work, agreementId, "timesheet");
  const key = partiesKeyFromHex(agreement.partiesKey);
  let sealed;
  try {
    sealed = await seal(key, TIMESHEET_KIND, seq, new TextEncoder().encode(JSON.stringify(payload)));
  } finally {
    key.fill(0);
  }
  let slotTaken = false;
  try {
    await client.put(sealed.lookup, sealed.envelope);
  } catch (e) {
    if (e instanceof MailboxError && e.code === "CONFLICT") slotTaken = true;
    else throw e;
  }
  const sent: SentTimesheet = { agreementId, weekStart, seq, lookup: sealed.lookup, totalMinutes: payload.totalMinutes, sentAt: payload.sentAt };
  return { sent, payload, slotTaken };
}
