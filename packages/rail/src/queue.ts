// ---------------------------------------------------------------------------
// The pay queue: settles a posted rail run, one `transfer_private` per payee.
//
//   1. Plan: which record pays whom (plan.ts); split records first if there
//      aren't enough (sequential, each split spends the last one's remainder).
//   2. Prove once: the sender's freeze-list exclusion proof, shared by every
//      transfer (exclusion.ts).
//   3. Fire every transfer at once. Each: ask the wallet (Shield prompts
//      once) → poll the wallet until it reports the on-chain id and
//      acceptance, or gives up → read the confirmed transaction back from
//      the explorer for the fee the employer actually paid and the block
//      height → report settled; a definite failure → report failed;
//      anything else → report unconfirmed.
//
// What is definite (2026-11-14). Shield has two answers that mean nothing
// moved: a rejection that says why, and an approval left until it expired
// (that line keeps its record for the retry). The explorer saying a
// transaction was rejected is the third. Everything else Shield may say
// (failed, interrupted, restarted, an error thrown by the request, no
// answer) doesn't say either way: a transfer reported failed has reached the
// chain afterwards. Before such a payment is called anything, it is looked
// for in the account's own transfers (`findPayment`, when the caller has
// one) and settled if it is there. Otherwise it is unconfirmed, its record's
// tag and the wallet's id kept. From five minutes after the try ended, while
// the record it set aside is still unspent, the line says "Not seen on chain
// yet": it may still land. That is a label; nothing is sent because of it.
//
// Never paying twice (2026-10-22, the security review): before Shield is
// asked for a transfer, the caller keeps a tag for the record it will spend
// (`beforeSend`, awaited: if it can't be kept, nothing is sent). On a later
// run, a paycheck with that tag is sent again only by spending the same
// record, so if the first transfer is still on its way the network lets
// only one through; if the record is gone, the payment may have gone out,
// and it is reported unconfirmed instead (the person checks Shield's
// activity, and pays again only by choice). A transfer Shield never answered
// for, or accepted without an id, is unconfirmed too, never failed, and an
// explorer that can't be reached only delays confirming.
//
// Failures are per payee. The queue takes whatever is still pending or
// failed in the run, so calling it again resumes: a pending paycheck that
// already carries the wallet's id for its transfer (sent before a reload) is
// polled, never sent twice. The caller writes each outcome to the vault as
// the events arrive; the queue itself keeps no state.
// ---------------------------------------------------------------------------

import type { PayRun, Paycheck } from "@pnw/payroll";
import { TransactionRejected, confirmTransaction, type ConfirmedTransaction } from "./confirm";
import { type MerkleTreeApi, exclusionProofFor } from "./exclusion";
import { type RecordRef, type SplitStep, type Transfer, type TransferPlan, planTransfers } from "./plan";
import { USDCX_PROGRAM, type TokenRecord, centsToMinor, fetchTokenRecords } from "./records";
import { type Clock, RailError, type RailNetwork, type RailWallet, type Sleep, systemClock, systemSleep } from "./types";

export const TRANSFER_FUNCTION = "transfer_private";
export const SPLIT_FUNCTION = "split";

