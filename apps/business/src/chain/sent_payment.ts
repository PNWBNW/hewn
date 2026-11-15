// ---------------------------------------------------------------------------
// Was this payment made? A look in the linked account's own sent transfers,
// for the pay queue (@pnw/rail `findPayment`) before it calls a payment's
// outcome unknown.
//
// What it reads, and nothing else:
//
//   records   Shield's list of the account's USDCx records, to learn the tag
//             the chain gave the record the payment set aside (when Shield
//             gives one);
//   history   Shield's list of the account's USDCx transactions, for their ids
//             only. Nothing else in a history entry is believed: not its
//             status, its time, its function or its place in the list;
//   explorer  the network's own copy of each of those transactions, and of any
//             id Shield named for the request itself, in its confirmed form:
//             whether the network accepted it (one it doesn't call accepted
//             is never a payment), the height of its block, the tags of the
//             records it spent;
//   view keys Shield's transition view keys, to open a transfer this account
//             sent and read who it paid and how much.
//
// The account's view key is never asked for or used here, and nothing is
// registered with any record-scanning service: public transactions are asked
// of the explorer by id, and that is all that leaves the device.
//
// The answer:
//
//   found    a transfer to that payee for exactly that amount, accepted, that
//            the books don't already hold: the one that spent the record the
//            payment set aside, or the request's own transaction, or else the
//            earliest from this account at or after the height the payment was
//            first asked at. That last one is known by payee and amount alone,
//            so it is never found while another open payment in the books is
//            to the same payee for the same amount (`contested`), and only when
//            it shows it was sent by this account: opened with Shield's view
//            key, or naming this account as its sender;
//   none     the record the payment set aside was spent by something that is
//            not a payment to them (records combined, a split, a transfer to
//            someone else), nothing since has paid them anything that could be
//            this account's, and nothing since was left unread. Said only with
//            the record's tag in hand;
//   unknown  anything short of either.
//
// A wrong "found" would leave someone unpaid and a wrong "none" would invite a
// second payment, so each needs all of the above, and every doubt is
// "unknown". Nothing is logged, posted or stored.
// ---------------------------------------------------------------------------

import { type PaymentLookup, type RailNetwork, lookupHeight, parseHeight, parseRejected, recordTag } from "@pnw/rail";
import { USDCX_PROGRAM } from "./balances";
import { newestFirst, transactionIdOf } from "./history_probe";
import { type FeedWallet, SHIELD_WAIT_MS, answered, readTransfer } from "./review_feed";

/**
 * One payment in a transaction. `from`, the account it was paid from: left out when Shield's view
 * key opened it (only the account that sent it can open it, so it is this account's own); the
 * sender its own public data names (a public transfer's finalize arguments); or null when its
 * public data names none (a private record paid out publicly). Never the fee's payer: Shield may
 * pay the fee from its own account.
 */
export type Pay = { to: string; minor: bigint; from?: string | null };

/** What one transaction turned out to be, once read from the explorer. */
export type SentRead =
  /**
   * A USDCx movement, private or public: who each one in it paid and how much, read from its public
   * inputs or, where those are private, once Shield's view key opened it. `sealed`: one in it
   * couldn't be read as one payment to one account (someone else's private transfer, as a rule);
   * `retry`: because Shield didn't answer for its view keys, so the next look asks again.
   */
  | { kind: "transfer"; id: string; height?: number; pays: Pay[]; sealed: boolean; retry?: true; spent: string[] }
  /** Accepted, and moving USDCx to no one: records combined or split, or no USDCx at all. */
  | { kind: "other"; id: string; spent: string[] }
  /** The network rejected it: nothing moved. */
  | { kind: "rejected"; id: string };

export type SentPaymentDeps = {
  wallet: FeedWallet;
  /** The explorer. */
  network: RailNetwork;
  /** A transition with its private values readable, opened with a transition view key. */
  decrypt(transition: unknown, tvk: string): Promise<unknown>;
  /** How long to wait for Shield to answer one request (tests make it short). */
  shieldWaitMs?: number;
  /**
   * What earlier looks read, by transaction id: an accepted transaction doesn't change, so each is
   * read once a session. Looks running at the same time over one cache also share the reads under
   * way.
   */
  cache?: Map<string, SentRead>;
  /** The most transactions one look reads from the explorer; past it, the look can't say "none". */
  maxReads?: number;
  /** How long one look may take in all; past it, it answers "unknown". Default 2 minutes. */
  deadlineMs?: number;
};

