import { describe, expect, it } from "vitest";
import type { Paycheck, PayRun, Settlement } from "@pnw/payroll";
import { FREEZELIST_PROGRAM } from "./exclusion";
import fixture from "./fixtures/transaction.json";
import {
  NOT_PAID,
  NOT_SEEN,
  SPLIT_NOT_FINISHED,
  type PayQueueEvent,
  type PaymentLookup,
  type PaymentQuery,
  SPLIT_FUNCTION,
  TRANSFER_FUNCTION,
  outstanding,
  recordStillListed,
  recordTag,
  runPayQueue,
} from "./queue";
import { USDCX_PROGRAM, centsToMinor } from "./records";
import { type RailNetwork, RailNetworkError, type RailWallet } from "./types";

// ---- Fakes -------------------------------------------------------------------

const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const ADDR = (n: number) => `aleo1worker${n}`.padEnd(63, "q");

type Status = { status: string; transactionId?: string; error?: string };
type Call = { program: string; function: string; inputs: string[]; fee?: number; privateFee: false; walletId: string };

const plaintextOf = (amount: bigint, nonce: string) => `{\n  owner: ${EMPLOYER}.private,\n  amount: ${amount}u128.private,\n  _nonce: ${nonce}group.public\n}`;

/**
 * A wallet that answers like Shield: executeTransaction returns an internal
 * id, transactionStatus walks a scripted list of answers for that id (the
 * last one repeats), and an accepted `split` mints the two output records
 * the way the chain would. Nothing is ever logged.
 */
class FakeWallet implements RailWallet {
  address = EMPLOYER;
  calls: Call[] = [];
  records: { recordName: string; spent: boolean; recordPlaintext: string }[] = [];
  recordRequests = 0;
  /** Every transfer that reached the chain: who it paid, how much, and its id. */
  landed: { to: string; minor: bigint; transactionId: string }[] = [];
  private n = 0;
  private scripts = new Map<string, Status[]>();
  private minted = 0;

  constructor(
    amounts: bigint[],
    /** Picks the status script for the nth executeTransaction (0-based). */
    private readonly script: (call: Call, n: number) => Status[],
  ) {
    for (const a of amounts) this.addRecord(a);
  }

  addRecord(amount: bigint) {
    this.records.push({ recordName: "Token", spent: false, recordPlaintext: plaintextOf(amount, `n${++this.minted}`) });
  }

  /** Scripts a status list for an id the wallet already knows (a transfer sent before a reload). */
  know(id: string, statuses: Status[]) {
    this.scripts.set(id, statuses);
  }

  async requestRecords(program: string): Promise<unknown[]> {
    this.recordRequests++;
    expect(program).toBe(USDCX_PROGRAM);
    return this.records.map((r) => ({ ...r }));
  }

  async executeTransaction(opts: Omit<Call, "walletId">): Promise<{ transactionId: string }> {
    const walletId = `shield_${this.n}`;
    const call = { ...opts, walletId };
    this.calls.push(call);
    this.scripts.set(walletId, this.script(call, this.n++));
    return { transactionId: walletId };
  }

  async transactionStatus(id: string): Promise<Status> {
    const script = this.scripts.get(id);
    if (!script || script.length === 0) throw new Error("not found");
    const status = script.length > 1 ? script.shift()! : script[0]!;
    if (status.status === "accepted") this.land(id, status.transactionId);
    return status;
  }

  /**
   * The chain taking a request, whatever the wallet goes on to say about it: spends the input
   * record (once: the network lets a record be spent one time); for a split, mints its two outputs.
   * True when it went through.
   */
  land(id: string, transactionId = "") {
    const call = this.calls.find((c) => c.walletId === id);
    if (!call) return false;
    const inputIndex = call.function === SPLIT_FUNCTION ? 0 : 2;
    const source = this.records.find((r) => r.recordPlaintext === call.inputs[inputIndex]);
    if (!source || source.spent) return false;
    source.spent = true;
    const sourceAmount = BigInt(/amount:\s*(\d+)u128/.exec(source.recordPlaintext)![1]!);
    const amount = BigInt(call.inputs[1]!.replace("u128", ""));
    if (call.function === SPLIT_FUNCTION) {
      this.addRecord(amount);
      this.addRecord(sourceAmount - amount);
    } else {
      this.landed.push({ to: call.inputs[0]!, minor: amount, transactionId });
      if (sourceAmount > amount) this.addRecord(sourceAmount - amount); // change
    }
    return true;
  }

  /** Shield combining the account's records on its own: every unspent one goes into a single new record. */
  combine() {
    const open = this.records.filter((r) => !r.spent);
    for (const r of open) r.spent = true;
    this.addRecord(open.reduce((sum, r) => sum + BigInt(/amount:\s*(\d+)u128/.exec(r.recordPlaintext)![1]!), 0n));
  }
}

const accepted = (id: string, pendingPolls = 0): Status[] => [...Array<Status>(pendingPolls).fill({ status: "pending" }), { status: "accepted", transactionId: id }];
const AT = (n: number) => `at1tx${n}`.padEnd(61, "x");

const HEIGHT = 4_000_000;

function fakeNetwork(opts: { frozen?: string[]; fail?: Set<string> } = {}): RailNetwork & { calls: string[] } {
  const calls: string[] = [];
  const frozen = opts.frozen ?? [];
  const base = `program/${FREEZELIST_PROGRAM}/mapping`;
  return {
    calls,
    async fetchJson(path) {
      calls.push(path);
      if (path === "block/height/latest") return HEIGHT;
      if (path === `${base}/freeze_list_count/1u8`) return `${frozen.length}u32`;
      const leaf = /freeze_list\/(\d+)u32$/.exec(path);
      if (leaf) return frozen[Number(leaf[1])];
      const tx = /^transaction\/(at1\S+)$/.exec(path);
      if (tx) {
        if (opts.fail?.has(tx[1]!)) return { status: "rejected", error: "insufficient balance" };
        return { ...fixture, id: tx[1], block_height: 4_000_000 + calls.length };
      }
      throw new RailNetworkError("not found", 404);
    },
  };
}

