// ---------------------------------------------------------------------------
// What has passed between this business and its team, newest first, in two
// homes (the Mailbox page is gone, 2026-10-19): the offers and the
// conversation around each under Jobs → Offers, the weeks of hours under
// Payroll → Hours. Offers are read from the rail links, where they are
// already kept; hours and threads from the mailbox store. Nothing is copied,
// so nothing can drift. Paystubs delivered show on each paycheck.
// ---------------------------------------------------------------------------

import type { Payroll } from "@pnw/payroll";
import type { Mailbox, ReceivedHours } from "./mailbox";
import type { Rail } from "./rail";
import { type ThreadItem, isOfferStep } from "./thread";

export type FeedItem =
  | { kind: "offer"; key: string; at: string; workerId: string; workerName: string; receivedAt?: string; expiresAt?: string }
  | { kind: "accepted"; key: string; at: string; workerId: string; workerName: string }
  | { kind: "hours"; key: string; at: string; workerId: string; workerName: string; hours: ReceivedHours }
  /** A message in the conversation with one person (books/thread.ts): theirs or this business's answer. */
  | { kind: "thread"; key: string; at: string; workerId: string; workerName: string; partiesKey: string; item: ThreadItem };

const FALLBACK_NAME = "A team member";

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Everything that has passed between the business and its team, newest first. */
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

  for (const h of mailbox?.hours ?? []) {
    items.push({ kind: "hours", key: `hours:${h.agreementId}:${h.seq}`, at: h.receivedAt, workerId: h.workerId, workerName: nameOf(h.workerId), hours: h });
  }

  for (const [partiesKey, thread] of Object.entries(mailbox?.threads ?? {})) {
    for (const item of thread.items) {
      if (!isOfferStep(item.body)) continue; // only the offer's negotiation; everything else lives in Messages
      items.push({ kind: "thread", key: `thread:${item.id}`, at: item.sentAt, workerId: thread.workerId, workerName: nameOf(thread.workerId), partiesKey, item });
    }
  }

  // Newest first; the key keeps ties in a stable order.
  return items.sort((a, b) => time(b.at) - time(a.at) || a.key.localeCompare(b.key));
}

export type OfferItem = Extract<FeedItem, { kind: "offer" | "accepted" | "thread" }>;
export type HoursItem = Extract<FeedItem, { kind: "hours" }>;

/** Jobs → Offers: the offers sent, the acceptances, and the conversation around each. */
export const offersFeed = (input: Parameters<typeof buildFeed>[0]): OfferItem[] =>
  buildFeed(input).filter((i): i is OfferItem => i.kind !== "hours");

/** Payroll → Hours: the weeks the team has sent. */
export const hoursFeed = (input: Parameters<typeof buildFeed>[0]): HoursItem[] =>
  buildFeed(input).filter((i): i is HoursItem => i.kind === "hours");

/** True while at least one offer is still waiting for the other side. */
export const hasWaitingOffer = (rail: Rail | null): boolean => !!rail?.links.some((l) => l.status === "offered");

/** Agreements both sides have approved, with the key their mailbox is sealed to: the ones whose mailbox can be read. */
export const mailboxLinks = (rail: Rail | null | undefined) => (rail?.links ?? []).filter((l) => l.status === "linked" && !!l.partiesKey);
