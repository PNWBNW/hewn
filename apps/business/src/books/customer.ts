// ---------------------------------------------------------------------------
// A client's side of the app (docs/CUSTOMERS.md, decision 17): an account of
// its own, with its own login and portal, that holds only what a customer
// does with the businesses they hire. A person can be a worker and a customer
// as two accounts under one username; never a business with either.
//
// It holds the registered name, the businesses this customer is connected
// with (books/connections.ts), the bills they paid, and the payments they made
// to a business without a bill, found by its registered name. Pure: no React,
// no storage.
// ---------------------------------------------------------------------------

import type { Settlement } from "@pnw/payroll";
import { type Connections, validateConnections } from "./connections";

/** The name businesses find this customer by: the person's own name.hewn, registered or already theirs. */
export type CustomerName = {
  name: string;
  /** The registry's hash of the name, as a decimal field without the suffix. */
  nameHash: string;
  registeredAt: string;
};

/**
 * Paying one bill from Shield: where the transfer stands (the pay queue's own record of it, so a
 * reload resumes and never pays twice), and when the business was told.
 */
export type BillPayment = {
  /** The business's account. */
  address: string;
  invoiceId: string;
  number: string;
  /** Cents, as a decimal string. */
  cents: string;
  settlement: Settlement;
  /** When the payment message went to the business. */
  toldAt?: string;
};

/**
 * Paying a business without a bill (docs/CUSTOMERS.md, decision 24): to the account its registered
 * name points at, for an amount and a note the customer chose. Kept as the receipt; the pay queue's
 * record of the transfer makes it never go twice, as a bill's does.
 */
export type DirectPayment = {
  /** 16 hex, made when the customer confirmed: the pay queue's id for it. */
  id: string;
  /** The business's account, as the registry gave it for the name. */
  address: string;
  /** The business's registered name, without the suffix. */
  name: string;
  /** Cents, as a decimal string. */
  cents: string;
  /** What it's for, in the customer's words. */
  note?: string;
  createdAt: string;
  settlement: Settlement;
  /** When the payment message went to the business (connected businesses only). */
  toldAt?: string;
};

export type CustomerSide = {
  version: 1;
  name?: CustomerName;
  /** The businesses this customer is connected with, or asked by, keyed by their account. */
  businesses?: Connections;
  /** Bills being paid or paid, keyed by `billKey`. */
  payments?: Record<string, BillPayment>;
  /** Payments made without a bill, keyed by their id. */
  direct?: Record<string, DirectPayment>;
};

/** One bill, wherever it's named: the business's account and its invoice id. */
export const billKey = (address: string, invoiceId: string): string => `${address}:${invoiceId}`;

export const emptyCustomer = (): CustomerSide => ({ version: 1 });

const NAME = /^[a-z0-9_]{1,32}$/;
const FIELD = /^\d{1,78}$/;

/** Checks a customer section read from the vault; throws on anything that isn't one. */
export function validateCustomer(raw: unknown): CustomerSide {
  if (!raw || typeof raw !== "object") throw new Error("The customer section is damaged");
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error("This customer section is from a newer version");
  const out: CustomerSide = { version: 1 };
  if (r.name !== undefined) {
    const n = r.name as Record<string, unknown> | null;
    if (!n || typeof n.name !== "string" || !NAME.test(n.name) || typeof n.nameHash !== "string" || !FIELD.test(n.nameHash) || typeof n.registeredAt !== "string" || Number.isNaN(Date.parse(n.registeredAt))) {
      throw new Error("The customer's name is damaged");
    }
    out.name = { name: n.name, nameHash: n.nameHash, registeredAt: n.registeredAt };
  }
  if (r.businesses !== undefined) out.businesses = validateConnections(r.businesses);
  if (r.payments !== undefined) {
    if (!r.payments || typeof r.payments !== "object" || Array.isArray(r.payments)) throw new Error("The customer's payments are damaged");
    const payments: Record<string, BillPayment> = {};
    for (const [key, raw] of Object.entries(r.payments as Record<string, unknown>)) {
      const p = validateBillPayment(raw);
      if (billKey(p.address, p.invoiceId) !== key) throw new Error("A payment is filed under the wrong bill");
      payments[key] = p;
    }
    out.payments = payments;
  }
  if (r.direct !== undefined) {
    if (!r.direct || typeof r.direct !== "object" || Array.isArray(r.direct)) throw new Error("The customer's payments are damaged");
    const direct: Record<string, DirectPayment> = {};
    for (const [key, raw] of Object.entries(r.direct as Record<string, unknown>)) {
      const p = validateDirectPayment(raw);
      if (p.id !== key) throw new Error("A payment is filed under the wrong id");
      direct[key] = p;
    }
    out.direct = direct;
  }
  return out;
}

