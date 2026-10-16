// ---------------------------------------------------------------------------
// How long the mailbox keeps a document nobody collects (Joshua, 2026-10-16).
//
// The mailbox is a drop box, not an archive: the receiver's app keeps its
// copy in its vault and drops the pin. What happens to a pin nobody ever
// collects depends on what it is:
//
// - Records people depend on (a paystub, a W-4, a week of hours, a payment
//   note, an accepted agreement's terms) carry no date and stay until
//   collected. Nothing deletes them on its own.
// - A document that only matters for a while (an offer, which expires; a
//   receipt; later a counter-offer or a message) carries a "keep until" day.
//   The sender sets it; the server keeps it beside the pin and, once the day
//   has passed, a daily sweep unpins it.
//
// The day is all the server learns: a calendar date, never a kind or a party.
// Pure: no I/O.
// ---------------------------------------------------------------------------

import { MailboxError } from "./envelope";

/** A keep-until day: YYYY-MM-DD, in UTC. */
export const KEEP_UNTIL_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** The longest a pin may ask to be kept: an offer's longest window (30 days) with room to spare. */
export const MAX_KEEP_DAYS = 60;
/** Receipts: long enough for a sender who checks once a month. */
export const RECEIPT_KEEP_DAYS = 60;
/** Messages that don't need keeping (counter-offers, notes): unopened ones go after 30 days. */
export const MESSAGE_KEEP_DAYS = 30;

const DAY_MS = 86_400_000;

/** The UTC calendar day of a time, YYYY-MM-DD. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/** The day `days` after `from` (UTC). */
export function keepUntilAfter(from: Date, days: number): string {
  if (!Number.isInteger(days) || days < 0 || days > MAX_KEEP_DAYS) {
    throw new MailboxError("BAD_KEEP_UNTIL", `A document can be kept at most ${MAX_KEEP_DAYS} days`);
  }
  return utcDay(new Date(from.getTime() + days * DAY_MS));
}

/**
 * Checks a keep-until day against today: a real date, not already past,
 * at most MAX_KEEP_DAYS ahead. Returns it unchanged.
 */
export function checkKeepUntil(value: unknown, today: Date): string {
  if (typeof value !== "string" || !KEEP_UNTIL_PATTERN.test(value) || utcDay(new Date(`${value}T00:00:00.000Z`)) !== value) {
    throw new MailboxError("BAD_KEEP_UNTIL", "A keep-until day is YYYY-MM-DD");
  }
  if (value < utcDay(today)) throw new MailboxError("BAD_KEEP_UNTIL", "That keep-until day has already passed");
  if (value > keepUntilAfter(today, MAX_KEEP_DAYS)) throw new MailboxError("BAD_KEEP_UNTIL", `A document can be kept at most ${MAX_KEEP_DAYS} days`);
  return value;
}

/** True once a pin kept until `keepUntil` may be swept: the whole day has passed. */
export const isPastKeep = (keepUntil: string, today: Date): boolean => keepUntil < utcDay(today);
