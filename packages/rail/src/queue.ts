// ---------------------------------------------------------------------------
// The pay queue: settles a posted rail run, one `transfer_private` per payee,
// one payee at a time.
//
//   1. Plan: can the run be paid from the records the wallet lists (plan.ts)?
//      If not, nothing is asked of Shield.
//   2. Prove once: the sender's freeze-list exclusion proof, shared by every
//      transfer (exclusion.ts).
//   3. Pay in the run's order, with one Shield prompt open at a time. For
//      each payee: read the wallet's records again and plan the payments
//      still to make from them, so this one spends a record that leaves the
//      people after it covered (plan.ts) → the caller keeps that record's
//      tag → ask the wallet (Shield prompts once) → poll the wallet until it
//      reports the on-chain id and acceptance, or gives up → read the
//      confirmed transaction back from the explorer for the fee the employer
//      actually paid and the block height → report settled → wait until the
//      wallet lists what the payment left (its change), and go on to the
//      next payee. A definite failure → report failed; anything else → look
//      for it (below).
//
// Nothing is split beforehand. A transfer spends one record whole and the
// rest comes back as one new record, so with a single record on the rail each
// payment is made from the change of the one before it. Shield combines an
// account's records on its own, and a record it is combining can't be relied
// on to be there when a prompt is approved; a run that never holds two fresh
// records at once gives it nothing to combine.
//
// Where the run stops (2026-11-14). The first payment asked of Shield that
// doesn't settle ends the run: the payees after it are not asked for,
// nothing is kept or said for them, and the next run takes them up
// (`stalled`, with where it stopped). So a prompt left to expire, or turned
// down, costs a pause, never a line. The run also stops when, two minutes
// after a payment, the wallet still lists no record that covers the next
// one. A payment whose kept record has gone isn't asked of Shield: it is
// looked for (below), and the run goes on.
//
// Asked again on its own: only a payment this run has just asked for, when
// the record it set aside went into something else before Shield spent it
// (money arrived and Shield combined the two) and the look in the account's
// transfers says nothing paid them. It is asked again from a record listed
// now, its new tag kept first, up to `MAX_ASKS` asks in all; after the last,
// or when no record is listed for it, it is "Not paid" and the run stops.
//
// What is definite (2026-11-14). Shield has two answers that mean nothing
// moved: a rejection that says why, and an approval left until it expired
// (that line keeps its record for the retry). The explorer saying a
// transaction was rejected is the third, and a request the app itself
// stopped before Shield was asked (`stoppedBeforeWallet`) is the fourth: it
// keeps its record too. Everything else Shield may say
// (failed, interrupted, restarted, an error thrown by the request, no
// answer) doesn't say either way: a transfer reported failed has reached the
// chain afterwards. Before such a payment is called anything, it is looked
// for in the account's own transfers (`findPayment`, when the caller has
// one) and settled if it is there. Otherwise, unless it is asked again
// (above), it is unconfirmed, its record's tag and the wallet's id kept.
// From five minutes after the try ended, while the record it set aside is
// still unspent, the line says "Not seen on chain yet": it may still land.
// That is a label; nothing is sent because of it.
//
// Never paying twice (2026-10-22): before Shield is asked for a transfer,
// the caller keeps a tag for the record it will spend (`beforeSend`,
// awaited: if it can't be kept, nothing is sent). On a later run, a paycheck
// with that tag is sent again only by spending the same record, so if the
// first transfer is still on its way the network lets only one through; if
// the record is gone, it is looked for and reported, never asked again on
// its own, even when the look says nothing paid them ("Not paid"): the
// person checks Shield's activity, and pays again only by choice. No other
// payee is given a record a paycheck has set aside. A transfer Shield never
// answered for, or accepted without an id, is unconfirmed too, never failed,
// and an explorer that can't be reached only delays confirming.
//
// One step before the first payment (`beforeTransfers`, when the caller has
// one): once the first payment's tag is kept and before Shield is asked for
// it, the caller is handed every payment this run is about to ask for, with
// the tags held so far, and awaited. It is where a caller says what the run
// is about to pay where its other devices can read it (marker.ts). If it
// throws, no transfer is asked for and the run stops there. The first
// payment fails with the reason and the tag kept for it in this run is
// dropped, so its record is free again, unless the books held it as pending
// with a record set aside (an earlier try with it may still go through):
// then it stays unconfirmed, with that record and when its try ended, and
// says nothing was asked this time. A payment the books held that way says
// the same when its record can't be kept again just before Shield would be
// asked for it (`beforeSend`). The step runs once:
// a payment asked again from another record later in the run is handed to
// `beforeSend` with the new tag, and saying so is the caller's.
//
// Failures are per payee. The queue takes whatever is still pending or
// failed in the run, so calling it again resumes, after a pause or a reload
// alike: a pending paycheck that already carries the wallet's id for its
// transfer is polled, never sent twice; one that carries only its record's
// tag is asked again with that record, or looked for if the record is gone.
// Those are dealt with first, and whatever they turn out to be, the payees
// never yet asked for are then paid in order. The caller writes each outcome
// to the vault as the events arrive; the queue itself keeps no state.
// ---------------------------------------------------------------------------

