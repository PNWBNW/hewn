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
//            earliest at or after the height the payment was first asked at;
//   none     the record the payment set aside was spent by something that is
//            not a payment to them (records combined, a split, another
//            transfer), no transfer since has paid them that amount, and
//            nothing since was left unread. Said only with the record's tag in
//            hand;
//   unknown  anything short of either.
//
// A wrong "found" would leave someone unpaid and a wrong "none" would invite a
// second payment, so each needs all of the above, and every doubt is
// "unknown". Nothing is logged, posted or stored.
// ---------------------------------------------------------------------------

import { type PaymentLookup, type RailNetwork, TRANSFER_FUNCTION, lookupHeight, parseHeight, parseRejected, recordTag } from "@pnw/rail";
import { USDCX_PROGRAM } from "./balances";
import { newestFirst, transactionIdOf } from "./history_probe";
import { type FeedWallet, SHIELD_WAIT_MS, answered, readTransfer } from "./review_feed";

/** What one transaction turned out to be, once read from the explorer. */
export type SentRead =
  /**
   * A private USDCx transfer: who each one in it paid and how much, where Shield's view key opened
   * it. `sealed`: one in it stayed closed (someone else's, as a rule); `retry`: because Shield didn't
   * answer for its view keys, so the next look asks again.
   */
  | { kind: "transfer"; id: string; height?: number; pays: { to: string; minor: bigint }[]; sealed: boolean; retry?: true; spent: string[] }
  /** Accepted, and not a private USDCx transfer: records combined, a split, a public transfer, another program. */
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
  /** What earlier looks read, by transaction id: an accepted transaction doesn't change, so each is read once a session. */
  cache?: Map<string, SentRead>;
  /** The most transactions one look reads from the explorer; past it, the look can't say "none". */
  maxReads?: number;
};

export type SentPaymentQuery = {
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
  deps: SentPaymentDeps;
};

/** The most transactions one look reads from the explorer. */
export const MAX_READS = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const ID_KEYS = ["transactionId", "transaction_id", "txId"] as const;
const CHAIN_TAG = /^\d+field$/;

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
  const transfers = transitions.filter((t) => t.program === USDCX_PROGRAM && t.function === TRANSFER_FUNCTION);
  if (transfers.length === 0) return { kind: "other", id, spent };

  const pays: { to: string; minor: bigint }[] = [];
  let sealed = false;
  let keys: string[] | null = null;
  let unanswered = false;
  for (const t of transfers) {
    let read = readTransfer(t, null);
    if (read.to === null || read.minor === null) {
      // Only the account that sent a private transfer holds its view key: one Shield opens is this account's own.
      keys ??= await answered(deps.wallet.transitionViewKeys(id), wait, "the view key request").catch(() => ((unanswered = true), [] as string[]));
      for (const tvk of keys) {
        const opened = await deps.decrypt(t, tvk).catch(() => null);
        if (!isObj(opened)) continue;
        const again = readTransfer(opened, null);
        if (again.to !== null && again.minor !== null) {
          read = again;
          break;
        }
      }
    }
    if (read.to !== null && read.minor !== null) pays.push({ to: read.to, minor: read.minor });
    else sealed = true;
  }
  const height = parseHeight(doc);
  return { kind: "transfer", id, ...(height !== undefined ? { height } : {}), pays, sealed, ...(sealed && unanswered ? { retry: true as const } : {}), spent };
}

/** Looks for one payment in the account's own sent transfers. Never throws: what can't be read makes the answer "unknown". */
export async function findSentPayment(query: SentPaymentQuery): Promise<PaymentLookup> {
  const { to, minor, attempt, since, claimed, deps } = query;
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
    if (claimed.has(id)) continue; // already some payment's settlement in the books
    let read = cache.get(id) ?? null;
    if (!read) {
      if (budget <= 0) {
        whole = false;
        break;
      }
      budget--;
      read = await readOne(id, deps, wait);
      if (!read) {
        whole = false;
        continue;
      }
      // What the explorer holds for an accepted transaction doesn't change; only a transfer Shield
      // didn't answer for is read again next time.
      if (read.kind !== "transfer" || !read.retry) cache.set(id, read);
    }
    reads.push(read);
  }

  const paid = (r: SentRead): boolean => r.kind === "transfer" && r.pays.some((p) => p.to === to && p.minor === minor);

  // a. The transaction that spent the record the payment set aside: if it paid them, that is the payment.
  const spender = tag ? reads.find((r) => r.kind !== "rejected" && r.spent.includes(tag)) : undefined;
  if (spender && paid(spender)) return { found: spender.id };

  // b. The request's own transaction, under either of its ids.
  const request = reads.find((r) => own.includes(r.id) && paid(r));
  if (request) return { found: request.id };

  // c. Any other transfer that paid them this amount, in a block at or after the one the payment was
  //    first asked at: the earliest. One that could be it but can't be placed or opened leaves doubt.
  let doubt = false;
  let earliest: { id: string; height: number } | null = null;
  for (const r of reads) {
    if (r.kind !== "transfer" || !(paid(r) || r.sealed)) continue;
    if (since === undefined) {
      doubt = true; // no floor: it can't be told from an older payment of the same amount
      continue;
    }
    if (r.height === undefined) {
      const height = await lookupHeight(deps.network, r.id);
      if (height !== undefined) r.height = height;
    }
    if (r.height === undefined) doubt = true;
    else if (r.height < since) continue; // older than this payment
    else if (!paid(r)) doubt = true; // since the floor, and Shield couldn't open it
    else if (!earliest || r.height < earliest.height) earliest = { id: r.id, height: r.height };
  }
  if (earliest) return { found: earliest.id };

  // d. Not paid: its record went into something that isn't a payment to them, and nothing was left unread.
  const elsewhere = spender !== undefined && !(spender.kind === "transfer" && spender.sealed);
  return elsewhere && whole && !doubt ? "none" : "unknown";
}