export type SentPaymentQuery = {
  /** The linked account, the one paying: a transfer whose public data names another sender isn't its payment. */
  account: string;
  /** The payee's account. */
  to: string;
  /** USDCx minor units. */
  minor: bigint;
  /** The tag the pay queue kept for the record the payment set aside (`recordTag`). */
  attempt?: string;
  /** Every on-chain id Shield named for the request: the one it submitted, the one it confirmed. */
  ids?: readonly string[];
  /** The chain's height when the payment was first asked of Shield: a transfer in an older block isn't it. */
  since?: number;
  /** Transactions the books already hold as some payment's settlement: never found again. */
  claimed: ReadonlySet<string>;
  /**
   * Another payment in the books, not settled and already asked of Shield, is to this payee for
   * this amount. A transfer known only by its payee and amount could then be either payment's, so
   * it is never found that way: only by the record this payment set aside or the request's own id.
   */
  contested: boolean;
  deps: SentPaymentDeps;
};

/** The most transactions one look reads from the explorer. */
export const MAX_READS = 200;
/** How long one look may take in all before it answers "unknown". */
export const LOOK_DEADLINE_MS = 2 * 60_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const ID_KEYS = ["transactionId", "transaction_id", "txId"] as const;
const CHAIN_TAG = /^\d+field$/;
const ACCOUNT = /^aleo1[a-z0-9]{58}$/;
/** The USDCx functions that move money to no one: records combined, or one split in two. */
const NO_PAYEE = new Set(["join", "split"]);
const isTransfer = (t: Obj): boolean => typeof t.function === "string" && t.function.startsWith("transfer");

/**
 * Who one USDCx transition paid and how much, when its readable inputs say so plainly: a transfer
 * (private, public, or between the two) naming exactly one account and an amount, with the sender
 * its finalize arguments name, if any. Anything else is null: it can't be read as one payment to
 * one account. That includes two accounts among its inputs, a function that isn't a transfer, and a
 * transfer made from another account's public balance under an allowance (`transfer_from_…`), whose
 * first account is the one paying, not the one paid.
 */
function payOf(t: Obj): Pay | null {
  if (!isTransfer(t) || (t.function as string).startsWith("transfer_from")) return null;
  const read = readTransfer(t, null);
  if (read.to === null || read.minor === null) return null;
  const values = (Array.isArray(t.inputs) ? t.inputs.filter(isObj) : []).flatMap((i) => (typeof i.value === "string" ? [i.value.trim().replace(/\.(private|public)$/, "")] : []));
  return new Set(values.filter((v) => ACCOUNT.test(v))).size === 1 ? { to: read.to, minor: read.minor, from: read.from } : null;
}

/** The tag the chain gave the record the payment set aside, when Shield's record list carries one for it. */
async function chainTagOf(attempt: string, deps: SentPaymentDeps, wait: number): Promise<string | null> {
  let raw: unknown[];
  try {
    raw = await answered(deps.wallet.requestRecords(USDCX_PROGRAM, true), wait, "the records request");
  } catch {
    return null;
  }
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.recordPlaintext !== "string") continue;
    if ((await recordTag(r.recordPlaintext)) !== attempt) continue;
    const tag = typeof r.tag === "string" ? r.tag.trim() : "";
    return CHAIN_TAG.test(tag) ? tag : null;
  }
  return null;
}

