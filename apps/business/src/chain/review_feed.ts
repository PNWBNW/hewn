// ---------------------------------------------------------------------------
// Finds the money that moved in the linked account, for the "For review" list
// (books/review.ts). Two sources, merged by transaction id:
//
//   history  Shield's list of the account's USDCx transactions, both ways:
//            what it sent and the public payments it received. Each is read
//            back from the explorer; a public transfer's recipient and amount
//            are in the open, a private one is opened with Shield's transition
//            view key.
//   records  the account's USDCx records: a private payment received shows up
//            here, with its amount and Shield's `sender`.
//
// Only movements after the books started count (before it, they're in the
// opening balance). Fees are ALEO and never counted. A move inside the
// account (public to private and back) is marked internal. Nothing is
// logged, posted or stored here: the caller adds what this returns.
// ---------------------------------------------------------------------------

import type { RailStart } from "@/books/rail";
import type { ReviewItem } from "@/books/review";
import { USDCX_PROGRAM } from "./balances";
import { newestFirst, transactionIdOf } from "./history_probe";

export type FeedWallet = {
  requestRecords(program: string, includePlaintext?: boolean): Promise<unknown[]>;
  requestTransactionHistory(program: string): Promise<{ transactions?: unknown }>;
  transitionViewKeys(transactionId: string): Promise<string[]>;
};

export type FeedDeps = {
  wallet: FeedWallet;
  /** The explorer's `transaction/<id>`; null when it doesn't know the id. */
  fetchTransaction(id: string): Promise<unknown>;
  /** A transition with its private values readable, opened with a transition view key. */
  decrypt(transition: unknown, tvk: string): Promise<unknown>;
};