/** The customer side with its name set (once, from setup). */
export function setCustomerName(side: CustomerSide, name: CustomerName): CustomerSide {
  return validateCustomer({ ...side, name });
}

const ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;
const STATUSES: readonly Settlement["status"][] = ["pending", "settled", "failed"];

function validateSettlement(raw: unknown): Settlement {
  const r = raw as Record<string, unknown> | null;
  if (!r || !STATUSES.includes(r.status as Settlement["status"])) throw new Error("A payment's state is damaged");
  const out: Settlement = { status: r.status as Settlement["status"] };
  for (const k of ["reference", "failure", "settledAt"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] !== "string" || (r[k] as string).length > 500) throw new Error("A payment's state is damaged");
    out[k] = r[k] as string;
  }
  if (r.attempt !== undefined) {
    if (typeof r.attempt !== "string" || !/^[0-9a-f]{32}$/.test(r.attempt)) throw new Error("A payment's state is damaged");
    out.attempt = r.attempt;
  }
  if (r.height !== undefined) {
    if (typeof r.height !== "number" || !Number.isInteger(r.height) || r.height < 0) throw new Error("A payment's state is damaged");
    out.height = r.height;
  }
  return out;
}

export function validateBillPayment(raw: unknown): BillPayment {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.address !== "string" || !ADDRESS.test(r.address)) throw new Error("A payment needs the business's account");
  if (typeof r.invoiceId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(r.invoiceId) || typeof r.number !== "string" || !r.number) throw new Error("A payment needs its invoice");
  if (typeof r.cents !== "string" || !/^[1-9]\d{0,14}$/.test(r.cents)) throw new Error("A payment needs its amount");
  const out: BillPayment = { address: r.address, invoiceId: r.invoiceId, number: r.number, cents: r.cents, settlement: validateSettlement(r.settlement) };
  if (r.toldAt !== undefined) {
    if (typeof r.toldAt !== "string" || Number.isNaN(Date.parse(r.toldAt))) throw new Error("A payment's time is damaged");
    out.toldAt = r.toldAt;
  }
  return out;
}

/**
 * Moves a bill's payment to `next`. A settled payment never changes again; a failed one goes back
 * to pending for a retry; everything else replaces what was there, keeping the record's tag.
 */
export function setBillPayment(side: CustomerSide, start: Omit<BillPayment, "settlement" | "toldAt">, next: Settlement): CustomerSide {
  const key = billKey(start.address, start.invoiceId);
  const before = side.payments?.[key];
  if (before?.settlement.status === "settled") return side;
  const settlement: Settlement = { ...(before?.settlement.attempt && !next.attempt ? { attempt: before.settlement.attempt } : {}), ...next };
  const payment = validateBillPayment({ ...(before ?? start), settlement });
  return { ...side, payments: { ...(side.payments ?? {}), [key]: payment } };
}

export const MAX_DIRECT_NOTE = 200;
const DIRECT_ID = /^[0-9a-f]{16}$/;

