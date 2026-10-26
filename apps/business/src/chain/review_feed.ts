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
//            here, with its amount and Shield's `sender`. Shield's history
//            lists it too, but only the sender's view key opens it there, so
//            the record it made for this account is opened with Shield's own
//            decrypt; failing that, it is taken from the record list.
//
// Every movement in the account comes in to be reviewed (Joshua, 2026-10-26),
// a move inside the account (public to private and back, records combined)
// too: it is marked as one, and the business says what it was. When the books
// were started from the Shield balance, only movements after the start do:
// the ones before are in the opening balance. Fees are ALEO and never counted. Nothing is
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
  /** Shield's own decrypt: a record this account owns, as plain text; throws for anyone else's. */
  decryptRecord?(cipherText: string): Promise<string>;
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
  /** Why each one with an id couldn't be read, in a few words: ids are public, and no amount or account is in it. */
  why?: { id: string; why: string }[];
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

/** Whether a movement at `when` falls after the books started (always, when they weren't started from the Shield balance). A start without a time counts from the next day. */
export function afterStart(when: Date, start: RailStart | null | undefined): boolean {
  if (!start) return true;
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
  // Moving between the account's public and private halves: reviewed like the rest, marked as a move within.
  if (to === me && (from === me || from === null) && INTERNAL.has(fn)) return { ...base, direction: "in", within: true, status: "new" };
  if (to === me) return { ...base, direction: "in", ...(from && from !== me ? { counterparty: from } : {}), ...(from === me ? { within: true as const } : {}), status: "new" };
  if (to) return { ...base, direction: "out", counterparty: to, status: "new" };
  return null;
}

/**
 * Finds the movements not in `known`, after `start`. Transactions that can't be read yet are
 * counted in `unread` and left for the next check.
 */
export async function findMovements(args: { me: string; start: RailStart | null | undefined; known: ReadonlySet<string>; deps: FeedDeps }): Promise<FeedResult> {
  const { me, start, known, deps } = args;
  const items: ReviewItem[] = [];
  const seen = new Set(known);
  let unread = 0;
  // Read neither way yet. A private payment received is in Shield's history too, but only its
  // sender can open it there; its record (step 2) has the amount, so it isn't given up on here.
  const notYet = new Map<string, string>();
  const later = (id: string, why: string) => {
    seen.delete(id);
    notYet.set(id, why);
  };

  // 1. History: both directions of public transfers, and what this account sent privately.
  const history = await deps.wallet.requestTransactionHistory(USDCX_PROGRAM);
  const entries = newestFirst(Array.isArray(history?.transactions) ? history.transactions : []).filter(isObj);
  for (const e of entries) {
    const id = transactionIdOf(e, ["transactionId", "transaction_id", "txId"]);
    const when = timeOf(e.blockTimestamp);
    if (!id) {
      unread++; // listed by Shield without an id the books can keep: said, not dropped silently
      continue;
    }
    if (seen.has(id) || !when || !afterStart(when, start)) continue;
    if (typeof e.transactionStatus === "string" && e.transactionStatus.toLowerCase() !== "accepted") continue;
    seen.add(id);
    try {
      const doc = await deps.fetchTransaction(id);
      const { transfer, fee } = transitionsOf(doc);
      if (!transfer) {
        later(id, doc ? "the explorer has it, but not as a USDCx transfer" : "the explorer doesn't have it yet");
        continue;
      }
      let read = readTransfer(transfer, fee);
      let tvks = 0;
      if (read.minor === null || (read.to === null && !read.fn.startsWith("mint") && !read.fn.startsWith("burn"))) {
        // Private values: open them with Shield's view keys for this transaction.
        const keys = await deps.wallet.transitionViewKeys(id).catch(() => [] as string[]);
        tvks = keys.length;
        for (const tvk of keys) {
          const opened = await deps.decrypt(transfer, tvk).catch(() => null);
          if (!isObj(opened)) continue;
          const again = readTransfer(opened, fee);
          if (again.minor !== null) {
            read = { ...again, from: again.from ?? me }; // only the sender holds the view key
            break;
          }
        }
      }
      let why = tvks ? "Shield's view key didn't open it" : "Shield has no view key for it (someone else sent it)";
      if (read.minor === null && deps.wallet.decryptRecord) {
        // Someone else's private payment to this account: its view key is the sender's, but the
        // record it made is this account's own, and Shield opens that (Joshua's test, 2026-10-26).
        const mine = await ownRecordIn(transfer, me, deps.wallet.decryptRecord);
        if (typeof mine === "bigint") read = { fn: read.fn, to: me, minor: mine, from: read.from === me ? null : read.from };
        else why = `${why}; ${mine}`;
      }
      if (read.minor === null) {
        later(id, why);
        continue;
      }
      const item = classify({ me, id, when, fn: read.fn, to: read.to, from: read.from, minor: read.minor });
      if (item) items.push(item);
    } catch (e) {
      later(id, `reading it failed: ${shortError(e)}`);
    }
  }

  // 2. Records: a private payment received (its transaction isn't one this account signed).
  const raw = await deps.wallet.requestRecords(USDCX_PROGRAM, true).catch(() => [] as unknown[]);
  for (const r of receivedRecords(raw)) {
    if (seen.has(r.id) || !afterStart(r.when, start)) continue;
    seen.add(r.id);
    notYet.delete(r.id);
    const item = classify({ me, id: r.id, when: r.when, fn: r.fn, to: me, from: r.from, minor: r.minor });
    if (item) items.push(item);
  }

  // What Shield's record list says about each one still unread, so a gap can be told apart from a bug.
  const why = [...notYet].map(([id, w]) => {
    const rec = raw.filter(isObj).find((r) => transactionIdOf(r, ["transactionId", "transaction_id", "txId"]) === id);
    const inList = !rec
      ? "not in Shield's record list"
      : `in Shield's record list (${[rec.spent === true ? "spent" : "unspent", typeof rec.recordPlaintext === "string" ? "with its amount" : "without its amount", timeOf(rec.blockTimestamp) ? "dated" : "undated"].join(", ")})`;
    return { id, why: `${w}; ${inList}` };
  });
  return { items, unread: unread + notYet.size, why };
}

/** An error in a few words, for the reasons list: never more than its message, cut short. */
const shortError = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 120);

/** The amount of the record a transition made for this account, opened with Shield; otherwise why not, in a few words. */
async function ownRecordIn(transition: Obj, me: string, decrypt: (cipherText: string) => Promise<string>): Promise<bigint | string> {
  const outputs = Array.isArray(transition.outputs) ? transition.outputs.filter(isObj) : [];
  const tried: string[] = [];
  for (const o of outputs) {
    if (o.type !== "record" || typeof o.value !== "string" || !o.value.startsWith("record1")) continue;
    let plain: unknown;
    try {
      plain = await decrypt(o.value);
    } catch (e) {
      tried.push(`refused (${shortError(e)})`);
      continue;
    }
    if (typeof plain !== "string") {
      tried.push(`gave ${typeof plain}`);
      continue;
    }
    const owner = /\bowner:\s*(aleo1[a-z0-9]{58})/.exec(plain)?.[1];
    const amount = /\bamount:\s*(\d+)u128\b/.exec(plain)?.[1];
    if (owner === me && amount) return BigInt(amount);
    tried.push(owner ? (owner === me ? "opened, no amount" : "someone else's") : "opened, no owner");
  }
  return tried.length ? `Shield's decrypt on its ${tried.length} records: ${tried.join(", ")}` : "no records in it to open";
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
