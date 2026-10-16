// ---------------------------------------------------------------------------
// The Mailbox page's feed: one list, newest first, of everything that has
// passed between this business and its team. Offers sent and paystubs
// delivered are read from the rail links and the pay runs, where they are
// already kept; hours come from the mailbox itself. Nothing is copied, so
// nothing can drift.
// ---------------------------------------------------------------------------

import type { Payroll } from "@pnw/payroll";
import type { Mailbox, ReceivedHours } from "./mailbox";
import type { Rail } from "./rail";
import type { ThreadItem } from "./thread";

export type FeedItem =
  | { kind: "offer"; key: string; at: string; workerId: string; workerName: string; receivedAt?: string; expiresAt?: string }
  | { kind: "accepted"; key: string; at: string; workerId: string; workerName: string }
  | { kind: "paystub"; key: string; at: string; workerId: string; workerName: string; payDate: string; runId: string; receivedAt?: string }
  | { kind: "hours"; key: string; at: string; workerId: string; workerName: string; hours: ReceivedHours }
  /** A message in the conversation with one person (books/thread.ts): theirs or this business's answer. */
  | { kind: "thread"; key: string; at: string; workerId: string; workerName: string; partiesKey: string; item: ThreadItem };

const FALLBACK_NAME = "A team member";

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Everything in the mailbox's feed, newest first. */
export function buildFeed(input: { rail: Rail | null; payroll: Payroll; mailbox: Mailbox | null }): FeedItem[] {
  const { rail, payroll, mailbox } = input;
  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  const nameOf = (id: string) => names.get(id) ?? FALLBACK_NAME;
  const items: FeedItem[] = [];

  for (const link of rail?.links ?? []) {
    if (link.status === "offered" && link.offeredAt) {
      items.push({
        kind: "offer",
        key: `offer:${link.agreementId}`,
        at: link.offeredAt,
        workerId: link.workerId,
        workerName: nameOf(link.workerId),
        ...(link.offerReceivedAt ? { receivedAt: link.offerReceivedAt } : {}),
        ...(link.terms?.version === 2 ? { expiresAt: link.terms.expiresAt } : {}),
      });
    }
    if (link.status === "linked" && link.linkedAt) {
      items.push({ kind: "accepted", key: `accepted:${link.agreementId}`, at: link.linkedAt, workerId: link.workerId, workerName: nameOf(link.workerId) });
    }
  }

  for (const run of payroll.runs) {
    for (const check of run.paychecks) {
      if (!check.delivery) continue;
      items.push({
        kind: "paystub",
        key: `paystub:${run.id}:${check.workerId}`,
        at: check.delivery.sentAt,
        workerId: check.workerId,
        workerName: nameOf(check.workerId),
        payDate: run.payDate,
        runId: run.id,
        ...(check.delivery.receivedAt ? { receivedAt: check.delivery.receivedAt } : {}),
      });
    }
  }

  for (const h of mailbox?.hours ?? []) {
    items.push({ kind: "hours", key: `hours:${h.agreementId}:${h.seq}`, at: h.receivedAt, workerId: h.workerId, workerName: nameOf(h.workerId), hours: h });
  }

  for (const [partiesKey, thread] of Object.entries(mailbox?.threads ?? {})) {
    for (const item of thread.items) {
      if (item.body.type === "text") continue; // plain messages live in Messages, not the feed
      items.push({ kind: "thread", key: `thread:${item.id}`, at: item.sentAt, workerId: thread.workerId, workerName: nameOf(thread.workerId), partiesKey, item });
    }
  }

  // Newest first; the key keeps ties in a stable order.
  return items.sort((a, b) => time(b.at) - time(a.at) || a.key.localeCompare(b.key));
}

/** True while at least one offer is still waiting for the other side. */
export const hasWaitingOffer = (rail: Rail | null): boolean => !!rail?.links.some((l) => l.status === "offered");

/** Agreements both sides have approved, with the key their mailbox is sealed to: the ones whose mailbox can be read. */
export const mailboxLinks = (rail: Rail | null | undefined) => (rail?.links ?? []).filter((l) => l.status === "linked" && !!l.partiesKey);
