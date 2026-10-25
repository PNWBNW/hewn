// ---------------------------------------------------------------------------
// A service agreement between a business and a connected customer (Joshua,
// 2026-10-26, option A): the business proposes terms for one job, the
// customer accepts, asks for changes or declines, and either side closes it
// when the job is done or called off. Everything travels in the conversation
// the two share (books/connections.ts) and is kept in both vaults; nothing is
// recorded publicly yet (a later version records it in a program of its own
// and takes these over). A link without an agreement is fine too: invoices
// may name an agreement, never must.
//
// A revised proposal keeps the agreement's id and takes the next revision; an
// answer counts only for the revision it names, so a customer never accepts
// terms they didn't see. Pure.
// ---------------------------------------------------------------------------

import type { ThreadItem } from "./thread";

export const PRICE_KINDS = ["fixed", "hourly", "estimate"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export const PRICE_LABEL: Record<PriceKind, string> = { fixed: "Fixed price", hourly: "Per hour", estimate: "Estimate" };

/** The terms of one job, as the business proposes them. */
export type ServiceTerms = {
  /** 16 hex characters, the same on every revision. */
  id: string;
  /** 1 for the first proposal, then one more for each revision. */
  rev: number;
  title: string;
  /** What the work is. */
  scope: string;
  priceKind: PriceKind;
  /** Cents, as a decimal string: the price, the hourly rate, or the estimate. */
  amount: string;
  /** YYYY-MM-DD */
  startDate: string;
  endDate?: string;
  /** How the job ends: what both sides agree finishes it (sign-off, a final invoice paid, a date). */
  closesWhen: string;
};

export type ServiceAnswer = "accept" | "changes" | "decline";
export type CloseReason = "complete" | "cancelled";

export const MAX_TITLE = 80;
export const MAX_SCOPE = 4_000;
export const MAX_SERVICE_NOTE = 1_000;
const ID = /^[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CENTS = /^\d{1,15}$/;

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

const words = (v: unknown, what: string, max: number, required = true): string => {
  if (typeof v !== "string" || [...v].length > max || (required && !v.trim())) throw new ServiceError(`${what} is ${required ? "1" : "0"} to ${max.toLocaleString("en-US")} characters`);
  return v;
};

export const serviceId = (v: unknown): string => {
  if (typeof v !== "string" || !ID.test(v)) throw new ServiceError("An agreement needs its id");
  return v;
};

export const serviceRev = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 999) throw new ServiceError("An agreement's revision is a whole number from 1");
  return v;
};

export const serviceNote = (v: unknown): string | undefined => (v === undefined || v === "" ? undefined : words(v, "A note", MAX_SERVICE_NOTE));

export function validateTerms(raw: unknown): ServiceTerms {
  const r = raw as Record<string, unknown> | null;
  if (!r) throw new ServiceError("An agreement needs its terms");
  if (!PRICE_KINDS.includes(r.priceKind as PriceKind)) throw new ServiceError("Say how the job is priced");
  if (typeof r.amount !== "string" || !CENTS.test(r.amount)) throw new ServiceError("An agreement needs its amount");
  if (typeof r.startDate !== "string" || !DATE.test(r.startDate)) throw new ServiceError("An agreement needs its start date");
  if (r.endDate !== undefined && (typeof r.endDate !== "string" || !DATE.test(r.endDate) || r.endDate < r.startDate)) throw new ServiceError("The end date is on or after the start");
  const terms: ServiceTerms = {
    id: serviceId(r.id),
    rev: serviceRev(r.rev),
    title: words(r.title, "A title", MAX_TITLE).trim(),
    scope: words(r.scope, "What the work is", MAX_SCOPE),
    priceKind: r.priceKind as PriceKind,
    amount: r.amount,
    startDate: r.startDate,
    closesWhen: words(r.closesWhen, "How the job ends", 300),
  };
  if (r.endDate !== undefined) terms.endDate = r.endDate as string;
  return terms;
}

/** A fresh agreement id. */
export function newServiceId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- Where each agreement stands -----------------------------------------------

export type ServiceStatus =
  /** Proposed (or revised); waiting for the customer. */
  | "offered"
  /** The customer asked for changes to this revision. */
  | "changes"
  | "declined"
  /** Both agreed: the job is on. */
  | "active"
  | "complete"
  | "cancelled";

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  offered: "Proposed",
  changes: "Changes asked",
  declined: "Declined",
  active: "Agreed",
  complete: "Complete",
  cancelled: "Cancelled",
};

export type ServiceView = {
  terms: ServiceTerms;
  status: ServiceStatus;
  /** The last note with an answer or a close, and who wrote it. */
  note?: { text: string; mine: boolean };
  /** When it was agreed, ended. */
  agreedAt?: string;
  closedAt?: string;
};

/**
 * Every agreement in a conversation, worked out from its messages in order. The business's side
 * proposes; the customer's answers count only for the revision they name, and only while it's
 * waiting; a close counts only on an agreed job. Newest first.
 */
export function agreementsIn(items: readonly ThreadItem[] | undefined): ServiceView[] {
  const byId = new Map<string, ServiceView>();
  for (const i of items ?? []) {
    const b = i.body;
    if (b.type === "agreement_offer" && i.from === "business") {
      const before = byId.get(b.terms.id);
      if (before && (before.status === "active" || before.status === "complete" || before.status === "cancelled" || b.terms.rev <= before.terms.rev)) continue;
      byId.set(b.terms.id, { terms: b.terms, status: "offered" });
    } else if (b.type === "agreement_answer" && i.from === "worker") {
      const v = byId.get(b.id);
      if (!v || v.terms.rev !== b.rev || v.status !== "offered") continue;
      byId.set(b.id, {
        ...v,
        status: b.answer === "accept" ? "active" : b.answer === "changes" ? "changes" : "declined",
        ...(b.note ? { note: { text: b.note, mine: i.mine } } : {}),
        ...(b.answer === "accept" ? { agreedAt: i.sentAt } : {}),
      });
    } else if (b.type === "agreement_close") {
      const v = byId.get(b.id);
      if (!v || v.status !== "active") continue;
      byId.set(b.id, { ...v, status: b.reason, closedAt: i.sentAt, ...(b.note ? { note: { text: b.note, mine: i.mine } } : {}) });
    }
  }
  return [...byId.values()].sort((a, b) => b.terms.startDate.localeCompare(a.terms.startDate) || a.terms.title.localeCompare(b.terms.title));
}

/** The agreements an invoice may name: agreed, or complete (a final invoice). */
export const invoiceableAgreements = (items: readonly ThreadItem[] | undefined): ServiceView[] =>
  agreementsIn(items).filter((a) => a.status === "active" || a.status === "complete");