import { isProgramAddress } from "@pnw/config/programs";
import type { PayRun, Paycheck } from "@pnw/payroll";
import { TransactionRejected, confirmTransaction, type ConfirmedTransaction } from "./confirm";
import { type MerkleTreeApi, ZERO_ADDRESS, exclusionProofFor } from "./exclusion";
import { pickRecord, planTransfers } from "./plan";
import { USDCX_PROGRAM, type TokenRecord, centsToMinor, fetchTokenRecords } from "./records";
import { type Clock, RailError, type RailNetwork, type RailWallet, type Sleep, stoppedBeforeWallet, systemClock, systemSleep } from "./types";

export const TRANSFER_FUNCTION = "transfer_private";

/**
 * How many times one payment is asked of Shield in a run. It is asked again only when the record it
 * set aside went into something else and the look says nothing paid them.
 */
export const MAX_ASKS = 3;

export type PayQueueLimits = {
  /** How long to wait on the wallet for one transaction. Default 15 minutes. */
  walletCapMs: number;
  /** How long to ask the wallet again about a transfer sent on an earlier run. Default 2 minutes. */
  resumeCapMs: number;
  /** After the wallet reports acceptance, how long to wait for the explorer to index it. Default 3 minutes. */
  confirmCapMs: number;
  /** After a payment, how long to wait for the wallet to list what it left before the next one. Default 2 minutes. */
  recordWaitMs: number;
  recordPollMs: number;
  pollMinMs: number;
  pollMaxMs: number;
  /**
   * How long after a try ended without a known outcome its still-unspent record is taken to mean
   * it hasn't landed so far. Default 5 minutes, a starting value: a transfer has landed 20 seconds
   * after Shield gave up on it.
   */
  notSeenAfterMs: number;
};

export const DEFAULT_LIMITS: PayQueueLimits = {
  walletCapMs: 15 * 60_000,
  resumeCapMs: 2 * 60_000,
  confirmCapMs: 3 * 60_000,
  recordWaitMs: 2 * 60_000,
  recordPollMs: 4_000,
  pollMinMs: 2_000,
  pollMaxMs: 10_000,
  notSeenAfterMs: 5 * 60_000,
};

export type PayQueueEvent =
  /** `transfers`: how many payments this run of the queue will ask for or, sent on an earlier run, ask about. */
  | { kind: "planned"; transfers: number }
  /**
   * Waiting on the wallet to prove and sign (Shield is showing its prompt, the only one open). `to`
   * and `minor` are the payee's account and the amount exactly as Shield was given them; `step` of
   * `of`: where this payment comes among the ones this run asks for.
   */
  | { kind: "approving"; workerId: string; to: string; minor: bigint; step: number; of: number }
  /**
   * The wallet took it; `reference` is the wallet's id for the transfer, to resume from after a reload.
   * `endedAt`, on one asked about again: when its last try ended, kept while it is checked.
   */
  | { kind: "sent"; workerId: string; reference: string; attempt?: string; since?: number; endedAt?: string }
  /** The wallet reported the on-chain id. */
  | { kind: "broadcast"; workerId: string; transactionId: string }
  /** `found`: Shield never confirmed it; it was found in the account's own transfers (`findPayment`). */
  | { kind: "settled"; workerId: string; transactionId: string; height?: number; feeMicrocredits?: bigint; found?: true }
  /** It didn't go through (or nothing was sent). `attempt`: the record it tried to spend, kept for the next run's check. */
  | { kind: "failed"; workerId: string; failure: string; attempt?: string; since?: number }
  /**
   * Its outcome isn't known: never sent again on its own. `failure` says where it stands and what to
   * check; `endedAt` is when the try ended (the first time it was reported, kept after that).
   */
  | { kind: "unconfirmed"; workerId: string; failure: string; reference?: string; attempt?: string; since?: number; endedAt?: string }
  /** The run stopped before payment `at` of `of` was made: that one and the ones after it wait for the next run. `why` says what stopped it. */
  | ({ kind: "stalled" } & Stall);

/** Where a run stopped short: before payment `at` of the `of` it set out to ask for was made, and why. */
export type Stall = { at: number; of: number; why: string };

/** One payment the queue asks about: who it was to, how much, and what is known of the try. */
export type PaymentQuery = {
  workerId: string;
  /** The payee's account. */
  to: string;
  /** USDCx minor units. */
  minor: bigint;
  /** The tag of the record the try set aside (`recordTag`). */
  attempt?: string;
  /** Every on-chain id Shield named for the request, if any. */
  ids: string[];
  /** The chain's height when the payment was first asked of Shield: nothing older can be it. */
  since?: number;
};

/**
 * What the account's own transfers say about a payment: `found` with the transaction that paid it;
 * "none" when the record it set aside is known to have been spent by something else and nothing
 * paid it; "unknown" for anything short of either.
 */