/** Time that passes only when the queue sleeps. */
function fakeTime(start = 0) {
  let now = start;
  return { clock: { now: () => now }, sleep: async (ms: number) => { now += ms; await Promise.resolve(); } };
}

const paycheck = (workerId: string, netCents: bigint, settlement: Settlement = { status: "pending" }): Paycheck => ({
  workerId,
  gross: netCents + 1000n,
  federalIncomeTax: 1000n,
  socialSecurity: 0n,
  medicare: 0n,
  additionalMedicare: 0n,
  employerSocialSecurity: 0n,
  employerMedicare: 0n,
  net: netCents,
  paystubHash: "ab".repeat(32),
  settlement,
});

const run = (paychecks: Paycheck[], mode: PayRun["mode"] = "rail"): Pick<PayRun, "id" | "mode" | "paychecks"> => ({ id: "run-1", mode, paychecks });
const links = (...ids: string[]) => new Map(ids.map((id, i) => [id, ADDR(i + 1)]));

/** Statuses by function and order: transfers resolve out of order, and one is rejected. */
const outOfOrder = (call: Call, n: number): Status[] => {
  if (call.function === SPLIT_FUNCTION) return accepted(AT(100 + n), 1);
  const who = call.inputs[0];
  if (who === ADDR(1)) return accepted(AT(1), 4); // slow
  if (who === ADDR(2)) return accepted(AT(2), 0); // fast
  if (who === ADDR(3)) return [{ status: "pending" }, { status: "rejected", error: "record already spent" }];
  return accepted(AT(n), 1);
};

async function settleRun(wallet: FakeWallet, network: RailNetwork, paychecks: Paycheck[], extra: Partial<Parameters<typeof runPayQueue>[0]> = {}) {
  const events: PayQueueEvent[] = [];
  const result = await runPayQueue({
    wallet,
    network,
    run: run(paychecks),
    links: links("w1", "w2", "w3", "w4", "w5"),
    onProgress: (e) => events.push(e),
    ...fakeTime(),
    limits: { recordPollMs: 1, pollMinMs: 1 },
    ...extra,
  });
  return { events, result };
}

// ---- Tests ---------------------------------------------------------------------