export type PayQueueLimits = {
  /** How long to wait on the wallet for one transaction. Default 15 minutes. */
  walletCapMs: number;
  /** How long to ask the wallet again about a transfer sent on an earlier run. Default 2 minutes. */
  resumeCapMs: number;
  /** After the wallet reports acceptance, how long to wait for the explorer to index it. Default 3 minutes. */
  confirmCapMs: number;
  /** After a split, how long to wait for the wallet to show the new records. Default 2 minutes. */
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
  | { kind: "planned"; transfers: number; splits: number; change: bigint }
  | { kind: "splitting"; step: number; of: number }
  | { kind: "split_done"; step: number; of: number }
  /** Waiting on the wallet to prove and sign (Shield is showing its prompt). */
  | { kind: "approving"; workerId: string }
  /** The wallet took it; `reference` is the wallet's id for the transfer, to resume from after a reload. */
  | { kind: "sent"; workerId: string; reference: string; attempt?: string; since?: number }
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
  | { kind: "unconfirmed"; workerId: string; failure: string; reference?: string; attempt?: string; since?: number; endedAt?: string };

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
   * Called, and awaited, before Shield is asked for each transfer, with the tag of the record it
   * will spend and the chain's height when the payment was first asked for (when the explorer
   * said): the caller keeps both (books/PayPanel). If it throws, that transfer isn't sent.
   */
  beforeSend?: (workerId: string, attempt: string, since?: number) => Promise<void>;
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

  // Every transaction this run has settled a payment with: one transfer settles one payment.
  const used = new Set<string>();
  const settle = (workerId: string, c: ConfirmedTransaction, found = false) => {
    used.add(c.transactionId);
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
   */
  const unknown = async (line: Line, why: string, kept: Kept, ids: readonly string[], listed = false): Promise<void> => {
    const answer = await look(line, kept, ids);
    if (typeof answer === "object") {
      try {
        return settle(line.workerId, (await confirmTransaction(network, answer.found)) ?? { transactionId: answer.found }, true);
      } catch (e) {
        if (!(e instanceof TransactionRejected)) return settle(line.workerId, { transactionId: answer.found }, true);
      }
    }
    const endedAt = kept.endedAt ?? new Date(clock.now()).toISOString();
    const waited = clock.now() - Date.parse(endedAt) >= limits.notSeenAfterMs;
    const failure = answer === "none" ? NOT_PAID_RECORD_USED : listed && waited ? NOT_SEEN_YET : why;
    unconfirmed(line.workerId, failure, { ...kept, endedAt });
  };
  /** What became of a transfer the wallet took: failed only on a definite answer; anything else is looked for, then unconfirmed. */
  const conclude = (line: Line, e: unknown, kept: Kept, ids: readonly string[], listed = false): void | Promise<void> =>
    e instanceof DefiniteFailure || e instanceof TransactionRejected ? fail(line.workerId, message(e), kept) : unknown(line, message(e), kept, ids, listed);

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

  // ---- Plan -----------------------------------------------------------------
  const known = new Set<string>();
  let records = await fetchTokenRecords(wallet);
  for (const r of records) known.add(r.plaintext);
  // Paychecks already sent before a reload are resumed, not planned again.
  const inFlight = due.filter((p) => p.settlement.status === "pending" && p.settlement.reference);
  // One that got as far as asking Shield goes again only by spending the very record it tried, if that's still here.
  const byTag = new Map<string, TokenRecord>();
  for (const r of records) byTag.set(await recordTag(r.plaintext), r);
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
  const sinceOf = new Map(due.map((p) => [p.workerId, keptOf(p).since]));
  const pinned: Transfer[] = [];
  const spent: QueuedPayment[] = [];
  const toSend: QueuedPayment[] = [];
  for (const p of due) {
    if (inFlight.includes(p)) continue;
    const tag = p.settlement.attempt;
    if (!tag) {
      toSend.push(p);
      continue;
    }
    const same = byTag.get(tag);
    if (same && same.amount >= centsToMinor(p.net)) pinned.push({ workerId: p.workerId, amount: centsToMinor(p.net), record: { kind: "existing", plaintext: same.plaintext, amount: same.amount } });
    else spent.push(p);
  }
  const free = records.filter((r) => !pinned.some((t) => t.record.kind === "existing" && t.record.plaintext === r.plaintext));
  const fresh: TransferPlan =
    toSend.length > 0
      ? planTransfers(
          toSend.map((p) => ({ workerId: p.workerId, amount: centsToMinor(p.net) })),
          free,
        )
      : { splits: [], transfers: [], change: free.reduce((s, r) => s + r.amount, 0n) };
  const plan: TransferPlan = { ...fresh, transfers: [...pinned, ...fresh.transfers] };
  emit({ kind: "planned", transfers: plan.transfers.length + inFlight.length, splits: plan.splits.length, change: plan.change });
  // A record that is gone was spent by this payment or by something else: the account's transfers say which, when they can.
  for (const p of spent) await unknown(lineOf(p), RECORD_GONE, keptOf(p), []);

  // ---- One proof per run -------------------------------------------------------
  const proof = plan.transfers.length > 0 ? await exclusionProofFor(wallet.address, network, ctx.tree) : "";

  // ---- Splits, in order --------------------------------------------------------
  const outputs = new Map<string, TokenRecord>(); // "<split>:<amount|remainder>" → the record the wallet now holds
  const brokenSplits = new Map<number, string>(); // split index → why it didn't happen
  const resolve = (ref: RecordRef): TokenRecord | null => {
    if (ref.kind === "existing") return { plaintext: ref.plaintext, amount: ref.amount };
    return outputs.get(`${ref.split}:${ref.output}`) ?? null;
  };
  const dependsOnBroken = (ref: RecordRef): string | null => {
    if (ref.kind !== "split") return null;
    return brokenSplits.get(ref.split) ?? null;
  };

  for (const step of plan.splits) {
    const upstream = dependsOnBroken(step.source);
    if (upstream) {
      brokenSplits.set(step.index, upstream);
      continue;
    }
    emit({ kind: "splitting", step: step.index + 1, of: plan.splits.length });
    try {
      await executeSplit(step);
      emit({ kind: "split_done", step: step.index + 1, of: plan.splits.length });
    } catch (e) {
      brokenSplits.set(step.index, e instanceof UnknownOutcome && e.said ? e.said : message(e));
    }
  }

  async function executeSplit(step: SplitStep): Promise<void> {
    const source = resolve(step.source);
    if (!source) throw new RailError("A record the split needed is missing");
    const { transactionId } = await wallet.executeTransaction({
      program: USDCX_PROGRAM,
      function: SPLIT_FUNCTION,
      inputs: [source.plaintext, `${step.amount}u128`],
      privateFee: false,
    });
    known.add(source.plaintext);
    await awaitTransaction(transactionId);
    // The wallet's record view lags the chain; wait until both outputs show up.
    const found = await timer.until(limits.recordWaitMs, async () => {
      records = await fetchTokenRecords(wallet);
      const fresh = records.filter((r) => !known.has(r.plaintext));
      const amount = fresh.find((r) => r.amount === step.amount);
      const remainder = fresh.find((r) => r.amount === step.remainder && r !== amount);
      return amount && remainder ? { amount, remainder } : null;
    });
    if (!found) throw new RailError("The split went through but the wallet hasn't shown the new records yet; try again in a minute");
    known.add(found.amount.plaintext);
    known.add(found.remainder.plaintext);
    outputs.set(`${step.index}:amount`, found.amount);
    outputs.set(`${step.index}:remainder`, found.remainder);
  }

  // ---- Transfers, all at once --------------------------------------------------
  // First, in turn, each one's record and its tag, kept by the caller before anything is asked of
  // Shield (if a tag can't be kept, that transfer isn't sent); then every transfer fires at once.
  type Ready = { t: TransferPlan["transfers"][number]; record: TokenRecord; attempt: string; since?: number };
  const ready: Ready[] = [];
  for (const t of plan.transfers) {
    const broken = dependsOnBroken(t.record);
    if (broken) {
      fail(t.workerId, broken);
      continue;
    }
    const record = resolve(t.record);
    if (!record) {
      fail(t.workerId, "The record for this payment is missing");
      continue;
    }
    const attempt = await recordTag(record.plaintext);
    const since = sinceOf.get(t.workerId);
    try {
      await ctx.beforeSend?.(t.workerId, attempt, since);
    } catch (e) {
      fail(t.workerId, message(e));
      continue;
    }
    ready.push({ t, record, attempt, ...(since !== undefined ? { since } : {}) });
  }
  const sendOne = async ({ t, record, attempt, since }: Ready) => {
    const line: Line = { workerId: t.workerId, to: links.get(t.workerId)!, minor: t.amount };
    const kept: Kept = { attempt, ...(since !== undefined ? { since } : {}) };
    let transactionId: string;
    try {
      emit({ kind: "approving", workerId: t.workerId });
      ({ transactionId } = await wallet.executeTransaction({
        program: USDCX_PROGRAM,
        function: TRANSFER_FUNCTION,
        inputs: [line.to, `${t.amount}u128`, record.plaintext, proof],
        privateFee: false,
      }));
    } catch (e) {
      // An approval left until it expired moved nothing, and the line keeps its record for the retry. Whatever else
      // Shield throws (turned down, interrupted, restarted, an error after the transfer went out) doesn't say either
      // way: the next run asks again with the same record if it is still listed, so only one of the two can land.
      if (APPROVAL_EXPIRED.test(message(e))) return fail(t.workerId, message(e), kept);
      return unknown(line, problem(message(e)), kept, []);
    }
    emit({ kind: "sent", workerId: t.workerId, reference: transactionId, ...kept });
    const ids = isOnChainId(transactionId) ? [transactionId] : [];
    try {
      settle(
        t.workerId,
        await awaitTransaction(transactionId, (id) => {
          ids.push(id);
          emit({ kind: "broadcast", workerId: t.workerId, transactionId: id });
        }),
      );
    } catch (e) {
      await conclude(line, e, { reference: transactionId, ...kept }, ids);
    }
  };
  const resumeOne = async (p: QueuedPayment) => {
    const reference = p.settlement.reference!;
    const kept = keptOf(p);
    const ids = isOnChainId(reference) ? [reference] : [];
    try {
      emit({ kind: "sent", workerId: p.workerId, reference, ...(kept.attempt ? { attempt: kept.attempt } : {}), ...(kept.since !== undefined ? { since: kept.since } : {}) });
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
  await Promise.allSettled([...ready.map(sendOne), ...inFlight.map(resumeOne)]);
  return result;
}