export type PaymentLookup = { found: string } | "none" | "unknown";

/**
 * A payment a run is about to ask for, as `beforeTransfers` is given it: the payee's account, the
 * amount in USDCx minor units, and the tag of the record set aside for it, when it has one. In a run
 * paid from one record that is the first payment only: each one after it is paid from what the one
 * before leaves, a record that doesn't exist yet.
 */
export type QueuedLine = { workerId: string; to: string; minor: bigint; attempt?: string };

/** What the queue reads of each payment: who it's to, how much, and where it stands. A paycheck, or a customer paying a bill. */
export type QueuedPayment = Pick<Paycheck, "workerId" | "net" | "settlement">;

export type PayQueueContext = {
  wallet: RailWallet;
  network: RailNetwork;
  run: Pick<PayRun, "id" | "mode"> & { paychecks: readonly QueuedPayment[] };
  /** workerId → account on the rail. Every payee in the run must be here. */
  links: ReadonlyMap<string, string>;
  onProgress?: (event: PayQueueEvent) => void;
  clock?: Clock;
  sleep?: Sleep;
  limits?: Partial<PayQueueLimits>;
  /** Test seam for the SDK's Merkle tree. */
  tree?: MerkleTreeApi;
  /**
   * Called, and awaited, just before Shield is asked for each transfer, with the tag of the record
   * it will spend and the chain's height when the payment was first asked for (when the explorer
   * said): the caller keeps both (books/PayPanel). If it throws, that transfer isn't sent, and the
   * run stops there: the payment fails with the reason, keeping only what was held for it before; or,
   * on its first ask in the run, when the books hold it as pending with that same record set aside, it
   * stays unconfirmed with that record and when its try ended, starting "Nothing was asked of Shield
   * this time".
   */
  beforeSend?: (workerId: string, attempt: string, since?: number) => Promise<void>;
  /**
   * Called once in a run, and awaited, between keeping the first payment's tag and asking Shield for
   * that payment, with every payment the run is about to ask for, in order. If it throws, no payment
   * is asked of Shield and the run stops there: the first one fails with "Nothing was paid: " and the
   * reason, without the tag kept for it in this run; or, when the books hold it as pending with a
   * record set aside (an earlier try with that record, if there was one, may still land), it stays
   * unconfirmed with that record and when its try ended, starting "Nothing was asked of Shield this
   * time". Not called when no payment is to be
   * asked for, and not again in the run: a payment asked again from another record (its own went into
   * something else) reaches `beforeSend` with the new tag, and a caller that told its other devices
   * which record the payment spends says so again there.
   */
  beforeTransfers?: (lines: readonly QueuedLine[]) => Promise<void>;
  /**
   * A look in the account's own sent transfers, asked before a payment is called unconfirmed. Without
   * one (or when it throws) every such look answers "unknown".
   */
  findPayment?: (query: PaymentQuery) => Promise<PaymentLookup>;
};

export type PayQueueResult = {
  settled: { workerId: string; transactionId: string; height?: number; feeMicrocredits?: bigint; found?: true }[];
  failed: { workerId: string; failure: string }[];
  /** May have gone through: check before paying again. */
  unconfirmed: { workerId: string; failure: string }[];
  /** Set when the run stopped before everyone it set out to ask for was paid. */
  stalled?: Stall;
};

/** A transfer whose outcome isn't known: it may have gone through. `said`: the wallet's own words, when it gave any. */
export class UnknownOutcome extends RailError {
  constructor(
    message: string,
    readonly said?: string,
  ) {
    super(message);
    this.name = "UnknownOutcome";
  }
}

/** One of Shield's two answers that mean nothing moved: a rejection that says why, or an approval left until it expired. */
export class DefiniteFailure extends RailError {
  constructor(message: string) {
    super(message);
    this.name = "DefiniteFailure";
  }
}

const CHECK = "Check Shield's activity before paying again.";

/** How an unconfirmed line starts once its try ended a while ago and the record it set aside is still unspent. */
export const NOT_SEEN = "Not seen on chain yet";
/** How an unconfirmed line starts when the record it set aside is known to have gone into something else. */
export const NOT_PAID = "Not paid";

const NOT_SEEN_YET = `${NOT_SEEN}: the record this payment spends is still unspent, so it hasn't gone through so far. It may still land. ${CHECK}`;
const NOT_PAID_RECORD_USED = `${NOT_PAID}: the record set aside for this payment went into something else in this account (Shield combines records on its own), and no transfer paid them this amount. Pay again to send it.`;
const RECORD_GONE = `The record this payment was spending is gone, so it may have gone through. ${CHECK}`;
/** Shield gave up on the request, or threw on it, in words that don't say whether the transfer reached the chain. */
const problem = (said: string) => `Shield reported a problem (${said.replace(/\s+/g, " ").trim().slice(0, 200)}); the payment may still go through. ${CHECK}`;
/** How a line starts when the step before the first payment (`beforeTransfers`) stopped the run: no payment was asked of Shield. */
export const NOTHING_PAID = "Nothing was paid";
/**
 * The same, for a payment the books held as pending with a record set aside when the run reached it: this run asked
 * for nothing, and an earlier try with that record, if there was one, is still open.
 */
