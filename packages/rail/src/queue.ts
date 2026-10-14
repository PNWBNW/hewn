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
//      block height → report settled; anything else → report failed.
//
// Failures are per payee. The queue takes whatever is still pending or
// failed in the run, so calling it again resumes: a pending paycheck that
// already carries the wallet's id for its transfer (sent before a reload) is
// polled, never sent twice. The caller writes each outcome to the vault as
// the events arrive; the queue itself keeps no state.
// ---------------------------------------------------------------------------

import type { PayRun, Paycheck } from "@pnw/payroll";
import { confirmTransaction, type ConfirmedTransaction } from "./confirm";
import { type MerkleTreeApi, exclusionProofFor } from "./exclusion";
import { type RecordRef, type SplitStep, type TransferPlan, planTransfers } from "./plan";
import { USDCX_PROGRAM, type TokenRecord, centsToMinor, fetchTokenRecords } from "./records";
import { type Clock, RailError, type RailNetwork, type RailWallet, type Sleep, systemClock, systemSleep } from "./types";

export const TRANSFER_FUNCTION = "transfer_private";
export const SPLIT_FUNCTION = "split";

export type PayQueueLimits = {
  /** How long to wait on the wallet for one transaction. Default 15 minutes. */
  walletCapMs: number;
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
  | { kind: "sent"; workerId: string; reference: string }
  /** The wallet reported the on-chain id. */
  | { kind: "broadcast"; workerId: string; transactionId: string }
  | { kind: "settled"; workerId: string; transactionId: string; height?: number; feeMicrocredits?: bigint }
  | { kind: "failed"; workerId: string; failure: string };

export type PayQueueContext = {
  wallet: RailWallet;
  network: RailNetwork;
  run: Pick<PayRun, "id" | "mode" | "paychecks">;
  /** workerId → account on the rail. Every payee in the run must be here. */
  links: ReadonlyMap<string, string>;
  onProgress?: (event: PayQueueEvent) => void;
  clock?: Clock;
  sleep?: Sleep;
  limits?: Partial<PayQueueLimits>;
  /** Test seam for the SDK's Merkle tree. */
  tree?: MerkleTreeApi;
};

export type PayQueueResult = {
  settled: { workerId: string; transactionId: string; height?: number; feeMicrocredits?: bigint }[];
  failed: { workerId: string; failure: string }[];
};

const ACCEPTED = new Set(["accepted", "finalized", "confirmed", "completed"]);
const REJECTED = new Set(["rejected", "failed"]);

export const isOnChainId = (id: string | undefined): id is string => typeof id === "string" && id.startsWith("at1");

/** The paychecks a run still owes: pending (sent or not) and failed, with something to pay. */
export function outstanding(run: Pick<PayRun, "paychecks">): Paycheck[] {
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
  const result: PayQueueResult = { settled: [], failed: [] };

  if (run.mode !== "rail") throw new RailError("This run isn't paid on the rail");
  const due = outstanding(run);
  if (due.length === 0) return result;
  for (const p of due) if (!links.get(p.workerId)) throw new RailError("Someone in this run has no account on the rail yet");

  const settle = (workerId: string, c: ConfirmedTransaction) => {
    const entry = { workerId, transactionId: c.transactionId, ...(c.height !== undefined ? { height: c.height } : {}), ...(c.feeMicrocredits !== undefined ? { feeMicrocredits: c.feeMicrocredits } : {}) };
    result.settled.push(entry);
    emit({ kind: "settled", ...entry });
  };
  const fail = (workerId: string, failure: string) => {
    result.failed.push({ workerId, failure });
    emit({ kind: "failed", workerId, failure });
  };

  /** Polls the wallet for one transaction, then the explorer; resolves the confirmed transaction or throws. */
  async function awaitTransaction(walletId: string, onBroadcast?: (id: string) => void): Promise<ConfirmedTransaction> {
    let onChainId: string | undefined = isOnChainId(walletId) ? walletId : undefined;
    const accepted = await timer.until(limits.walletCapMs, async () => {
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
    if (!accepted) throw new RailError("No answer from the wallet in time; check it before trying again");
    if (!onChainId) throw new RailError("The wallet accepted the payment but gave no transaction id");
    const confirmed = await timer.until(limits.confirmCapMs, () => confirmTransaction(network, onChainId!));
    // The wallet saw it accepted; if the explorer is slow to index, settle on the id alone.
    return confirmed ?? { transactionId: onChainId };
  }

  // ---- Plan -----------------------------------------------------------------
  const known = new Set<string>();
  let records = await fetchTokenRecords(wallet);
  for (const r of records) known.add(r.plaintext);
  // Paychecks already sent before a reload are resumed, not planned again.
  const inFlight = due.filter((p) => p.settlement.status === "pending" && p.settlement.reference);
  const toSend = due.filter((p) => !inFlight.includes(p));
  const plan: TransferPlan =
    toSend.length > 0
      ? planTransfers(
          toSend.map((p) => ({ workerId: p.workerId, amount: centsToMinor(p.net) })),
          records,
        )
      : { splits: [], transfers: [], change: 0n };
  emit({ kind: "planned", transfers: plan.transfers.length + inFlight.length, splits: plan.splits.length, change: plan.change });

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
  const sendOne = async (t: TransferPlan["transfers"][number]) => {
    const broken = dependsOnBroken(t.record);
    if (broken) return fail(t.workerId, broken);
    const record = resolve(t.record);
    if (!record) return fail(t.workerId, "The record for this payment is missing");
    const recipient = links.get(t.workerId)!;
    try {
      emit({ kind: "approving", workerId: t.workerId });
      const { transactionId } = await wallet.executeTransaction({
        program: USDCX_PROGRAM,
        function: TRANSFER_FUNCTION,
        inputs: [recipient, `${t.amount}u128`, record.plaintext, proof],
        privateFee: false,
      });
      emit({ kind: "sent", workerId: t.workerId, reference: transactionId });
      settle(t.workerId, await awaitTransaction(transactionId, (id) => emit({ kind: "broadcast", workerId: t.workerId, transactionId: id })));
    } catch (e) {
      fail(t.workerId, message(e));
    }
  };
  const resumeOne = async (p: Paycheck) => {
    const reference = p.settlement.reference!;
    try {
      emit({ kind: "sent", workerId: p.workerId, reference });
      settle(p.workerId, await awaitTransaction(reference, (id) => emit({ kind: "broadcast", workerId: p.workerId, transactionId: id })));
    } catch (e) {
      fail(p.workerId, message(e));
    }
  };
  await Promise.allSettled([...plan.transfers.map(sendOne), ...inFlight.map(resumeOne)]);
  return result;
}