export type FeedResult = {
  items: ReviewItem[];
  /** Transactions that couldn't be read this time (the explorer didn't have them yet, say); tried again next check. */
  unread: number;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const ADDRESS = /aleo1[a-z0-9]{58}/;
const AMOUNT = /^(\d+)u128(?:\.(?:private|public))?$/;
const strip = (v: string) => v.trim().replace(/\.(private|public)$/, "");

/** Seconds or milliseconds since 1970, or an ISO string, as a Date; null when it isn't one. */
function timeOf(v: unknown): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  const ms = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Whether a movement at `when` falls after the books started. A start without a time counts from the next day. */
export function afterStart(when: Date, start: RailStart): boolean {
  if (start.at) return when.getTime() > Date.parse(start.at);
  return when.toISOString().slice(0, 10) > start.date;
}

/** The readable values of a transition's inputs (plain text, visibility suffix dropped). */
function inputValues(t: Obj): string[] {
  const inputs = Array.isArray(t.inputs) ? t.inputs.filter(isObj) : [];
  return inputs.map((i) => (typeof i.value === "string" ? strip(i.value) : "")).filter((v) => v && !/^(ciphertext1|record1)/.test(v));
}

/** Every account named in a transition's outputs (a public transfer's finalize arguments name the sender). */
function outputAddresses(t: Obj): string[] {
  const outputs = Array.isArray(t.outputs) ? t.outputs.filter(isObj) : [];
  return outputs.flatMap((o) => (typeof o.value === "string" ? [...o.value.matchAll(new RegExp(ADDRESS, "g"))].map((m) => m[0]) : []));
}

/** What a USDCx transition says: the function, the recipient, the amount, and the sender when it shows. */
export function readTransfer(t: Obj, fee: Obj | null): { fn: string; to: string | null; minor: bigint | null; from: string | null } {
  const fn = typeof t.function === "string" ? t.function : "";
  const values = inputValues(t);
  const to = values.find((v) => new RegExp(`^${ADDRESS.source}$`).test(v)) ?? null;
  const amount = values.map((v) => AMOUNT.exec(v)).find((m) => m)?.[1];
  // The sender: named in the transfer's own finalize arguments (other than the recipient), or the fee's payer.
  const named = outputAddresses(t).find((a) => a !== to) ?? null;
  const payer = fee ? (outputAddresses(fee)[0] ?? null) : null;
  return { fn, to, minor: amount ? BigInt(amount) : null, from: named ?? payer };
}

/** The USDCx transition in a transaction, and its fee transition. */
function transitionsOf(doc: unknown): { transfer: Obj | null; fee: Obj | null } {
  const tx = isObj(doc) && isObj(doc.transaction) ? doc.transaction : doc;
  if (!isObj(tx)) return { transfer: null, fee: null };
  const list = isObj(tx.execution) && Array.isArray(tx.execution.transitions) ? tx.execution.transitions.filter(isObj) : [];
  const transfer = list.find((t) => t.program === USDCX_PROGRAM) ?? null;
  const fee = isObj(tx.fee) && isObj(tx.fee.transition) ? tx.fee.transition : null;
  return { transfer, fee };
}

const INTERNAL = new Set(["transfer_public_to_private", "transfer_private_to_public", "join", "split"]);

/** Turns what a transaction says into a review item for this account, or null when it isn't a movement of its money. */
export function classify(input: {
  me: string;
  id: string;
  when: Date;
  fn: string;
  to: string | null;
  from: string | null;
  minor: bigint;
}): ReviewItem | null {
  const { me, id, when, fn, to, from, minor } = input;
  const base = { id, date: when.toISOString().slice(0, 10), at: when.toISOString(), minor: minor.toString(), kind: fn.replace(/[^a-z0-9_]/g, "_").slice(0, 64) || "transfer" };
  if (minor === 0n) return null;
  if (fn.startsWith("mint")) return { ...base, direction: "in", status: "new" };
  if (fn.startsWith("burn")) return { ...base, direction: "out", status: "new" };
  // Moving between the account's public and private halves changes nothing in the books.
  if (to === me && (from === me || from === null) && INTERNAL.has(fn)) return { ...base, direction: "in", status: "internal" };
  if (to === me) return { ...base, direction: "in", ...(from && from !== me ? { counterparty: from } : {}), status: from === me ? "internal" : "new" };
  if (to) return { ...base, direction: "out", counterparty: to, status: "new" };
  return null;
}

/**
 * Finds the movements not in `known`, after `start`. Transactions that can't be read yet are
 * counted in `unread` and left for the next check.
 */
export async function findMovements(args: { me: string; start: RailStart; known: ReadonlySet<string>; deps: FeedDeps }): Promise<FeedResult> {
  const { me, start, known, deps } = args;
  const items: ReviewItem[] = [];
  const seen = new Set(known);
  let unread = 0;

  // 1. History: both directions of public transfers, and what this account sent privately.
  const history = await deps.wallet.requestTransactionHistory(USDCX_PROGRAM);
  const entries = newestFirst(Array.isArray(history?.transactions) ? history.transactions : []).filter(isObj);
  for (const e of entries) {
    const id = transactionIdOf(e, ["transactionId", "transaction_id", "txId"]);
    const when = timeOf(e.blockTimestamp);
    if (!id || seen.has(id) || !when || !afterStart(when, start)) continue;
    if (typeof e.transactionStatus === "string" && e.transactionStatus.toLowerCase() !== "accepted") continue;
    seen.add(id);
    try {
      const { transfer, fee } = transitionsOf(await deps.fetchTransaction(id));
      if (!transfer) {
        unread++;
        continue;
      }
      let read = readTransfer(transfer, fee);
      if (read.minor === null || (read.to === null && !read.fn.startsWith("mint") && !read.fn.startsWith("burn"))) {
        // Private values: open them with Shield's view keys for this transaction.
        for (const tvk of await deps.wallet.transitionViewKeys(id).catch(() => [] as string[])) {
          const opened = await deps.decrypt(transfer, tvk).catch(() => null);
          if (!isObj(opened)) continue;
          const again = readTransfer(opened, fee);
          if (again.minor !== null) {
            read = { ...again, from: again.from ?? me }; // only the sender holds the view key
            break;
          }
        }
      }
      if (read.minor === null) {
        unread++;
        continue;
      }
      const item = classify({ me, id, when, fn: read.fn, to: read.to, from: read.from, minor: read.minor });
      if (item) items.push(item);
    } catch {
      seen.delete(id);
      unread++;
    }
  }

  // 2. Records: a private payment received (its transaction isn't one this account signed).
  for (const r of receivedRecords(await deps.wallet.requestRecords(USDCX_PROGRAM, true).catch(() => [] as unknown[]))) {
    if (seen.has(r.id) || !afterStart(r.when, start)) continue;
    seen.add(r.id);
    const item = classify({ me, id: r.id, when: r.when, fn: r.fn, to: me, from: r.from, minor: r.minor });
    if (item) items.push(item);
  }

  return { items, unread };
}

/** A USDCx record this account holds: the transaction that made it, when, how much, and who sent it when Shield says. */
export type ReceivedRecord = { id: string; when: Date; minor: bigint; from: string | null; fn: string };

/** The account's USDCx token records as Shield lists them, each with what made it; anything unreadable is left out. */
export function receivedRecords(raw: readonly unknown[]): ReceivedRecord[] {
  const out: ReceivedRecord[] = [];
  for (const r of raw.filter(isObj)) {
    if (r.recordName !== undefined && r.recordName !== "Token") continue;
    const id = transactionIdOf(r, ["transactionId", "transaction_id", "txId"]);
    const when = timeOf(r.blockTimestamp);
    const m = typeof r.recordPlaintext === "string" ? /\bamount:\s*(\d+)u128\b/.exec(r.recordPlaintext) : null;
    if (!id || !when || !m?.[1]) continue;
    const from = typeof r.sender === "string" && new RegExp(`^${ADDRESS.source}$`).test(r.sender) ? r.sender : null;
    const fn = typeof r.functionName === "string" && r.functionName ? r.functionName : "transfer_private";
    out.push({ id, when, minor: BigInt(m[1]), from, fn });
  }
  return out;
}