export const NOTHING_ASKED = "Nothing was asked of Shield this time";
const stillOpen = (said: string) => `${NOTHING_ASKED} (${said.replace(/\s+/g, " ").trim().replace(/\.$/, "")}); if it was asked for before, that payment may still go through. ${CHECK}`;
// Why a run stopped, to follow "Stalled at 2 of 3: ".
/** The wallet lists no record that covers the next payment, two minutes after the last one. */
export const NOT_LISTED = "Shield hasn't listed a record that covers the next payment yet (what the last payment left can take a minute to show), so nothing more was asked for";
/** A payment didn't settle: its own line says what became of it. */
export const NOT_ASKED = "that payment didn't settle, so the ones after it weren't asked for";

/** A tag for a record: the first 16 bytes of SHA-256 over its plaintext, hex. Enough to find it again; the plaintext itself isn't kept. */
export async function recordTag(plaintext: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext)));
  return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const ACCEPTED = new Set(["accepted", "finalized", "confirmed", "completed"]);
// The words a wallet uses once it has stopped working on a request (adapter 1.5.0's `TransactionStatus`, the two older
// words, and Shield's "interrupted"). None of them, alone, says whether the transfer reached the chain.
const GAVE_UP = new Set(["rejected", "failed", "aborted", "expired", "cancelled", "refunded", "interrupted"]);
const APPROVAL_EXPIRED = /approval expired/i;

/** Shield's two answers that mean nothing moved: a rejection that says why, and an approval left until it expired. */
const isDefinite = (status: string, reason: string): boolean => APPROVAL_EXPIRED.test(reason) || (status === "rejected" && reason !== "");

/** An account no payment may go to: the zero address, or the address of a program the app knows (`@pnw/config`). */
export const isUnpayable = (address: string): boolean => address === ZERO_ADDRESS || isProgramAddress(address);

export const isOnChainId = (id: string | undefined): id is string => typeof id === "string" && id.startsWith("at1");