/** The explorer's copy of one transaction, read; null when it couldn't be read this time. */
async function readOne(id: string, deps: SentPaymentDeps, wait: number): Promise<SentRead | null> {
  let doc: unknown;
  try {
    // The confirmed form carries the network's verdict; the bare `transaction/<id>` doesn't.
    doc = await deps.network.fetchJson(`transaction/confirmed/${id}`);
  } catch {
    return null; // not there (yet), or the explorer didn't answer
  }
  if (!isObj(doc)) return null;
  if (parseRejected(doc)) return { kind: "rejected", id };
  // Read only when the explorer says, in so many words, that this very transaction was accepted.
  const tx = isObj(doc.transaction) ? doc.transaction : null;
  if (typeof doc.status !== "string" || doc.status.toLowerCase() !== "accepted" || !tx || transactionIdOf(tx.id) !== id) return null;
  const transitions = isObj(tx.execution) && Array.isArray(tx.execution.transitions) ? tx.execution.transitions.filter(isObj) : [];
  // Every record the transaction spent, by the tag the chain shows for it.
  const spent = transitions.flatMap((t) => (Array.isArray(t.inputs) ? t.inputs.filter(isObj) : [])).flatMap((i) => (i.type === "record" && typeof i.tag === "string" ? [i.tag.trim()] : []));
  // Every USDCx movement counts, however it was made: a private transfer, a public one, or one between
  // the two. A payment to them made any of those ways is a payment, so none may be missed.
  const transfers = transitions.filter((t) => t.program === USDCX_PROGRAM && !(typeof t.function === "string" && NO_PAYEE.has(t.function)));
  if (transfers.length === 0) return { kind: "other", id, spent };

  const pays: Pay[] = [];
  let sealed = false;
  let keys: string[] | null = null;
  let unanswered = false;
  for (const t of transfers) {
    let read = payOf(t);
    if (!read && isTransfer(t)) {
      // Only the account that sent a private transfer holds its view key: one Shield opens is this account's own.
      keys ??= await answered(deps.wallet.transitionViewKeys(id), wait, "the view key request").catch(() => ((unanswered = true), [] as string[]));
      for (const tvk of keys) {
        const opened = await deps.decrypt(t, tvk).catch(() => null);
        if (!isObj(opened)) continue;
        const pay = payOf(opened);
        if (pay) {
          read = { to: pay.to, minor: pay.minor }; // opened: this account's own
          break;
        }
      }
    }
    if (read) pays.push(read);
    else sealed = true;
  }
  const height = parseHeight(doc);
  return { kind: "transfer", id, ...(height !== undefined ? { height } : {}), pays, sealed, ...(sealed && unanswered ? { retry: true as const } : {}), spent };
}

/** Reads and block heights under way, by the session cache they will fill: looks running at once wait on one read, not one each. */
const underway = new WeakMap<Map<string, SentRead>, Map<string, Promise<unknown>>>();

function shared<T>(cache: Map<string, SentRead>, key: string, start: () => Promise<T>, failed: T): Promise<T> {
  let all = underway.get(cache);
  if (!all) underway.set(cache, (all = new Map()));
  const running = all.get(key) as Promise<T> | undefined;
  if (running) return running;
  const done = all;
  const p = start()
    .catch(() => failed)
    .finally(() => done.delete(key));
  done.set(key, p);
  return p;
}

/**
 * Looks for one payment in the account's own sent transfers. Never throws: what can't be read makes
 * the answer "unknown", and so does a look still going after `deadlineMs`, which then reads and asks
 * Shield for nothing more.
 */
