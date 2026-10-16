// ---------------------------------------------------------------------------
// Receipts (Joshua, 2026-10-16): the sender learns when the other side's app
// has picked a document up. The receiver seals a small receipt when it
// collects an offer, a paystub or a week of hours (@pnw/mailbox
// sealReceipt); the sender, on its next mailbox check, reads the receipts for
// what it sent and hasn't heard back about, keeps the time in its vault, and
// drops them.
//
// What each side waits on:
//   business: offers still waiting  → the offer's own kind, slot 0
//             paystubs delivered     → kind paystub, the delivery's slot
//   person:   weeks of hours sent    → kind timesheet, the week's slot
//
// Receipts are best effort on both ends: one that fails to go out or to
// arrive only means the sender still shows "Sent". They carry a keep-until
// day, so one nobody reads is swept. Nothing here logs a key or a lookup.
// ---------------------------------------------------------------------------

import { KINDS, MailboxError, type MailboxClient, RECEIPT_KEEP_DAYS, keepUntilAfter, openReceipt, partiesKeyFromHex, receiptLookup, sealReceipt } from "@pnw/mailbox";
import { markPaystubReceived } from "@pnw/payroll";
import type { Company } from "../books/company";
import { linkFor, markOfferReceived } from "../books/rail";
import { type Work, markTimesheetReceived } from "../books/work";
import { offerFileKind } from "./offer_files";
import { TIMESHEET_KIND } from "./work/timesheet";

/** The slot an offer's receipt answers: the offer's own kind, slot 0. */
export const offerReceiptSlot = (offerTimeHash: string) => ({ kind: offerFileKind(offerTimeHash), seq: 0 });

/**
 * Sends the receipt for the `seq`-th document of `kind`. Never throws: a
 * receipt is a courtesy, and a slot already taken means it went out before.
 */
export async function sendReceipt(client: Pick<MailboxClient, "put">, partiesKeyHex: string, kind: string, seq: number, now: Date = new Date()): Promise<boolean> {
  try {
    const key = partiesKeyFromHex(partiesKeyHex);
    let sealed;
    try {
      sealed = await sealReceipt(key, kind, seq, now.toISOString());
    } finally {
      key.fill(0);
    }
    await client.put(sealed.lookup, sealed.envelope, { keepUntil: keepUntilAfter(now, RECEIPT_KEEP_DAYS) });
    return true;
  } catch (e) {
    return e instanceof MailboxError && e.code === "CONFLICT";
  }
}

/** One document the sender is waiting to hear about. */
export type Awaiting<T> = { partiesKey: string; kind: string; seq: number; target: T };
export type Heard<T> = { target: T; receivedAt: string };

export type ReadReceiptsResult<T> = {
  heard: Heard<T>[];
  /** The host has no mailbox (503): nothing was read. */
  off: boolean;
  /** A read failed for another reason; the check stopped there. */
  failed?: string;
};

/**
 * Reads the receipts for every document in `waiting`. Each one found is
 * handed to `record` (the vault) before it is dropped. A receipt that won't
 * open is left alone. Never throws; the result says what happened.
 */
export async function readReceipts<T>(
  client: Pick<MailboxClient, "get" | "drop">,
  waiting: readonly Awaiting<T>[],
  record: (heard: Heard<T>[]) => Promise<void>,
): Promise<ReadReceiptsResult<T>> {
  const result: ReadReceiptsResult<T> = { heard: [], off: false };
  const lookups: string[] = [];
  for (const w of waiting) {
    const key = partiesKeyFromHex(w.partiesKey);
    try {
      const lookup = receiptLookup(key, w.kind, w.seq);
      let bytes: Uint8Array | null;
      try {
        bytes = await client.get(lookup);
      } catch (e) {
        if (e instanceof MailboxError && e.code === "NOT_CONFIGURED") result.off = true;
        else result.failed = e instanceof Error ? e.message : "The mailbox couldn't be read";
        break;
      }
      if (!bytes) continue;
      try {
        const { receivedAt } = await openReceipt(key, w.kind, w.seq, bytes);
        result.heard.push({ target: w.target, receivedAt });
        lookups.push(lookup);
      } catch {
        // Not a receipt from the other side: leave it, its keep-until day will clear it.
      }
    } finally {
      key.fill(0);
    }
  }
  if (result.heard.length > 0) {
    await record(result.heard); // in the vault first…
    for (const lookup of lookups) await client.drop(lookup).catch(() => {}); // …then the receipts go
  }
  return result;
}

// ---- The business ----------------------------------------------------------

export type BusinessTarget = { kind: "offer"; workerId: string; agreementId: string } | { kind: "paystub"; runId: string; workerId: string; seq: number };

/** What the business sent and hasn't heard back about: offers still waiting, paystubs delivered. */
export function businessAwaiting(company: Pick<Company, "rail" | "payroll">): Awaiting<BusinessTarget>[] {
  const rail = company.rail;
  if (!rail) return [];
  const out: Awaiting<BusinessTarget>[] = [];
  for (const link of rail.links) {
    if (link.status !== "offered" || link.offerReceivedAt || !link.partiesKey || link.terms?.version !== 2) continue;
    out.push({ partiesKey: link.partiesKey, ...offerReceiptSlot(link.terms.agreementId), target: { kind: "offer", workerId: link.workerId, agreementId: link.agreementId } });
  }
  for (const run of company.payroll.runs) {
    for (const check of run.paychecks) {
      const d = check.delivery;
      const key = linkFor(rail, check.workerId)?.partiesKey;
      if (!d || d.receivedAt || !key) continue;
      out.push({ partiesKey: key, kind: KINDS.paystub, seq: d.seq, target: { kind: "paystub", runId: run.id, workerId: check.workerId, seq: d.seq } });
    }
  }
  return out;
}

/** Keeps what the receipts said in the business's vault. */
export function recordBusinessReceipts(company: Company, heard: readonly Heard<BusinessTarget>[]): Company {
  let { rail, payroll } = company;
  for (const { target: t, receivedAt } of heard) {
    if (t.kind === "offer" && rail) rail = markOfferReceived(rail, t.workerId, t.agreementId, receivedAt);
    if (t.kind === "paystub") payroll = markPaystubReceived(payroll, t.runId, t.workerId, t.seq, receivedAt);
  }
  return { ...company, rail, payroll };
}

// ---- The person ------------------------------------------------------------

export type WorkTarget = { kind: "timesheet"; agreementId: string; seq: number };

/** The weeks of hours the person sent and hasn't heard back about. */
export function workAwaiting(work: Work): Awaiting<WorkTarget>[] {
  const out: Awaiting<WorkTarget>[] = [];
  for (const t of work.timesheets) {
    const agreement = work.agreements.find((a) => a.agreementId === t.agreementId);
    if (t.receivedAt || !agreement) continue;
    out.push({ partiesKey: agreement.partiesKey, kind: TIMESHEET_KIND, seq: t.seq, target: { kind: "timesheet", agreementId: t.agreementId, seq: t.seq } });
  }
  return out;
}

/** Keeps what the receipts said in the person's vault. */
export const recordWorkReceipts = (work: Work, heard: readonly Heard<WorkTarget>[]): Work =>
  heard.reduce((w, { target: t, receivedAt }) => markTimesheetReceived(w, t.agreementId, t.seq, receivedAt), work);