/** The paychecks a run still owes: pending (sent or not) and failed, with something to pay. */
export function outstanding<P extends QueuedPayment>(run: { paychecks: readonly P[] }): P[] {
  return run.paychecks.filter((p) => p.settlement.status !== "settled" && p.net > 0n);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Whether the record tagged `attempt` (`recordTag`) is still among the account's unspent records, as the wallet lists them now. */
export async function recordStillListed(wallet: RailWallet, attempt: string): Promise<boolean> {
  for (const r of await fetchTokenRecords(wallet)) if ((await recordTag(r.plaintext)) === attempt) return true;
  return false;
}

/** The chain's height now, when the explorer says: a floor for a later look, never a condition of paying. */
async function latestHeight(network: RailNetwork): Promise<number | undefined> {
  try {
    const height = await network.fetchJson("block/height/latest");
    return typeof height === "number" && Number.isInteger(height) && height >= 0 ? height : undefined;
  } catch {
    return undefined;
  }
}

/** What is kept with a payment between runs: the wallet's id for it, its record's tag, its floor, and when its last try ended. */
type Kept = { reference?: string; attempt?: string; since?: number; endedAt?: string };
type Line = { workerId: string; to: string; minor: bigint };
/** A record as the wallet lists it now, with its tag. */
type Listed = TokenRecord & { tag: string };
/** What became of asking for one transfer. "none": its record went into something else and nothing paid them, so it may be asked again. */
type Outcome = "settled" | "stopped" | "none";

const total = (records: readonly TokenRecord[]): bigint => records.reduce((sum, r) => sum + r.amount, 0n);

class Timer {
  constructor(
    private readonly clock: Clock,
    private readonly sleep: Sleep,
    private readonly limits: PayQueueLimits,
  ) {}

  /** Polls `probe` with an adaptive interval until it returns a value or `capMs` passes. */
  async until<T>(capMs: number, probe: () => Promise<T | null | undefined>): Promise<T | undefined> {
    const start = this.clock.now();
    let interval = this.limits.pollMinMs;
    for (;;) {
      await this.sleep(interval);
      const result = await probe();
      if (result !== null && result !== undefined) return result;
      if (this.clock.now() - start >= capMs) return undefined;
      interval = Math.min(Math.round(interval * 1.5), this.limits.pollMaxMs);
    }
  }

  /** `probe` now, and if it has nothing yet, polled until it has or `capMs` passes. */
  async soon<T>(capMs: number, probe: () => Promise<T | null | undefined>): Promise<T | undefined> {
    return (await probe()) ?? (await this.until(capMs, probe));
  }
}

export async function runPayQueue(ctx: PayQueueContext): Promise<PayQueueResult> {
  const { wallet, network, run, links } = ctx;
  const emit = ctx.onProgress ?? (() => {});
  const limits = { ...DEFAULT_LIMITS, ...ctx.limits };
  const clock = ctx.clock ?? systemClock;
  const timer = new Timer(clock, ctx.sleep ?? systemSleep, limits);
  const result: PayQueueResult = { settled: [], failed: [], unconfirmed: [] };

  if (run.mode !== "rail") throw new RailError("This run isn't paid on the rail");
  const due = outstanding(run);
  if (due.length === 0) return result;
  for (const p of due) if (!links.get(p.workerId)) throw new RailError("Someone in this run has no account on the rail yet");
  // Nobody holds a key for the zero address or for a program's, so a payment to one could never be spent: stop before records are read or anything is signed.
  for (const p of due) if (isUnpayable(links.get(p.workerId)!)) throw new RailError("Someone in this run has an account that can't be paid; nothing was sent");

  // Every transaction this run has settled a payment with: one transfer settles one payment.
  const used = new Set<string>();
  // Whether a payment settled in this run of the queue: what it left may not be listed yet, so a record is worth waiting for.
  let arriving = false;
  const settle = (workerId: string, c: ConfirmedTransaction, found = false) => {
    used.add(c.transactionId);
    arriving = true;
    const entry = {
      workerId,
      transactionId: c.transactionId,
      ...(c.height !== undefined ? { height: c.height } : {}),
      ...(c.feeMicrocredits !== undefined ? { feeMicrocredits: c.feeMicrocredits } : {}),
      ...(found ? { found: true as const } : {}),
    };
    result.settled.push(entry);
    emit({ kind: "settled", ...entry });
  };
  const fail = (workerId: string, failure: string, kept: Kept = {}) => {
    result.failed.push({ workerId, failure });
    emit({ kind: "failed", workerId, failure, ...(kept.attempt ? { attempt: kept.attempt } : {}), ...(kept.since !== undefined ? { since: kept.since } : {}) });
  };
  const unconfirmed = (workerId: string, failure: string, kept: Kept = {}) => {
    result.unconfirmed.push({ workerId, failure });
    emit({ kind: "unconfirmed", workerId, failure, ...kept });
  };
  /** An unconfirmed line, with when its try ended: the first time it was reported, kept after that. */
  const ended = (kept: Kept): Kept & { endedAt: string } => ({ ...kept, endedAt: kept.endedAt ?? new Date(clock.now()).toISOString() });

  /** The caller's look in the account's own transfers; "unknown" without one, when it throws, or when it names a transfer already used. */
  const look = async (line: Line, kept: Kept, ids: readonly string[]): Promise<PaymentLookup> => {
    if (!ctx.findPayment) return "unknown";
    let answer: PaymentLookup;
    try {
      answer = await ctx.findPayment({ ...line, ids: [...ids], ...(kept.attempt ? { attempt: kept.attempt } : {}), ...(kept.since !== undefined ? { since: kept.since } : {}) });
    } catch {
      return "unknown";
    }
    if (answer === "none" || answer === "unknown") return answer;
    if (!isOnChainId(answer?.found) || used.has(answer.found)) return "unknown";
    used.add(answer.found); // taken now: another line asking at the same moment can't be handed the same transfer
    return answer;
  };

  /**
   * A payment whose outcome the wallet didn't settle. It is looked for in the account's own transfers
   * first, and settled if it is there (the explorer read back for its fee and height, and believed
   * if it says the transaction was rejected). Otherwise it is unconfirmed, and `failure` says which
   * of three things is known: its record went into something else (not paid); its try ended a while
   * ago and its record is still unspent (`listed`: not seen on chain yet); or neither (`why`).
   * With `again`, a payment known not to have been paid is not reported: "none" comes back instead,
   * for the caller to ask for it again from another record.
   */
  const unknown = async (line: Line, why: string, kept: Kept, ids: readonly string[], listed = false, again = false): Promise<Outcome> => {
    const answer = await look(line, kept, ids);
    if (typeof answer === "object") {
      try {
        settle(line.workerId, (await confirmTransaction(network, answer.found)) ?? { transactionId: answer.found }, true);
        return "settled";
      } catch (e) {
        if (!(e instanceof TransactionRejected)) {
          settle(line.workerId, { transactionId: answer.found }, true);
          return "settled";
        }
      }
    }
    if (answer === "none" && again) return "none";
    const at = ended(kept);
    const waited = clock.now() - Date.parse(at.endedAt) >= limits.notSeenAfterMs;
    const failure = answer === "none" ? NOT_PAID_RECORD_USED : listed && waited ? NOT_SEEN_YET : why;
    unconfirmed(line.workerId, failure, at);
    return "stopped";
  };
  /** What became of a transfer the wallet took: failed only on a definite answer; anything else is looked for, then unconfirmed. */
  const conclude = async (line: Line, e: unknown, kept: Kept, ids: readonly string[], listed = false, again = false): Promise<Outcome> => {
    if (!(e instanceof DefiniteFailure || e instanceof TransactionRejected)) return unknown(line, message(e), kept, ids, listed, again);
    fail(line.workerId, message(e), kept);
    return "stopped";
  };

  /** Polls the wallet for one transaction, then the explorer; resolves the confirmed transaction, or throws (UnknownOutcome when it may still go through). */
  async function awaitTransaction(walletId: string, onBroadcast?: (id: string) => void, capMs = limits.walletCapMs): Promise<ConfirmedTransaction> {
    let onChainId: string | undefined = isOnChainId(walletId) ? walletId : undefined;
    const accepted = await timer.until(capMs, async () => {
      let status: Awaited<ReturnType<RailWallet["transactionStatus"]>>;
      try {
        status = await wallet.transactionStatus(walletId);
      } catch {
        return null; // the wallet may not know the id yet; keep asking
      }
      if (isOnChainId(status.transactionId) && status.transactionId !== onChainId) {
        onChainId = status.transactionId;
        onBroadcast?.(onChainId);
      }
      const s = status.status.toLowerCase();
      const reason = status.error?.trim() ?? "";
      if (isDefinite(s, reason)) throw new DefiniteFailure(reason);
      // Shield has stopped working on it, in words that don't say whether it landed: stop asking, and look.
      if (GAVE_UP.has(s)) throw new UnknownOutcome(problem(reason || s), reason || undefined);
      return ACCEPTED.has(s) ? true : null;
    });
    if (!accepted) throw new UnknownOutcome(`No answer from Shield in time; it may still go through. ${CHECK}`);
    if (!onChainId) throw new UnknownOutcome(`Shield accepted the payment but gave no transaction id. ${CHECK}`);
    // Only the explorer saying "rejected" is an answer; one that can't be reached just hasn't confirmed it yet.
    const confirmed = await timer.until(limits.confirmCapMs, async () => {
      try {
        return await confirmTransaction(network, onChainId!);
      } catch (e) {
        if (e instanceof TransactionRejected) throw e;
        return null;
      }
    });
    // The wallet saw it accepted; if the explorer is slow to index, settle on the id alone.
    return confirmed ?? { transactionId: onChainId };
  }

  // ---- Where each payment stands ---------------------------------------------------
  const list = async (): Promise<Listed[]> => Promise.all((await fetchTokenRecords(wallet)).map(async (r) => ({ ...r, tag: await recordTag(r.plaintext) })));
  /** The wallet's records now; null when it couldn't be asked this time (a later ask may do). */
  const relist = (): Promise<Listed[] | null> => list().catch(() => null);
  // The first read isn't caught: if the wallet can't list the account's records, nothing is asked of it.
  let records = await list();

  // The floor for a later look at a payment first asked for in this run. One asked for on an earlier run keeps
  // the floor it was given then; none is made up for one that never had one.
  const neverAsked = (p: QueuedPayment) => !p.settlement.attempt && !p.settlement.reference;
  const startHeight = due.some(neverAsked) ? await latestHeight(network) : undefined;
  const lineOf = (p: QueuedPayment): Line => ({ workerId: p.workerId, to: links.get(p.workerId)!, minor: centsToMinor(p.net) });
  const keptOf = (p: QueuedPayment): Kept => {
    const since = p.settlement.since ?? (neverAsked(p) ? startHeight : undefined);
    return {
      ...(p.settlement.attempt ? { attempt: p.settlement.attempt } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(p.settlement.endedAt ? { endedAt: p.settlement.endedAt } : {}),
    };
  };

  // Paychecks already sent before a reload are asked about, never sent again.
  const inFlight = due.filter((p) => p.settlement.status === "pending" && p.settlement.reference);
  /** The record a payment's last try set aside, if the wallet still lists it and it still covers the payment. */
  const own = (p: QueuedPayment, among: readonly Listed[]): Listed | undefined => {
    const tag = p.settlement.attempt;
    const same = tag ? among.find((r) => r.tag === tag) : undefined;
    return same && same.amount >= centsToMinor(p.net) ? same : undefined;
  };
  // One that got as far as asking Shield goes again only by spending the very record it tried. If that record is
  // gone, it was spent by this payment or by something else: it is looked for, never asked again here.
  const gone = due.filter((p) => !inFlight.includes(p) && p.settlement.attempt && !own(p, records));
  // The rest are asked of Shield, in the run's order.
  const chain = due.filter((p) => !inFlight.includes(p) && !gone.includes(p));
  emit({ kind: "planned", transfers: chain.length + inFlight.length });

  const resumeOne = async (p: QueuedPayment) => {
    const reference = p.settlement.reference!;
    const kept = keptOf(p);
    const ids = isOnChainId(reference) ? [reference] : [];
    try {
      emit({ kind: "sent", workerId: p.workerId, reference, ...kept });
      settle(
        p.workerId,
        await awaitTransaction(
          reference,
          (id) => {
            ids.push(id);
            emit({ kind: "broadcast", workerId: p.workerId, transactionId: id });
          },
          limits.resumeCapMs,
        ),
      );
    } catch (e) {
      // Whether the record it set aside is still unspent: once enough time has gone by, that says it hasn't landed so far.
      const listed = kept.attempt ? await recordStillListed(wallet, kept.attempt).catch(() => false) : false;
      await conclude(lineOf(p), e, { reference, ...kept }, ids, listed);
    }
  };
  // ---- First, the payments earlier runs left open: no prompt is raised for any of them ----
  await Promise.allSettled(inFlight.map(resumeOne));
  for (const p of gone) await unknown(lineOf(p), RECORD_GONE, keptOf(p), []);
  if (chain.length === 0) return result;

  // ---- Plan ---------------------------------------------------------------------
  // Records this run has spent, or learned were spent: the wallet's list can be a moment behind the chain.
  const spent = new Set<string>();
  // The tag each open payment in the run has set aside: its record is no other payee's to take.
  const setAside = new Map(due.flatMap((p) => (p.settlement.attempt ? [[p.settlement.attempt, p.workerId] as const] : [])));
  /** The records free to pay `p` from: listed, not spent in this run, and not set aside for anyone else. */
  const freeFor = (p: QueuedPayment, among: readonly Listed[]): Listed[] => among.filter((r) => !spent.has(r.plaintext) && (setAside.get(r.tag) ?? p.workerId) === p.workerId);
  /** The plan for the payments from `from` on (a position in `chain`), made from `among`. Throws, in the plan's own words, when they can't all be made. */
  const planFrom = (from: number, among: readonly Listed[]) => {
    const open = among.filter((r) => !spent.has(r.plaintext));
    const payees = chain.slice(from).map((p) => {
      const same = own(p, open);
      return { workerId: p.workerId, amount: centsToMinor(p.net), ...(same ? { record: same.plaintext } : {}) };
    });
    // A record someone has set aside is in the plan only as that payee's own.
    const theirs = new Set(payees.flatMap((p) => (p.record !== undefined ? [p.record] : [])));
    return planTransfers(
      payees,
      open.filter((r) => !setAside.has(r.tag) || theirs.has(r.plaintext)),
    );
  };
  const check = (among: readonly Listed[]) => void planFrom(0, among);
  const fits = (among: readonly Listed[]): boolean => {
    try {
      check(among);
      return true;
    } catch {
      return false;
    }
  };
  /**
   * The record the payment at `index` in `chain` spends, out of `among`: the one the plan for the
   * payments still to make gives it, so the people after it are left a record that covers them. When
   * no plan pays them all from what is listed (a record the people after it were counting on went
   * elsewhere mid-run), the one this payment alone would take: it is made if it can be, and the run
   * stops where it can't go on.
   */
  const choose = (index: number, among: readonly Listed[]): Listed | undefined => {
    const p = chain[index]!;
    try {
      const first = planFrom(index, among).transfers[0]?.record;
      const planned = first?.kind === "existing" ? among.find((r) => r.plaintext === first.plaintext) : undefined;
      if (planned) return planned;
    } catch {
      // No plan for everyone still to come: this payment's own pick, below.
    }
    return pickRecord(centsToMinor(p.net), freeFor(p, among));
  };
  // What a payment settled just now left behind may not be listed yet: give it the wait a payment's change gets.
  if (!fits(records) && arriving) {
    await timer.until(limits.recordWaitMs, async () => {
      const now = await relist();
      if (now) records = now;
      return now && fits(now) ? true : null;
    });
  }
  check(records); // short, or no single record covers someone: nothing is asked of Shield

  // ---- One proof per run -------------------------------------------------------
  const proof = await exclusionProofFor(wallet.address, network, ctx.tree);

  // ---- Payments, one at a time -----------------------------------------------------
  const of = chain.length;
  const stall = (at: number, why: string) => {
    result.stalled = { at, of, why };
    emit({ kind: "stalled", at, of, why });
  };

  /** A record for the payment at `index` in `chain` from what the wallet lists now; when something this run settled may still be on its way, waited for. */
  const recordFor = async (index: number): Promise<Listed | null> => {
    const pick = async () => {
      const now = await relist();
      if (now) records = now;
      return now ? (choose(index, now) ?? null) : null;
    };
    return (await (arriving ? timer.soon(limits.recordWaitMs, pick) : pick())) ?? null;
  };

  /** Asks Shield for one transfer from `record` (its tag already kept) and waits for what became of it. */
  const sendOne = async (line: Line, record: Listed, kept: Kept, step: number, again: boolean): Promise<Outcome> => {
    let transactionId: string;
    try {
      emit({ kind: "approving", workerId: line.workerId, to: line.to, minor: line.minor, step, of });
      ({ transactionId } = await wallet.executeTransaction({
        program: USDCX_PROGRAM,
        function: TRANSFER_FUNCTION,
        inputs: [line.to, `${line.minor}u128`, record.plaintext, proof],
        privateFee: false,
      }));
    } catch (e) {
      // A request the app stopped before Shield was asked, and an approval left until it expired, moved nothing:
      // the line fails and keeps its record for the retry. Whatever else Shield throws (turned down, interrupted,
      // restarted, an error after the transfer went out) doesn't say either way: the next run asks again with the
      // same record if it is still listed, so only one of the two can land.
      if (stoppedBeforeWallet(e) || APPROVAL_EXPIRED.test(message(e))) {
        fail(line.workerId, message(e), kept);
        return "stopped";
      }
      return unknown(line, problem(message(e)), kept, [], false, again);
    }
    emit({ kind: "sent", workerId: line.workerId, reference: transactionId, ...kept });
    const ids = isOnChainId(transactionId) ? [transactionId] : [];
    try {
      settle(
        line.workerId,
        await awaitTransaction(transactionId, (id) => {
          ids.push(id);
          emit({ kind: "broadcast", workerId: line.workerId, transactionId: id });
        }),
      );
      return "settled";
    } catch (e) {
      return conclude(line, e, { reference: transactionId, ...kept }, ids, false, again);
    }
  };

  // Whether the step before the first payment has been run: once in a run, however many times Shield is then asked.
  let stepped = false;

  /**
   * Pays one payee, from `first`. Resolves the record the payment spent and what was free to it
   * beforehand, or null when it didn't settle (its line has said why).
   */
  const payOne = async (index: number, first: Listed): Promise<{ record: Listed; before: bigint } | null> => {
    const p = chain[index]!;
    const step = index + 1;
    const line = lineOf(p);
    const since = keptOf(p).since;
    // What the caller holds for this payment: the tag an earlier run kept, then each one kept here.
    let held: Kept = p.settlement.attempt ? { attempt: p.settlement.attempt, ...(since !== undefined ? { since } : {}) } : {};
    // An earlier try whose outcome isn't known, as the books held it when this run reached it: it may still land.
    const open = p.settlement.status === "pending" && p.settlement.attempt ? ended(keptOf(p)) : null;
    let record = first;
    for (let asks = 1; ; asks++) {
      const before = total(freeFor(p, records));
      const kept: Kept = { attempt: record.tag, ...(since !== undefined ? { since } : {}) };
      try {
        await ctx.beforeSend?.(p.workerId, record.tag, since);
      } catch (e) {
        // Nothing was asked with this record. An earlier try that may still land, its record the one about to be asked
        // again, stays unconfirmed with when it ended; any other line keeps only what the caller already held for it.
        if (open && asks === 1) unconfirmed(p.workerId, stillOpen(message(e)), open);
        else fail(p.workerId, message(e), held);
        return null;
      }
      if (!stepped) {
        stepped = true;
        try {
          await ctx.beforeTransfers?.(
            chain.slice(index).map((q, i): QueuedLine => {
              const attempt = i === 0 ? record.tag : q.settlement.attempt;
              return { ...lineOf(q), ...(attempt ? { attempt } : {}) };
            }),
          );
        } catch (e) {
          // No payment was asked of Shield this time. A line whose earlier try may still land stays unconfirmed, with
          // that try's record and when it ended. Any other drops the tag just kept: it is left what it held before.
          if (open) unconfirmed(p.workerId, stillOpen(message(e)), open);
          else fail(p.workerId, `${NOTHING_PAID}: ${message(e)}`, held);
          return null;
        }
      }
      held = kept;
      const outcome = await sendOne(line, record, kept, step, asks < MAX_ASKS);
      if (outcome === "stopped") return null;
      spent.add(record.plaintext); // by this payment, or by whatever it went into: the wallet's list may still show it
      if (outcome === "settled") return { record, before };
      // Its record went into something else and nothing paid them: ask again, from a record listed now.
      arriving = true;
      const next = await recordFor(index);
      if (!next) {
        unconfirmed(p.workerId, NOT_PAID_RECORD_USED, ended(kept));
        return null;
      }
      record = next;
    }
  };

  for (const [index, p] of chain.entries()) {
    const step = index + 1;
    let record: Listed | null;
    if (p.settlement.attempt) {
      const now = await relist();
      if (now) records = now;
      record = now ? (own(p, now.filter((r) => !spent.has(r.plaintext))) ?? null) : null;
      if (now && !record) {
        // Its record has gone since this run began: looked for, like the ones that were gone at the start, and the run goes on.
        await unknown(lineOf(p), RECORD_GONE, keptOf(p), []);
        continue;
      }
    } else {
      record = await recordFor(index);
    }
    if (!record) {
      stall(step, NOT_LISTED);
      break;
    }
    const paid = await payOne(index, record);
    if (!paid) {
      if (step < of) stall(step, NOT_ASKED);
      break;
    }
    // Before the next payment is asked for, what this one left has to be listed: as its change, or as part of a
    // record Shield combined it into. Until then, a record picked now could be gone by the time its prompt is approved.
    if (step < of && paid.record.amount > centsToMinor(p.net)) {
      const expected = paid.before - centsToMinor(p.net);
      const seen = await timer.soon(limits.recordWaitMs, async () => {
        const now = await relist();
        if (now) records = now;
        return now && total(freeFor(p, now)) >= expected ? true : null;
      });
      if (!seen) {
        stall(step + 1, NOT_LISTED);
        break;
      }
    }
  }
  return result;
}