export async function findSentPayment(query: SentPaymentQuery): Promise<PaymentLookup> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const halt = { late: false };
  const late = new Promise<"unknown">((resolve) => {
    timer = setTimeout(() => {
      halt.late = true;
      resolve("unknown");
    }, query.deps.deadlineMs ?? LOOK_DEADLINE_MS);
  });
  try {
    return await Promise.race([lookForPayment(query, halt).catch(() => "unknown" as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function lookForPayment(query: SentPaymentQuery, halt: { late: boolean }): Promise<PaymentLookup> {
  const { account, to, minor, attempt, since, claimed, contested, deps } = query;
  const wait = deps.shieldWaitMs ?? SHIELD_WAIT_MS;
  const cache = deps.cache ?? new Map<string, SentRead>();

  // 1. The record the payment set aside, as the chain names it.
  const tag = attempt ? await chainTagOf(attempt, deps, wait) : null;

  // 2. Which transactions to read: the request's own, then every id in Shield's history. `whole`
  //    stays true only while everything that could be this payment has been read.
  let whole = true;
  const own = (query.ids ?? []).map((id) => transactionIdOf(id)).filter((id): id is string => id !== null);
  const listed: string[] = [];
  try {
    const history = await answered(deps.wallet.requestTransactionHistory(USDCX_PROGRAM), wait, "the history request");
    if (!Array.isArray(history?.transactions)) whole = false;
    // Newest first is only the order they are read in, for when there are more than one look reads.
    for (const entry of newestFirst(Array.isArray(history?.transactions) ? history.transactions : [])) {
      const id = transactionIdOf(entry, ID_KEYS);
      if (id) listed.push(id);
      else whole = false; // listed without an id: it can't be read, so it can't be ruled out
    }
  } catch {
    whole = false;
  }

  const reads: SentRead[] = [];
  let budget = deps.maxReads ?? MAX_READS;
  for (const id of new Set([...own, ...listed])) {
    if (halt.late) return "unknown"; // the look has answered already: nothing more is read
    if (claimed.has(id)) continue; // already some payment's settlement in the books
    let read = cache.get(id) ?? null;
    if (!read) {
      if (budget <= 0) {
        whole = false;
        break;
      }
      budget--;
      read = await shared(
        cache,
        `read ${id}`,
        async () => {
          const r = await readOne(id, deps, wait);
          // What the explorer holds for an accepted transaction doesn't change; only a transfer Shield
          // didn't answer for is read again next time.
          if (r && (r.kind !== "transfer" || !r.retry)) cache.set(id, r);
          return r;
        },
        null,
      );
      if (!read) {
        whole = false;
        continue;
      }
    }
    reads.push(read);
  }

  // Whose money a payment moved: this account's when Shield's view key opened it or it names this
  // account as its sender; another's when it names another; unknown when it names none.
  const whose = (p: Pay): "mine" | "other" | "unknown" => (p.from === undefined || p.from === account ? "mine" : p.from === null ? "unknown" : "other");
  // Its payments to them, any amount, but for those plainly from another account: those aren't this account's.
  const toThem = (r: SentRead): Pay[] => (r.kind === "transfer" ? r.pays.filter((p) => p.to === to && whose(p) !== "other") : []);
  // Paid them exactly this amount from this account. `known`: the transaction is already known to be
  // this account's (it spent the record the payment set aside, or it is the request's own), so a
  // payment in it that names no sender is this account's too.
  const paid = (r: SentRead, known = false): boolean => toThem(r).some((p) => p.minor === minor && (known || whose(p) === "mine"));
  // Could be a payment to them that isn't read in full: one in it couldn't be read, or it paid them
  // another amount, or from an account it doesn't name.
  const unsure = (r: SentRead): boolean => r.kind === "transfer" && (r.sealed || toThem(r).length > 0);

  // a. The transaction that spent the record the payment set aside: if it paid them, that is the payment.
  const spender = tag ? reads.find((r) => r.kind !== "rejected" && r.spent.includes(tag)) : undefined;
  if (spender && paid(spender, true)) return { found: spender.id };

  // b. The request's own transaction, under either of its ids.
  const request = reads.find((r) => own.includes(r.id) && paid(r, true));
  if (request) return { found: request.id };

  // c. Any other transfer from this account that paid them this amount, in a block at or after the one
  //    the payment was first asked at: the earliest. One that could be it but can't be placed, opened or
  //    told to be from this account leaves doubt, and so does any other payment to them since then (it
  //    may hold this one, with something else added), and one that could as well be another open
  //    payment's (`contested`).
  let doubt = false;
  let earliest: { id: string; height: number } | null = null;
  for (const r of reads) {
    if (r.kind !== "transfer" || !unsure(r)) continue;
    if (halt.late) return "unknown";
    if (since === undefined) {
      doubt = true; // no floor: it can't be told from an older payment
      continue;
    }
    if (r.height === undefined) {
      const height = await shared(cache, `height ${r.id}`, () => lookupHeight(deps.network, r.id), undefined);
      if (height !== undefined) r.height = height;
    }
    if (r.height === undefined) doubt = true;
    else if (r.height < since) continue; // older than this payment
    else if (!paid(r)) doubt = true; // since the floor: unopened, another amount, or from an account it doesn't name
    else if (!earliest || r.height < earliest.height) earliest = { id: r.id, height: r.height };
  }
  if (earliest && !contested) return { found: earliest.id };
  if (earliest) doubt = true;

  // d. Not paid: its record went into something that isn't a payment to them, and nothing was left unread.
  const elsewhere = spender !== undefined && !unsure(spender);
  return elsewhere && whole && !doubt ? "none" : "unknown";
}