describe("runPayQueue", () => {
  it("fires every transfer at once, settles them as the wallet answers (out of order), and reports the one that fails", async () => {
    const wallet = new FakeWallet([centsToMinor(100_00n), centsToMinor(200_00n), centsToMinor(300_00n)], outOfOrder);
    const network = fakeNetwork();
    const { events, result } = await settleRun(wallet, network, [paycheck("w1", 100_00n), paycheck("w2", 200_00n), paycheck("w3", 300_00n)]);

    // One transfer_private per payee: recipient, amount in minor units, the exact-fit record, the proof.
    const transfers = wallet.calls.filter((c) => c.function === TRANSFER_FUNCTION);
    expect(transfers).toHaveLength(3);
    expect(wallet.calls.every((c) => c.program === USDCX_PROGRAM && c.privateFee === false && c.fee === undefined)).toBe(true);
    const w1 = transfers.find((c) => c.inputs[0] === ADDR(1))!;
    expect(w1.inputs[1]).toBe(`${centsToMinor(100_00n)}u128`);
    expect(w1.inputs[2]).toContain(`amount: ${centsToMinor(100_00n)}u128`);
    expect(w1.inputs[3]).toMatch(/^\[\{siblings: \[/);
    expect(transfers.every((c) => c.inputs[3] === w1.inputs[3])).toBe(true);

    // All three were approved before any settled: that's "fire everything, then wait".
    const kinds = events.map((e) => e.kind);
    expect(kinds.slice(0, 1)).toEqual(["planned"]);
    expect(kinds.filter((k) => k === "approving")).toHaveLength(3);
    expect(kinds.indexOf("settled")).toBeGreaterThan(kinds.lastIndexOf("approving"));

    // Settled in the order the chain answered, not the order they were sent.
    const settled = events.filter((e): e is Extract<PayQueueEvent, { kind: "settled" }> => e.kind === "settled");
    expect(settled.map((e) => e.workerId)).toEqual(["w2", "w1"]);
    expect(settled.every((e) => e.feeMicrocredits === 51_580n && typeof e.height === "number")).toBe(true);
    expect(settled.find((e) => e.workerId === "w1")!.transactionId).toBe(AT(1));
    expect(result.settled).toHaveLength(2);
    expect(result.failed).toEqual([{ workerId: "w3", failure: "record already spent" }]);

    // Each transfer reported its wallet id (to resume from) and its on-chain id.
    expect(events.filter((e) => e.kind === "sent")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "broadcast").map((e) => (e as { transactionId: string }).transactionId).sort()).toEqual([AT(1), AT(2)].sort());
  });

  it("builds the exclusion proof once for N transfers", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(10_00n), centsToMinor(10_00n), centsToMinor(10_00n)], (_c, n) => accepted(AT(n)));
    const network = fakeNetwork({ frozen: ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"] });
    let formats = 0;
    const tree = {
      generateLeaves: (a: string[]) => a.map((_x, i) => `${i + 1}field`).concat("0field"),
      buildTree: (l: string[]) => l.map((_x, i) => BigInt(i)),
      getLeafIndices: () => [0, 1] as [number, number],
      getSiblingPath: (_t: bigint[], leaf_index: number, depth: number) => ({ siblings: Array<bigint>(depth).fill(0n), leaf_index }),
      formatMerkleProof: () => (formats++, "[PROOF]"),
    };
    const { result } = await settleRun(wallet, network, ["w1", "w2", "w3", "w4"].map((w) => paycheck(w, 10_00n)), { tree });
    expect(result.settled).toHaveLength(4);
    expect(formats).toBe(1);
    expect(network.calls.filter((p) => p.includes("freeze_list_count"))).toHaveLength(1);
    expect(wallet.calls.every((c) => c.inputs[3] === "[PROOF]")).toBe(true);
  });

  it("splits one big record into what the transfers need, in order, before paying", async () => {
    const wallet = new FakeWallet([centsToMinor(1000_00n)], (c, n) => accepted(AT(n), c.function === SPLIT_FUNCTION ? 1 : 0));
    const { events, result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 100_00n), paycheck("w2", 250_00n), paycheck("w3", 50_00n)]);
    const splits = wallet.calls.filter((c) => c.function === SPLIT_FUNCTION);
    const transfers = wallet.calls.filter((c) => c.function === TRANSFER_FUNCTION);
    expect(splits).toHaveLength(3);
    // Biggest payee first; each split spends the previous remainder.
    expect(splits.map((c) => c.inputs[1])).toEqual([`${centsToMinor(250_00n)}u128`, `${centsToMinor(100_00n)}u128`, `${centsToMinor(50_00n)}u128`]);
    expect(splits[0]!.inputs[0]).toContain(`amount: ${centsToMinor(1000_00n)}u128`);
    expect(splits[1]!.inputs[0]).toContain(`amount: ${centsToMinor(750_00n)}u128`);
    expect(splits[2]!.inputs[0]).toContain(`amount: ${centsToMinor(650_00n)}u128`);
    // Every transfer then spends exactly its own record, and all splits finished before any transfer was asked for.
    for (const t of transfers) expect(t.inputs[2]).toContain(`amount: ${t.inputs[1]!.replace("u128", "")}u128`);
    const kinds = events.map((e) => e.kind);
    expect(kinds.lastIndexOf("split_done")).toBeLessThan(kinds.indexOf("approving"));
    expect(events[0]).toEqual({ kind: "planned", transfers: 3, splits: 3, change: centsToMinor(600_00n) });
    expect(result.settled.map((s) => s.workerId).sort()).toEqual(["w1", "w2", "w3"]);
    expect(wallet.records.filter((r) => !r.spent).map((r) => r.recordPlaintext)).toHaveLength(1); // the change
  });

  it("names no fee on any call to Shield, splits and transfers alike: the wallet charges its own estimate", async () => {
    const wallet = new FakeWallet([centsToMinor(500_00n)], (_c, n) => accepted(AT(n)));
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 100_00n), paycheck("w2", 250_00n)]);
    expect(result.settled).toHaveLength(2);
    expect(wallet.calls.map((c) => c.function).sort()).toEqual([SPLIT_FUNCTION, SPLIT_FUNCTION, TRANSFER_FUNCTION, TRANSFER_FUNCTION]);
    for (const call of wallet.calls) expect(call).not.toHaveProperty("fee");
  });

  it("a failed split fails only the payees that depended on it", async () => {
    const wallet = new FakeWallet([centsToMinor(100_00n), centsToMinor(40_00n)], (c, n) =>
      c.function === SPLIT_FUNCTION ? [{ status: "failed", error: "split rejected" }] : accepted(AT(n)),
    );
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 40_00n), paycheck("w2", 30_00n), paycheck("w3", 30_00n)]);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(result.failed).toEqual([
      { workerId: "w2", failure: "split rejected" },
      { workerId: "w3", failure: "split rejected" },
    ]);
  });

  it("a split Shield gave up on without a reason, or never answered for, fails the payees waiting on it in words about the record, never 'may still go through'", async () => {
    // Nothing was sent to these payees: their line says the record wasn't prepared, and a retry is all it needs.
    for (const said of [[{ status: "failed" }], [{ status: "interrupted" }], [{ status: "pending" }]] satisfies Status[][]) {
      const wallet = new FakeWallet([centsToMinor(100_00n), centsToMinor(40_00n)], (c, n) => (c.function === SPLIT_FUNCTION ? said : accepted(AT(n))));
      const { result, events } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 40_00n), paycheck("w2", 30_00n), paycheck("w3", 30_00n)], { limits: { recordPollMs: 1, pollMinMs: 1, walletCapMs: 50 } });
      expect(result.settled.map((s) => s.workerId)).toEqual(["w1"]);
      expect(result.unconfirmed).toEqual([]);
      expect(result.failed).toEqual([
        { workerId: "w2", failure: SPLIT_NOT_FINISHED },
        { workerId: "w3", failure: SPLIT_NOT_FINISHED },
      ]);
      for (const f of result.failed) expect(f.failure).not.toMatch(/may still go through|paying again/);
      // No transfer was asked of Shield for them, and no record was set aside.
      expect(wallet.calls.filter((c) => c.function === TRANSFER_FUNCTION)).toHaveLength(1);
      expect(events.filter((e): e is Extract<PayQueueEvent, { kind: "failed" }> => e.kind === "failed").every((e) => e.attempt === undefined)).toBe(true);
    }
  });

  it("a wallet reporting failed, interrupted, aborted, expired, cancelled or refunded, or rejected without saying why, ends the wait at once as not confirmed, never failed", async () => {
    // None of these words says whether the transfer reached the chain: one reported failed has landed afterwards.
    const said: Status[] = [
      ...["failed", "interrupted", "aborted", "expired", "cancelled", "refunded"].map((status) => ({ status, error: `Shield: ${status}` })),
      { status: "failed" },
      { status: "rejected" },
      { status: "Failed", error: "Wallet restarted. Inspect transaction history" },
    ];
    for (const status of said) {
      const wallet = new FakeWallet([centsToMinor(10_00n)], () => [status]);
      const { result, events } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)]);
      expect(result.failed).toEqual([]);
      expect(result.settled).toEqual([]);
      expect(result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/may still go through.*Check Shield's activity/) }]);
      if (status.error) expect(result.unconfirmed[0]!.failure).toContain(status.error);
      expect(events.some((e) => e.kind === "failed")).toBe(false);
      // It keeps the wallet's id and the record's tag: the next run asks about it, and never spends another record for it.
      expect(events.find((e) => e.kind === "unconfirmed")).toMatchObject({ reference: "shield_0", attempt: expect.stringMatching(/^[0-9a-f]{32}$/) });
    }
  });

  it("resumes: skips settled, polls a sent one instead of re-sending it, retries a failed one", async () => {
    const wallet = new FakeWallet([centsToMinor(50_00n), centsToMinor(50_00n)], (_c, n) => accepted(AT(n)));
    wallet.know("shield_old", [{ status: "pending" }, { status: "accepted", transactionId: AT(9) }]);
    const paychecks = [
      paycheck("w1", 50_00n, { status: "settled", reference: AT(7), settledAt: "2026-10-14T00:00:00Z" }),
      paycheck("w2", 50_00n, { status: "pending", reference: "shield_old" }), // sent before the reload
      paycheck("w3", 50_00n, { status: "failed", failure: "timed out" }),
      paycheck("w4", 0n), // nothing to pay
    ];
    expect(outstanding(run(paychecks)).map((p) => p.workerId)).toEqual(["w2", "w3"]);
    const { events, result } = await settleRun(wallet, fakeNetwork(), paychecks);
    expect(wallet.calls).toHaveLength(1);
    expect(wallet.calls[0]!.inputs[0]).toBe(ADDR(3));
    expect(result.settled.map((s) => [s.workerId, s.transactionId]).sort()).toEqual([["w2", AT(9)], ["w3", AT(0)]]);
    expect(result.failed).toEqual([]);
    expect(events[0]).toEqual({ kind: "planned", transfers: 2, splits: 0, change: centsToMinor(50_00n) });
  });

  it("stops waiting on a transfer the wallet never answers for, after the cap, and calls it unconfirmed, not failed", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "pending" }]);
    const { events, result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)], { limits: { walletCapMs: 50, pollMinMs: 10, pollMaxMs: 20 } });
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/No answer from Shield.*Check Shield's activity/) }]);
    // It keeps the wallet's id, so the next run asks about it instead of paying again.
    expect(events.find((e) => e.kind === "unconfirmed")).toMatchObject({ reference: "shield_0", attempt: expect.stringMatching(/^[0-9a-f]{32}$/) });
  });

  it("settles on the wallet's word when the explorer is slow, and fails when the explorer says rejected", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(10_00n)], (c) => accepted(c.inputs[0] === ADDR(1) ? AT(1) : AT(2)));
    const slow: RailNetwork = {
      fetchJson: async (path) => {
        if (path.startsWith("transaction/")) throw new RailNetworkError("not yet", 404);
        return fakeNetwork({ fail: new Set([AT(2)]) }).fetchJson(path);
      },
    };
    const a = await settleRun(wallet, slow, [paycheck("w1", 10_00n)], { limits: { confirmCapMs: 20, pollMinMs: 10 } });
    expect(a.result.settled).toEqual([{ workerId: "w1", transactionId: AT(1) }]);

    const b = await settleRun(wallet, fakeNetwork({ fail: new Set([AT(2)]) }), [paycheck("w2", 10_00n)]);
    expect(b.result.failed).toEqual([{ workerId: "w2", failure: "insufficient balance" }]);
  });

  it("never pays twice: an explorer that can't be reached after Shield accepted only delays confirming", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], () => accepted(AT(1)));
    const down: RailNetwork = {
      fetchJson: async (path) => {
        if (path.startsWith("transaction/")) throw new RailNetworkError("Service unavailable", 503);
        return fakeNetwork().fetchJson(path);
      },
    };
    const { result } = await settleRun(wallet, down, [paycheck("w1", 10_00n)], { limits: { confirmCapMs: 20, pollMinMs: 10 } });
    expect(result).toEqual({ settled: [{ workerId: "w1", transactionId: AT(1) }], failed: [], unconfirmed: [] });
  });

  it("never pays twice: accepted without an id is unconfirmed", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "accepted" }]);
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)]);
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/gave no transaction id/) }]);
  });

  it("keeps each record's tag before asking Shield, and sends nothing for a payee whose tag couldn't be kept", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(20_00n)], (_c, n) => accepted(AT(n)));
    const log: string[] = [];
    const exec = wallet.executeTransaction.bind(wallet);
    wallet.executeTransaction = async (o) => (log.push(`send ${o.inputs[0]}`), exec(o));
    const beforeSend = async (workerId: string, attempt: string) => {
      expect(attempt).toMatch(/^[0-9a-f]{32}$/);
      log.push(`keep ${workerId}`);
      if (workerId === "w2") throw new Error("These books changed in another tab or window");
    };
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n), paycheck("w2", 20_00n)], { beforeSend });
    // Every tag kept before anything went to Shield; only w1's transfer was sent.
    expect(log.slice(0, 2).sort()).toEqual(["keep w1", "keep w2"]);
    expect(log.slice(2)).toEqual([`send ${ADDR(1)}`]);
    expect(result.settled.map((r) => r.workerId)).toEqual(["w1"]);
    expect(result.failed).toEqual([{ workerId: "w2", failure: "These books changed in another tab or window" }]);
  });

  it("never pays twice: a retry spends the very record the first try did, and one whose record is gone isn't sent", async () => {
    // w1's first try was declined: its record is still there. w2's first try went out (its record is spent).
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(30_00n), centsToMinor(10_00n)], (_c, n) => accepted(AT(n)));
    const tagOf = async (i: number) => recordTag(wallet.records[i]!.recordPlaintext);
    const w1Tag = await tagOf(1); // the 30.00 record, though a 10.00 one would fit exactly
    const w2Tag = await recordTag(plaintextOf(centsToMinor(20_00n), "gone"));
    const { events, result } = await settleRun(wallet, fakeNetwork(), [
      paycheck("w1", 10_00n, { status: "failed", failure: "Declined in Shield", attempt: w1Tag }),
      paycheck("w2", 20_00n, { status: "pending", attempt: w2Tag }), // the page closed after Shield was asked
    ]);
    const transfers = wallet.calls.filter((c) => c.function === TRANSFER_FUNCTION);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.inputs[0]).toBe(ADDR(1));
    expect(transfers[0]!.inputs[2]).toBe(wallet.records[1]!.recordPlaintext); // the same record: the network lets only one through
    expect(result.settled.map((r) => r.workerId)).toEqual(["w1"]);
    expect(result.unconfirmed).toEqual([{ workerId: "w2", failure: expect.stringMatching(/record this payment was spending is gone/) }]);
    expect(events.find((e) => e.kind === "unconfirmed")).toMatchObject({ workerId: "w2", attempt: w2Tag });
  });

  it("asks Shield again, briefly, about one sent on an earlier run, and leaves it unconfirmed if there's still no answer", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], (_c, n) => accepted(AT(n)));
    wallet.know("shield_lost", [{ status: "pending" }]);
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, { status: "pending", reference: "shield_lost", attempt: "ab".repeat(16) })], {
      limits: { resumeCapMs: 30, pollMinMs: 10, pollMaxMs: 10 },
    });
    expect(wallet.calls).toEqual([]);
    expect(result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/No answer from Shield/) }]);
  });

  it("refuses a run that isn't on the rail, a payee with no account, and a short balance before anything is signed", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], (_c, n) => accepted(AT(n)));
    const base = { wallet, network: fakeNetwork(), ...fakeTime() };
    await expect(runPayQueue({ ...base, run: run([paycheck("w1", 10_00n)], "external"), links: links("w1") })).rejects.toThrow(/isn't paid on the rail/);
    await expect(runPayQueue({ ...base, run: run([paycheck("w1", 10_00n)]), links: new Map() })).rejects.toThrow(/no account on the rail/);
    await expect(runPayQueue({ ...base, run: run([paycheck("w1", 20_00n)]), links: links("w1") })).rejects.toThrow(/Not enough balance/);
    expect(wallet.calls).toEqual([]);
    expect(await runPayQueue({ ...base, run: run([paycheck("w1", 10_00n, { status: "settled" })]), links: links("w1") })).toEqual({ settled: [], failed: [], unconfirmed: [] });
  });
});