export function validateDirectPayment(raw: unknown): DirectPayment {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.id !== "string" || !DIRECT_ID.test(r.id)) throw new Error("A payment needs its id");
  if (typeof r.address !== "string" || !ADDRESS.test(r.address)) throw new Error("A payment needs the business's account");
  if (typeof r.name !== "string" || !NAME.test(r.name)) throw new Error("A payment needs the business's registered name");
  if (typeof r.cents !== "string" || !/^[1-9]\d{0,14}$/.test(r.cents)) throw new Error("A payment needs its amount");
  if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) throw new Error("A payment's time is damaged");
  const out: DirectPayment = { id: r.id, address: r.address, name: r.name, cents: r.cents, createdAt: r.createdAt, settlement: validateSettlement(r.settlement) };
  if (r.note !== undefined) {
    if (typeof r.note !== "string" || [...r.note].length > MAX_DIRECT_NOTE) throw new Error(`What a payment is for is at most ${MAX_DIRECT_NOTE} characters`);
    if (r.note.trim()) out.note = r.note;
  }
  if (r.toldAt !== undefined) {
    if (typeof r.toldAt !== "string" || Number.isNaN(Date.parse(r.toldAt))) throw new Error("A payment's time is damaged");
    out.toldAt = r.toldAt;
  }
  return out;
}

/** A new payment without a bill, not sent yet. Throws on anything off, so nothing half-formed reaches the pay queue. */
export function startDirectPayment(side: CustomerSide, p: Omit<DirectPayment, "settlement" | "toldAt">): CustomerSide {
  if (side.direct?.[p.id]) throw new Error("That payment was already started");
  const payment = validateDirectPayment({ ...p, settlement: { status: "pending" } });
  return { ...side, direct: { ...(side.direct ?? {}), [p.id]: payment } };
}

/** Moves a payment without a bill to `next`, the way `setBillPayment` moves a bill's. */
export function setDirectPayment(side: CustomerSide, id: string, next: Settlement): CustomerSide {
  const before = side.direct?.[id];
  if (!before) throw new Error("That payment isn't here");
  if (before.settlement.status === "settled") return side;
  const settlement: Settlement = { ...(before.settlement.attempt && !next.attempt ? { attempt: before.settlement.attempt } : {}), ...next };
  return { ...side, direct: { ...side.direct, [id]: validateDirectPayment({ ...before, settlement }) } };
}

/** Notes that the business was told about a settled payment without a bill. */
export function markDirectTold(side: CustomerSide, id: string, at: string): CustomerSide {
  const p = side.direct?.[id];
  if (!p || p.settlement.status !== "settled") throw new Error("That payment hasn't gone through");
  return { ...side, direct: { ...side.direct, [id]: { ...p, toldAt: at } } };
}

/** Whether a payment without a bill surely never went: failed, or never handed to Shield. Only then may it be dropped. */
export const directNeverWent = (p: DirectPayment): boolean =>
  p.settlement.status === "failed" || (p.settlement.status === "pending" && !p.settlement.attempt && !p.settlement.reference && !p.settlement.failure);

/** Forgets a payment without a bill that surely never went; throws for one that went or may have. */
export function dropDirectPayment(side: CustomerSide, id: string): CustomerSide {
  const p = side.direct?.[id];
  if (!p) return side;
  if (!directNeverWent(p)) throw new Error("That payment went, or may have: it stays as your receipt");
  const { [id]: _gone, ...rest } = side.direct!;
  return { ...side, direct: rest };
}

/** Payments made without a bill, newest first. */
export const directPaymentsIn = (side: Pick<CustomerSide, "direct">): DirectPayment[] => Object.values(side.direct ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Notes that the business was told about a settled payment. */
export function markPaymentTold(side: CustomerSide, key: string, at: string): CustomerSide {
  const p = side.payments?.[key];
  if (!p || p.settlement.status !== "settled") throw new Error("That payment hasn't gone through");
  return { ...side, payments: { ...side.payments, [key]: { ...p, toldAt: at } } };
}
