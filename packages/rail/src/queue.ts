// ---------------------------------------------------------------------------
// The pay queue: settles a posted rail run, one `transfer_private` per payee.
//
//   1. Plan: which record pays whom (plan.ts); split records first if there
//      aren't enough (sequential, each split spends the last one's remainder).
//   2. Prove once: the sender's freeze-list exclusion proof, shared by every
//      transfer (exclusion.ts).
//   3. Fire every transfer at once. Each: ask the wallet (Shield prompts
//      once) → poll the wallet until it reports the on-chain id and
//      acceptance, or a terminal failure → read the confirmed transaction
//      back from the explorer for the fee the employer actually paid and the
//      block height → report settled; a definite failure → report failed;
//      anything that may still have gone through → report unconfirmed.
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
};

export const DEFAULT_LIMITS: PayQueueLimits = {
  walletCapMs: 15 * 60_000,
  resumeCapMs: 2 * 60_000,
  confirmCapMs: 3 * 60_000,
  recordWaitMs: 2 * 60_000,
  recordPollMs: 4_000,
  pollMinMs: 2_000,
  pollMaxMs: 10_000,
};

export type PayQueueEvent =
  | { kind: "planned"; transfers: number; splits: number; change: bigint }
  | { kind: "splitting"; step: number; of: number }
  | { kind: "split_done"; step: number; of: number }
  /** Waiting on the wallet to prove and sign (Shield is showing its prompt). */
  | { kind: "approving"; workerId: string }
  /** The wallet took it; `reference` is the wallet's id for the transfer, to resume from after a reload. */
  | { kind: "sent"; workerId: string; reference: string; attempt?: string }
  /** The wallet reported the on-chain id. */
  | { kind: "broadcast"; workerId: string; transactionId: string }
  | { kind: "settled"; workerId: string; transactionId: string; height?: number; feeMicrocredits?: bigint }
  /** It didn't go through (or nothing was sent). `attempt`: the record it tried to spend, kept for the next run's check. */
  | { kind: "failed"; workerId: string; failure: string; attempt?: string }
  /** It may have gone through: never sent again on its own. `failure` says what to check. */
  | { kind: "unconfirmed"; workerId: string; failure: string; reference?: string; attempt?: string };

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
   * will spend: the caller keeps it (books/PayPanel). If it throws, that transfer isn't sent.
   */
  beforeSend?: (workerId: string, attempt: string) => Promise<void>;
};

export type PayQueueResult = {
  settled: { workerId: string; transactionId: string; height?: number; feeMicrocredits?: bigint }[];
  failed: { workerId: string; failure: string }[];
  /** May have gone through: check before paying again. */
  unconfirmed: { workerId: string; failure: string }[];
};

/** A transfer whose outcome isn't known: it may have gone through. */
export class UnknownOutcome extends RailError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownOutcome";
  }
}

const CHECK = "Check Shield's activity before paying again.";

/** A tag for a record: the first 16 bytes of SHA-256 over its plaintext, hex. Enough to find it again; the plaintext itself isn't kept. */
export async function recordTag(plaintext: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext)));
  return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const ACCEPTED = new Set(["accepted", "finalized", "confirmed", "completed"]);
const REJECTED = new Set(["rejected", "failed"]);

export const isOnChainId = (id: string | undefined): id is string => typeof id === "string" && id.startsWith("at1");

/** The paychecks a run still owes: pending (sent or not) and failed, with something to pay. */
export function outstanding<P extends QueuedPayment>(run: { paychecks: readonly P[] }): P[] {
  return run.paychecks.filter((p) => p.settlement.status !== "settled" && p.net > 0n);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
  const timer = new Timer(ctx.clock ?? systemClock, ctx.sleep ?? systemSleep, limits);
  const result: PayQueueResult = { settled: [], failed: [], unconfirmed: [] };

  if (run.mode !== "rail") throw new RailError("This run isn't paid on the rail");
  const due = outstanding(run);
  if (due.length === 0) return result;
  for (const p of due) if (!links.get(p.workerId)) throw new RailError("Someone in this run has no account on the rail yet");

  const settle = (workerId: string, c: ConfirmedTransaction) => {
    const entry = { workerId, transactionId: c.transactionId, ...(c.height !== undefined ? { height: c.height } : {}), ...(c.feeMicrocredits !== undefined ? { feeMicrocredits: c.feeMicrocredits } : {}) };
    result.settled.push(entry);
    emit({ kind: "settled", ...entry });
  };
  const fail = (workerId: string, failure: string, attempt?: string) => {
    result.failed.push({ workerId, failure });
    emit({ kind: "failed", workerId, failure, ...(attempt ? { attempt } : {}) });
  };
  const unconfirmed = (workerId: string, failure: string, more: { reference?: string; attempt?: string } = {}) => {
    result.unconfirmed.push({ workerId, failure });
    emit({ kind: "unconfirmed", workerId, failure, ...more });
  };
  /** What became of a transfer that was sent: unconfirmed when it may still have gone through, failed only when it definitely didn't. */
  const outcome = (workerId: string, e: unknown, more: { reference?: string; attempt?: string }) =>
    e instanceof UnknownOutcome ? unconfirmed(workerId, message(e), more) : fail(workerId, message(e), more.attempt);

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
      if (REJECTED.has(s)) throw new RailError(status.error || "The wallet reported the payment failed");
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
  for (const p of spent) {
    unconfirmed(p.workerId, `The record this payment was spending is gone, so it may have gone through. ${CHECK}`, { attempt: p.settlement.attempt! });
  }

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
      brokenSplits.set(step.index, message(e));
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
  type Ready = { t: TransferPlan["transfers"][number]; record: TokenRecord; attempt: string };
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
    try {
      await ctx.beforeSend?.(t.workerId, attempt);
    } catch (e) {
      fail(t.workerId, message(e));
      continue;
    }
    ready.push({ t, record, attempt });
  }
  const sendOne = async ({ t, record, attempt }: Ready) => {
    const recipient = links.get(t.workerId)!;
    let transactionId: string;
    try {
      emit({ kind: "approving", workerId: t.workerId });
      ({ transactionId } = await wallet.executeTransaction({
        program: USDCX_PROGRAM,
        function: TRANSFER_FUNCTION,
        inputs: [recipient, `${t.amount}u128`, record.plaintext, proof],
        privateFee: false,
      }));
    } catch (e) {
      // Declined in Shield, or it couldn't be proved; the record's check on the next run covers an answer that got lost.
      return fail(t.workerId, message(e), attempt);
    }
    emit({ kind: "sent", workerId: t.workerId, reference: transactionId, attempt });
    try {
      settle(t.workerId, await awaitTransaction(transactionId, (id) => emit({ kind: "broadcast", workerId: t.workerId, transactionId: id })));
    } catch (e) {
      outcome(t.workerId, e, { reference: transactionId, attempt });
    }
  };
  const resumeOne = async (p: QueuedPayment) => {
    const reference = p.settlement.reference!;
    const attempt = p.settlement.attempt;
    try {
      emit({ kind: "sent", workerId: p.workerId, reference, ...(attempt ? { attempt } : {}) });
      settle(p.workerId, await awaitTransaction(reference, (id) => emit({ kind: "broadcast", workerId: p.workerId, transactionId: id }), limits.resumeCapMs));
    } catch (e) {
      outcome(p.workerId, e, { reference, ...(attempt ? { attempt } : {}) });
    }
  };
  await Promise.allSettled([...ready.map(sendOne), ...inFlight.map(resumeOne)]);
  return result;
}