// ---- What became of a payment ---------------------------------------------------

/** A look in the account's own transfers, over what the fake chain took: found by payee and amount, else unknown. */
const lookup =
  (wallet: FakeWallet, asked: PaymentQuery[] = []) =>
  async (q: PaymentQuery): Promise<PaymentLookup> => {
    asked.push(q);
    const hit = wallet.landed.find((l) => l.to === q.to && l.minor === q.minor);
    return hit ? { found: hit.transactionId } : "unknown";
  };

type Unconfirmed = Extract<PayQueueEvent, { kind: "unconfirmed" }>;
type Failed = Extract<PayQueueEvent, { kind: "failed" }>;
const unconfirmedIn = (events: PayQueueEvent[]) => events.find((e): e is Unconfirmed => e.kind === "unconfirmed")!;
const failedIn = (events: PayQueueEvent[]) => events.find((e): e is Failed => e.kind === "failed")!;
/** What the caller keeps for a line the queue couldn't confirm (books/PayPanel writes exactly this). */
const keptFrom = (e: Unconfirmed): Settlement => ({
  status: "pending",
  failure: e.failure,
  ...(e.reference ? { reference: e.reference } : {}),
  ...(e.attempt ? { attempt: e.attempt } : {}),
  ...(e.since !== undefined ? { since: e.since } : {}),
  ...(e.endedAt ? { endedAt: e.endedAt } : {}),
});
const NOON = Date.parse("2026-11-14T12:00:00.000Z");
const MINUTE = 60_000;

describe("runPayQueue: what became of a payment", () => {
  it("Shield says failed, the payment lands 20 s later: the line reads Not confirmed, never Failed", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "failed", error: "The operation did not return a conclusive result" }]);
    const first = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)], { findPayment: lookup(wallet), ...fakeTime(NOON) });
    expect(first.result.failed).toEqual([]);
    expect(first.result.settled).toEqual([]);
    expect(first.result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/did not return a conclusive result.*may still go through/) }]);
    expect(first.events.some((e) => e.kind === "failed")).toBe(false);
    const kept = unconfirmedIn(first.events);
    expect(kept).toMatchObject({ reference: "shield_0", attempt: await recordTag(wallet.records[0]!.recordPlaintext), since: HEIGHT });
    expect(Date.parse(kept.endedAt!)).toBeGreaterThanOrEqual(NOON);

    // Twenty seconds on, the transfer Shield gave up on reaches the chain.
    expect(wallet.land("shield_0", AT(1))).toBe(true);
    const second = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, keptFrom(kept))], { findPayment: lookup(wallet), ...fakeTime(NOON + 20_000) });
    expect(second.result.settled).toEqual([expect.objectContaining({ workerId: "w1", transactionId: AT(1), found: true })]);
    expect(second.result.failed).toEqual([]);
    expect(second.result.unconfirmed).toEqual([]);
    // Asked of Shield once, paid once.
    expect(wallet.calls).toHaveLength(1);
    expect(wallet.landed).toHaveLength(1);
  });

  it("only a rejection that says why and an approval left to expire are definite, and an expired line keeps its record", async () => {
    // Rejected with its reason: nothing moved.
    const rejected = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "rejected", error: "test_usdcx_stablecoin.aleo/transfer_private: the proof is stale" }]);
    const a = await settleRun(rejected, fakeNetwork(), [paycheck("w1", 10_00n)]);
    expect(a.result).toEqual({ settled: [], failed: [{ workerId: "w1", failure: "test_usdcx_stablecoin.aleo/transfer_private: the proof is stale" }], unconfirmed: [] });

    // The approval was left until it expired, as a status and as what the request itself threw: nothing moved either time.
    const expired = "Approval expired. Request a fresh action.";
    for (const how of ["status", "thrown"] as const) {
      const wallet = new FakeWallet([centsToMinor(25_00n)], (_c, n) => (how === "status" && n === 0 ? [{ status: "rejected", error: expired }] : accepted(AT(n))));
      if (how === "thrown") {
        const exec = wallet.executeTransaction.bind(wallet);
        let first = true;
        wallet.executeTransaction = async (o) => {
          if (!first) return exec(o);
          first = false;
          wallet.calls.push({ ...o, walletId: "never" });
          throw new Error(expired);
        };
      }
      const b = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)]);
      expect(b.result).toEqual({ settled: [], failed: [{ workerId: "w1", failure: expired }], unconfirmed: [] });
      const tag = await recordTag(wallet.records[0]!.recordPlaintext);
      expect(failedIn(b.events)).toMatchObject({ attempt: tag, since: HEIGHT });

      // A record that fits exactly arrives; the retry still spends the one the expired try had set aside.
      wallet.addRecord(centsToMinor(10_00n));
      const c = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, { status: "failed", failure: expired, attempt: tag, since: HEIGHT })]);
      expect(c.result.settled.map((r) => r.workerId)).toEqual(["w1"]);
      expect(wallet.calls.at(-1)!.inputs[2]).toBe(wallet.records[0]!.recordPlaintext);
    }
  });

  it("a request the app stopped before Shield was asked is failed in its own words, keeps its record, and is never looked for", async () => {
    // The app's own check before signing (the programs' editions) refuses, and marks its error: Shield never saw the request.
    const refusal = "Couldn't check the programs on the network before sending, so nothing was sent. Try again in a moment.";
    const wallet = new FakeWallet([centsToMinor(25_00n)], (_c, n) => accepted(AT(n)));
    const exec = wallet.executeTransaction.bind(wallet);
    let first = true;
    wallet.executeTransaction = async (o) => {
      if (!first) return exec(o);
      first = false;
      throw Object.assign(new Error(refusal), { nothingSent: true });
    };
    const asked: PaymentQuery[] = [];
    const a = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)], { findPayment: lookup(wallet, asked) });
    expect(a.result).toEqual({ settled: [], failed: [{ workerId: "w1", failure: refusal }], unconfirmed: [] });
    expect(a.result.failed[0]!.failure).not.toMatch(/may still go through/);
    expect(asked).toEqual([]);
    const tag = await recordTag(wallet.records[0]!.recordPlaintext);
    expect(failedIn(a.events)).toMatchObject({ attempt: tag, since: HEIGHT });

    // The retry spends the record the stopped try had set aside, whatever else has arrived.
    wallet.addRecord(centsToMinor(10_00n));
    const b = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, { status: "failed", failure: refusal, attempt: tag, since: HEIGHT })]);
    expect(b.result.settled.map((r) => r.workerId)).toEqual(["w1"]);
    expect(wallet.calls).toHaveLength(1);
    expect(wallet.calls[0]!.inputs[2]).toBe(wallet.records[0]!.recordPlaintext);

    // The mark is the only thing believed: the same words without it, or the mark on something that isn't an error, are not confirmed.
    for (const thrown of [new Error(refusal), { nothingSent: true, message: refusal }]) {
      const other = new FakeWallet([centsToMinor(10_00n)], (_c, n) => accepted(AT(n)));
      other.executeTransaction = async () => {
        throw thrown;
      };
      const c = await settleRun(other, fakeNetwork(), [paycheck("w1", 10_00n)]);
      expect(c.result.failed).toEqual([]);
      expect(c.result.unconfirmed.map((u) => u.workerId)).toEqual(["w1"]);
    }
  });

  it("a request Shield throws on is not confirmed, never failed: restarted, interrupted or turned down, the same record goes again", async () => {
    for (const thrown of ["Wallet restarted. Inspect transaction history", "The request was interrupted", "User rejected the request"]) {
      const wallet = new FakeWallet([centsToMinor(25_00n)], (_c, n) => accepted(AT(n)));
      const exec = wallet.executeTransaction.bind(wallet);
      let first = true;
      wallet.executeTransaction = async (o) => {
        if (!first) return exec(o);
        first = false;
        throw new Error(thrown);
      };
      const a = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)]);
      expect(a.result.failed).toEqual([]);
      expect(a.result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringContaining(thrown) }]);
      const kept = unconfirmedIn(a.events);
      expect(kept.reference).toBeUndefined();
      expect(kept.attempt).toBe(await recordTag(wallet.records[0]!.recordPlaintext));

      // The next run: its record is still listed, so it is asked again with that same record, whatever else has arrived.
      wallet.addRecord(centsToMinor(10_00n));
      const b = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, keptFrom(kept))]);
      expect(b.result.settled.map((r) => r.workerId)).toEqual(["w1"]);
      expect(wallet.calls).toHaveLength(1);
      expect(wallet.calls[0]!.inputs[2]).toBe(wallet.records[0]!.recordPlaintext);
      expect(wallet.landed).toHaveLength(1);
    }
  });

  it("Shield throws after the transfer landed: the payee is settled, not failed", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "pending" }]);
    const exec = wallet.executeTransaction.bind(wallet);
    wallet.executeTransaction = async (o) => {
      const { transactionId } = await exec(o);
      wallet.land(transactionId, AT(4));
      throw new Error("Transaction already exists in the ledger");
    };
    const asked: PaymentQuery[] = [];
    const { result, events } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)], { findPayment: lookup(wallet, asked) });
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([]);
    // Settled from the account's own transfers, with the fee and the height read back like any other.
    expect(result.settled).toEqual([{ workerId: "w1", transactionId: AT(4), found: true, height: expect.any(Number), feeMicrocredits: 51_580n }]);
    expect(events.find((e) => e.kind === "settled")).toMatchObject({ found: true });
    expect(asked).toEqual([{ workerId: "w1", to: ADDR(1), minor: centsToMinor(10_00n), attempt: await recordTag(wallet.records[0]!.recordPlaintext), ids: [], since: HEIGHT }]);
    expect(wallet.landed).toHaveLength(1);
  });

  it("the look is given the ids Shield named for the request, and one that throws or finds a transfer already used counts as unknown", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(10_00n)], (c) => [{ status: "pending", transactionId: c.inputs[0] === ADDR(1) ? AT(5) : AT(6) }, { status: "failed" }]);
    const asked: PaymentQuery[] = [];
    const same = async (q: PaymentQuery): Promise<PaymentLookup> => (asked.push(q), { found: AT(9) });
    const a = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n), paycheck("w2", 10_00n)], { findPayment: same });
    expect(asked.map((q) => q.ids).sort()).toEqual([[AT(5)], [AT(6)]]);
    // One transfer settles one payment: the second line to be handed the same id stays not confirmed.
    expect(a.result.settled).toHaveLength(1);
    expect(a.result.unconfirmed).toHaveLength(1);
    expect(a.result.failed).toEqual([]);

    const down = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "failed" }]);
    const b = await settleRun(down, fakeNetwork(), [paycheck("w1", 10_00n)], { findPayment: async () => Promise.reject(new Error("Shield didn't answer")) });
    expect(b.result).toEqual({ settled: [], failed: [], unconfirmed: [{ workerId: "w1", failure: expect.stringMatching(/may still go through/) }] });

    // A transfer the look calls paid but the network rejected is not taken as paid.
    const odd = new FakeWallet([centsToMinor(10_00n)], () => [{ status: "failed" }]);
    const c = await settleRun(odd, fakeNetwork({ fail: new Set([AT(7)]) }), [paycheck("w1", 10_00n)], { findPayment: async () => ({ found: AT(7) }) });
    expect(c.result.settled).toEqual([]);
    expect(c.result.unconfirmed).toHaveLength(1);
  });

  it("a turned-down payment whose record Shield then combined reads Not paid when the look says so, and paying again pays once", async () => {
    const wallet = new FakeWallet([centsToMinor(25_00n), centsToMinor(40_00n)], (_c, n) => accepted(AT(n)));
    const exec = wallet.executeTransaction.bind(wallet);
    let first = true;
    wallet.executeTransaction = async (o) => {
      if (!first) return exec(o);
      first = false;
      throw new Error("User rejected the request");
    };
    const a = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)]);
    const kept = unconfirmedIn(a.events);
    wallet.combine(); // the record it had set aside goes into a join

    // The look found what spent that record, and it wasn't a payment to them.
    const b = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, keptFrom(kept))], { findPayment: async () => "none" });
    expect(b.result.settled).toEqual([]);
    expect(b.result.failed).toEqual([]);
    expect(b.result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(new RegExp(`^${NOT_PAID}`)) }]);
    expect(unconfirmedIn(b.events)).toMatchObject({ attempt: kept.attempt });
    expect(wallet.calls).toEqual([]); // nothing is sent again without the person saying so

    // Without that answer, or without a look at all, it stays "may have gone through".
    for (const findPayment of [undefined, async (): Promise<PaymentLookup> => "unknown"]) {
      const c = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, keptFrom(kept))], findPayment ? { findPayment } : {});
      expect(c.result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/record this payment was spending is gone.*may have gone through/) }]);
    }

    // Pay again, chosen by the person: a fresh record, one payment.
    const d = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, { status: "failed", failure: "Marked to pay again after checking Shield" })]);
    expect(d.result.settled.map((r) => r.workerId)).toEqual(["w1"]);
    expect(wallet.landed).toHaveLength(1);
  });

  it("from 5 minutes after the try ended, while its record is still unspent, the line reads Not seen on chain yet, never Not sent", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n)], (_c, n) => accepted(AT(n)));
    wallet.know("shield_old", [{ status: "failed" }]);
    const tag = await recordTag(wallet.records[0]!.recordPlaintext);
    const line = (endedAgoMs: number): Settlement => ({
      status: "pending",
      reference: "shield_old",
      attempt: tag,
      failure: "Shield reported a problem (failed); the payment may still go through.",
      since: HEIGHT - 10,
      endedAt: new Date(NOON - endedAgoMs).toISOString(),
    });

    // Two minutes after: still only "not confirmed".
    const early = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, line(2 * MINUTE))], { findPayment: lookup(wallet), ...fakeTime(NOON) });
    expect(early.result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(/may still go through/) }]);
    expect(early.result.unconfirmed[0]!.failure.startsWith(NOT_SEEN)).toBe(false);

    // Six minutes after, the record still listed and nothing found.
    const late = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, line(6 * MINUTE))], { findPayment: lookup(wallet), ...fakeTime(NOON) });
    expect(late.result.failed).toEqual([]);
    expect(late.result.unconfirmed).toEqual([{ workerId: "w1", failure: expect.stringMatching(new RegExp(`^${NOT_SEEN}`)) }]);
    expect(NOT_SEEN).toBe("Not seen on chain yet");
    expect(late.result.unconfirmed[0]!.failure).not.toMatch(/not sent/i);
    // A label only: the line keeps its id, its record's tag, its floor and when it ended, and nothing is sent.
    expect(unconfirmedIn(late.events)).toMatchObject({ reference: "shield_old", attempt: tag, since: HEIGHT - 10, endedAt: line(6 * MINUTE).endedAt });
    expect(wallet.calls).toEqual([]);

    // Six minutes after with the record gone: that isn't "not seen", it may have gone through.
    wallet.combine();
    const gone = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, line(6 * MINUTE))], { findPayment: lookup(wallet), ...fakeTime(NOON) });
    expect(gone.result.unconfirmed[0]!.failure.startsWith(NOT_SEEN)).toBe(false);
    expect(gone.result.unconfirmed[0]!.failure).toMatch(/may still go through/);
  });

  it("Shield says failed, two records are listed, the payment lands 6 minutes later: the worker is paid once", async () => {
    let wallet!: FakeWallet;
    wallet = new FakeWallet([centsToMinor(25_00n)], (_c, n) => {
      if (n === 0) return [{ status: "failed" }];
      // While the second request is with Shield, the first one, given up on six minutes ago, reaches the chain.
      wallet.land("shield_0", AT(1));
      return [{ status: "rejected", error: "The record this spends was already spent" }];
    });
    const find = lookup(wallet);
    const a = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)], { findPayment: find, ...fakeTime(NOON) });
    const first = unconfirmedIn(a.events);
    const setAside = wallet.records[0]!.recordPlaintext;
    wallet.addRecord(centsToMinor(10_00n)); // a deposit: now two records are listed, and this one fits exactly

    // Six minutes on, nothing has landed and the record it set aside is still there.
    const b = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, keptFrom(first))], { findPayment: find, ...fakeTime(NOON + 6 * MINUTE) });
    const second = unconfirmedIn(b.events);
    expect(second.failure.startsWith(NOT_SEEN)).toBe(true);
    expect(await recordStillListed(wallet, second.attempt!)).toBe(true);

    // The person pays again. Its record is still listed, so the line keeps the tag and spends that same record.
    const again: Settlement = { status: "failed", failure: "Marked to pay again after checking Shield", attempt: second.attempt!, since: second.since! };
    const c = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, again)], { findPayment: find, ...fakeTime(NOON + 7 * MINUTE) });
    expect(wallet.calls).toHaveLength(2);
    expect(wallet.calls[1]!.inputs[2]).toBe(setAside);
    // The network let one of the two through: the late one. The second try is a rejection that says why.
    expect(c.result.failed).toEqual([{ workerId: "w1", failure: "The record this spends was already spent" }]);

    // The next run finds the payment that did land.
    const d = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, { status: "failed", failure: c.result.failed[0]!.failure, attempt: failedIn(c.events).attempt!, since: failedIn(c.events).since! })], {
      findPayment: find,
      ...fakeTime(NOON + 8 * MINUTE),
    });
    expect(d.result.settled).toEqual([expect.objectContaining({ workerId: "w1", transactionId: AT(1), found: true })]);
    expect(wallet.calls).toHaveLength(2);
    expect(wallet.landed).toEqual([{ to: ADDR(1), minor: centsToMinor(10_00n), transactionId: AT(1) }]);
    expect(await recordStillListed(wallet, second.attempt!)).toBe(false);
  });

  it("hands the caller the chain's height with each tag before Shield is asked, and keeps a line's own floor on later runs", async () => {
    const wallet = new FakeWallet([centsToMinor(25_00n)], () => [{ status: "failed" }]);
    const seen: [string, string, number | undefined][] = [];
    const a = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n)], { beforeSend: async (w, tag, since) => void seen.push([w, tag, since]) });
    const kept = unconfirmedIn(a.events);
    expect(seen).toEqual([["w1", kept.attempt, HEIGHT]]);
    expect(a.events.find((e) => e.kind === "sent")).toMatchObject({ since: HEIGHT });

    // A later run, the chain further on: the line still carries the height it was first asked at.
    wallet.know("shield_0", [{ status: "failed" }]);
    const asked: PaymentQuery[] = [];
    const b = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, { ...keptFrom(kept), since: HEIGHT - 500 })], { findPayment: lookup(wallet, asked) });
    expect(asked[0]).toMatchObject({ since: HEIGHT - 500, attempt: kept.attempt });
    expect(unconfirmedIn(b.events)).toMatchObject({ since: HEIGHT - 500, endedAt: kept.endedAt });

    // One asked for before heights were kept gets none made up for it.
    const { since: _s, ...old } = keptFrom(kept);
    const c = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n, old)], { findPayment: lookup(wallet, asked) });
    expect(asked.at(-1)).not.toHaveProperty("since");
    expect(unconfirmedIn(c.events)).not.toHaveProperty("since");
  });
});

describe("recordStillListed", () => {
  it("says whether the record a payment set aside is still among the account's unspent ones", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(20_00n)], (_c, n) => accepted(AT(n)));
    const tag = await recordTag(wallet.records[1]!.recordPlaintext);
    expect(await recordStillListed(wallet, tag)).toBe(true);
    wallet.records[1]!.spent = true;
    expect(await recordStillListed(wallet, tag)).toBe(false);
    expect(await recordStillListed(wallet, "ab".repeat(16))).toBe(false);
  });
});
