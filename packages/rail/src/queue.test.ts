import { describe, expect, it } from "vitest";
import type { Paycheck, PayRun, Settlement } from "@pnw/payroll";
import { FREEZELIST_PROGRAM } from "./exclusion";
import fixture from "./fixtures/transaction.json";
import {
  MAX_ASKS,
  NOT_PAID,
  NOT_SEEN,
  type PayQueueEvent,
  type PaymentLookup,
  type PaymentQuery,
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
 * last one repeats), and an accepted transfer spends its record and leaves
 * the change as a new one, the way the chain would. Nothing is ever logged.
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
   * record (once: the network lets a record be spent one time) and leaves the change as a new one.
   * True when it went through.
   */
  land(id: string, transactionId = "") {
    const call = this.calls.find((c) => c.walletId === id);
    if (!call || call.function !== TRANSFER_FUNCTION) return false;
    const source = this.records.find((r) => r.recordPlaintext === call.inputs[2]);
    if (!source || source.spent) return false;
    source.spent = true;
    const sourceAmount = BigInt(/amount:\s*(\d+)u128/.exec(source.recordPlaintext)![1]!);
    const amount = BigInt(call.inputs[1]!.replace("u128", ""));
    this.landed.push({ to: call.inputs[0]!, minor: amount, transactionId });
    if (sourceAmount > amount) this.addRecord(sourceAmount - amount); // change
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
  it("asks for one transfer per payee, in the run's order, each settled before the next is asked for", async () => {
    const wallet = new FakeWallet([centsToMinor(100_00n), centsToMinor(200_00n), centsToMinor(300_00n)], (c) => accepted(AT(Number(c.walletId.replace("shield_", "")) + 1), 2));
    const network = fakeNetwork();
    const { events, result } = await settleRun(wallet, network, [paycheck("w1", 100_00n), paycheck("w2", 200_00n), paycheck("w3", 300_00n)]);

    // One transfer_private per payee: recipient, amount in minor units, the exact-fit record, the proof.
    const transfers = wallet.calls.filter((c) => c.function === TRANSFER_FUNCTION);
    expect(transfers).toHaveLength(3);
    expect(wallet.calls).toHaveLength(3);
    expect(wallet.calls.every((c) => c.program === USDCX_PROGRAM && c.privateFee === false && c.fee === undefined)).toBe(true);
    expect(transfers.map((c) => c.inputs[0])).toEqual([ADDR(1), ADDR(2), ADDR(3)]);
    const w1 = transfers[0]!;
    expect(w1.inputs[1]).toBe(`${centsToMinor(100_00n)}u128`);
    expect(w1.inputs[2]).toContain(`amount: ${centsToMinor(100_00n)}u128`);
    expect(w1.inputs[3]).toMatch(/^\[\{siblings: \[/);
    expect(transfers.every((c) => c.inputs[3] === w1.inputs[3])).toBe(true);

    // One at a time: each payee is approved, sent and settled before the next one's prompt is raised.
    expect(events[0]).toEqual({ kind: "planned", transfers: 3 });
    expect(events.slice(1).map((e) => `${e.kind} ${"workerId" in e ? e.workerId : ""}`)).toEqual(
      ["w1", "w2", "w3"].flatMap((w) => [`approving ${w}`, `sent ${w}`, `broadcast ${w}`, `settled ${w}`]),
    );

    // The prompt's event says what Shield is being asked to sign, and where the run stands.
    expect(events.filter((e) => e.kind === "approving")).toEqual([
      { kind: "approving", workerId: "w1", to: ADDR(1), minor: centsToMinor(100_00n), step: 1, of: 3 },
      { kind: "approving", workerId: "w2", to: ADDR(2), minor: centsToMinor(200_00n), step: 2, of: 3 },
      { kind: "approving", workerId: "w3", to: ADDR(3), minor: centsToMinor(300_00n), step: 3, of: 3 },
    ]);

    const settled = events.filter((e): e is Extract<PayQueueEvent, { kind: "settled" }> => e.kind === "settled");
    expect(settled.every((e) => e.feeMicrocredits === 51_580n && typeof e.height === "number")).toBe(true);
    expect(settled.map((e) => e.transactionId)).toEqual([AT(1), AT(2), AT(3)]);
    expect(result.settled).toHaveLength(3);
    expect(result.failed).toEqual([]);
    expect(result.stalled).toBeUndefined();
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

  it("12 lines from one record need 12 prompts and no split: each payment spends what the last one left", async () => {
    const wallet = new FakeWallet([centsToMinor(5000_00n)], (_c, n) => accepted(AT(n)));
    const workers = Array.from({ length: 12 }, (_x, i) => `w${i + 1}`);
    const { events, result } = await settleRun(wallet, fakeNetwork(), workers.map((w) => paycheck(w, 100_00n)), { links: links(...workers) });
    expect(wallet.calls).toHaveLength(12);
    expect(wallet.calls.every((c) => c.function === TRANSFER_FUNCTION)).toBe(true);
    // The first spends the deposit; each one after spends the change of the one before.
    wallet.calls.forEach((c, i) => expect(c.inputs[2]).toContain(`amount: ${centsToMinor(5000_00n - 100_00n * BigInt(i))}u128`));
    expect(wallet.calls.map((c) => c.inputs[0])).toEqual(workers.map((_w, i) => ADDR(i + 1)));
    expect(events[0]).toEqual({ kind: "planned", transfers: 12 });
    expect(result.settled.map((s) => s.workerId)).toEqual(workers);
    expect(wallet.records.filter((r) => !r.spent)).toHaveLength(1); // what is left, as one record
    expect(wallet.landed).toHaveLength(12);
  });

  it("pays from one big record in the run's order, without preparing anything first", async () => {
    const wallet = new FakeWallet([centsToMinor(1000_00n)], (_c, n) => accepted(AT(n)));
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 100_00n), paycheck("w2", 250_00n), paycheck("w3", 50_00n)]);
    expect(wallet.calls.map((c) => [c.function, c.inputs[0], c.inputs[1]])).toEqual([
      [TRANSFER_FUNCTION, ADDR(1), `${centsToMinor(100_00n)}u128`],
      [TRANSFER_FUNCTION, ADDR(2), `${centsToMinor(250_00n)}u128`],
      [TRANSFER_FUNCTION, ADDR(3), `${centsToMinor(50_00n)}u128`],
    ]);
    expect(wallet.calls[0]!.inputs[2]).toContain(`amount: ${centsToMinor(1000_00n)}u128`);
    expect(wallet.calls[1]!.inputs[2]).toContain(`amount: ${centsToMinor(900_00n)}u128`);
    expect(wallet.calls[2]!.inputs[2]).toContain(`amount: ${centsToMinor(650_00n)}u128`);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
    expect(wallet.records.filter((r) => !r.spent).map((r) => r.recordPlaintext)).toEqual([expect.stringContaining(`amount: ${centsToMinor(600_00n)}u128`)]);
  });

  it("with several records, a payee takes the one that fits exactly, else the smallest that covers them", async () => {
    const wallet = new FakeWallet([centsToMinor(300_00n), centsToMinor(1000_00n), centsToMinor(250_00n)], (_c, n) => accepted(AT(n)));
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 100_00n), paycheck("w2", 250_00n), paycheck("w3", 700_00n)]);
    const spends = (i: number) => /amount: (\d+)u128/.exec(wallet.calls[i]!.inputs[2]!)![1];
    // w1: nothing fits exactly, so the 250.00 (the smallest that covers 100.00), leaving 150.00.
    // w2: the 300.00 (the 250.00 is gone, and its 150.00 change is too small), leaving 50.00. w3: only the 1,000.00 covers 700.00.
    expect([spends(0), spends(1), spends(2)]).toEqual([`${centsToMinor(250_00n)}`, `${centsToMinor(300_00n)}`, `${centsToMinor(1000_00n)}`]);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
    expect(wallet.calls).toHaveLength(3);
  });

  it("records of 1,000.00 and 600.00 pay 400.00, 600.00 and 500.00 in that order, with three prompts and no split", async () => {
    const wallet = new FakeWallet([centsToMinor(1000_00n), centsToMinor(600_00n)], (_c, n) => accepted(AT(n)));
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 400_00n), paycheck("w2", 600_00n), paycheck("w3", 500_00n)]);
    const spends = (i: number) => /amount: (\d+)u128/.exec(wallet.calls[i]!.inputs[2]!)![1];
    // w1 from the 1,000.00, though the 600.00 is the smallest that covers 400.00: taking that one would leave
    // 200.00 and 400.00 for w3. w2 takes the 600.00 that fits exactly, and w3 the 600.00 w1's payment left.
    expect([spends(0), spends(1), spends(2)]).toEqual([`${centsToMinor(1000_00n)}`, `${centsToMinor(600_00n)}`, `${centsToMinor(600_00n)}`]);
    expect(wallet.calls[1]!.inputs[2]).not.toBe(wallet.calls[2]!.inputs[2]);
    expect(wallet.calls.map((c) => [c.function, c.inputs[0], c.inputs[1]])).toEqual([
      [TRANSFER_FUNCTION, ADDR(1), `${centsToMinor(400_00n)}u128`],
      [TRANSFER_FUNCTION, ADDR(2), `${centsToMinor(600_00n)}u128`],
      [TRANSFER_FUNCTION, ADDR(3), `${centsToMinor(500_00n)}u128`],
    ]);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
    expect(result.stalled).toBeUndefined();
    expect(wallet.records.filter((r) => !r.spent).map((r) => r.recordPlaintext)).toEqual([expect.stringContaining(`amount: ${centsToMinor(100_00n)}u128`)]);
  });

  it("names no fee on any call to Shield: the wallet charges its own estimate", async () => {
    const wallet = new FakeWallet([centsToMinor(500_00n)], (_c, n) => accepted(AT(n)));
    const { result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 100_00n), paycheck("w2", 250_00n)]);
    expect(result.settled).toHaveLength(2);
    expect(wallet.calls.map((c) => c.function)).toEqual([TRANSFER_FUNCTION, TRANSFER_FUNCTION]);
    for (const call of wallet.calls) expect(call).not.toHaveProperty("fee");
  });

  it("a payment Shield rejects with its reason fails, and the ones after it are not asked for", async () => {
    const wallet = new FakeWallet([centsToMinor(500_00n)], (c, n) => (c.inputs[0] === ADDR(2) ? [{ status: "pending" }, { status: "rejected", error: "the proof is stale" }] : accepted(AT(n))));
    const { events, result } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 100_00n), paycheck("w2", 100_00n), paycheck("w3", 100_00n)]);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(result.failed).toEqual([{ workerId: "w2", failure: "the proof is stale" }]);
    expect(result.unconfirmed).toEqual([]);
    // Nothing was asked of Shield for w3, and nothing was kept for it: it waits as it was.
    expect(wallet.calls.map((c) => c.inputs[0])).toEqual([ADDR(1), ADDR(2)]);
    expect(events.some((e) => "workerId" in e && e.workerId === "w3")).toBe(false);
    expect(result.stalled).toEqual({ at: 2, of: 3, why: expect.stringMatching(/weren't asked for/) });
    expect(events.at(-1)).toEqual({ kind: "stalled", ...result.stalled });
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
    expect(events[0]).toEqual({ kind: "planned", transfers: 2 });
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

  it("keeps each record's tag just before Shield is asked for that payment, and stops at a payee whose tag couldn't be kept", async () => {
    const wallet = new FakeWallet([centsToMinor(10_00n), centsToMinor(20_00n), centsToMinor(30_00n)], (_c, n) => accepted(AT(n)));
    const log: string[] = [];
    const exec = wallet.executeTransaction.bind(wallet);
    wallet.executeTransaction = async (o) => (log.push(`send ${o.inputs[0]}`), exec(o));
    const beforeSend = async (workerId: string, attempt: string) => {
      expect(attempt).toMatch(/^[0-9a-f]{32}$/);
      log.push(`keep ${workerId}`);
      if (workerId === "w2") throw new Error("These books changed in another tab or window");
    };
    const { result, events } = await settleRun(wallet, fakeNetwork(), [paycheck("w1", 10_00n), paycheck("w2", 20_00n), paycheck("w3", 30_00n)], { beforeSend });
    // A tag is kept, then its payment asked for, one payee at a time; nothing goes to Shield for w2, or for w3 after it.
    expect(log).toEqual(["keep w1", `send ${ADDR(1)}`, "keep w2"]);
    expect(result.settled.map((r) => r.workerId)).toEqual(["w1"]);
    expect(result.failed).toEqual([{ workerId: "w2", failure: "These books changed in another tab or window" }]);
    expect(failedIn(events)).not.toHaveProperty("attempt"); // nothing was asked with that record: it is free again
    expect(result.stalled).toMatchObject({ at: 2, of: 3 });
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

// ---- One payment at a time ----------------------------------------------------------

type Spent = { by: "transfer"; to: string; minor: bigint; transactionId: string } | { by: "combine" };
type Held = { plaintext: string; amount: bigint; listedFrom: number; spent?: Spent; combining?: true };
type Asked = { call: Call; result?: Status };

const EXPIRED = "Approval expired. Request a fresh action.";
const APPROVAL_WINDOW = 300_000;
const COMBINE_AFTER = 5_000;

/**
 * A Shield with a clock, for runs where time matters. The person approves a request `approveAfterMs`
 * after it is raised, and one left 300 s expires. A request whose record is gone by the time it is
 * approved ends "failed", with nothing said about why. With `combine` set, the moment the account
 * holds two or more unspent records Shield starts combining them on its own: the one new record is
 * listed five seconds on, and until then the records going into it are still listed ("listed") or
 * already left out ("hidden"). `listLagMs` is how long after its block a new record shows up.
 */
class TimedShield implements RailWallet {
  address = EMPLOYER;
  now = NOON;
  calls: Call[] = [];
  landed: { to: string; minor: bigint; transactionId: string }[] = [];
  /** The most prompts open at one moment. */
  mostOpen = 0;
  listLagMs = 0;
  /** While set, Shield doesn't answer when asked for the account's records. */
  unlisted = false;
  /** Resolves when the page is taken away mid-request (`leaveOn`): whatever was awaiting Shield never hears back. */
  readonly left: Promise<void>;
  private leave!: () => void;
  private held: Held[] = [];
  private asked = new Map<string, Asked>();
  private later: { at: number; run: () => void }[] = [];
  private minted = 0;

  constructor(
    amounts: bigint[],
    private readonly opts: {
      combine?: "hidden" | "listed";
      approveAfterMs?: (n: number) => number;
      /** Called as the nth request (0-based) is raised. */
      onRaise?: (n: number, shield: TimedShield) => void;
      /** The nth request throws this instead of being raised (the person turned it down). */
      declines?: (n: number) => string | undefined;
      /** The page goes away while the nth request is with Shield: the request stays, its answer is never heard. */
      leaveOn?: number;
    } = {},
  ) {
    this.left = new Promise((resolve) => (this.leave = resolve));
    for (const a of amounts) this.mint(a, this.now);
  }

  readonly clock = { now: () => this.now };
  readonly sleep = async (ms: number) => {
    this.now += ms;
    await Promise.resolve();
  };

  /** Money arriving in the account at `at`. */
  deposit(amount: bigint, at: number) {
    this.later.push({ at, run: () => this.mint(amount, at) });
  }

  /** The record at `index`, in the order they were minted, goes into something that isn't a payment. */
  lose(index: number) {
    this.held[index]!.spent = { by: "combine" };
  }

  /** Every record minted so far shows up from now on. */
  listEverything() {
    this.listLagMs = 0;
    for (const r of this.held) r.listedFrom = Math.min(r.listedFrom, this.now);
  }

  private mint(amount: bigint, at: number) {
    this.held.push({ plaintext: plaintextOf(amount, `t${++this.minted}`), amount, listedFrom: at + this.listLagMs });
    const open = this.held.filter((r) => !r.spent && !r.combining && r.amount > 0n);
    if (!this.opts.combine || open.length < 2) return;
    for (const r of open) r.combining = true;
    this.later.push({
      at: at + COMBINE_AFTER,
      run: () => {
        const still = open.filter((r) => !r.spent);
        for (const r of still) r.spent = { by: "combine" };
        if (still.length > 0) this.mint(still.reduce((sum, r) => sum + r.amount, 0n), at + COMBINE_AFTER);
      },
    });
  }

  /** Everything due by now, in the order it falls due. */
  private tick() {
    for (;;) {
      const due = this.later.filter((e) => e.at <= this.now).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      this.later.splice(this.later.indexOf(due), 1);
      due.run();
    }
  }

  async requestRecords(program: string): Promise<unknown[]> {
    expect(program).toBe(USDCX_PROGRAM);
    this.tick();
    if (this.unlisted) throw new Error("Shield didn't answer");
    return this.held
      .filter((r) => r.listedFrom <= this.now && !(this.opts.combine === "hidden" && r.combining && !r.spent))
      .map((r) => ({ recordName: "Token", spent: !!r.spent, recordPlaintext: r.plaintext }));
  }

  async executeTransaction(opts: Omit<Call, "walletId">): Promise<{ transactionId: string }> {
    this.tick();
    const n = this.calls.length;
    const walletId = `shield_${n}`;
    const call = { ...opts, walletId };
    this.calls.push(call);
    const declined = this.opts.declines?.(n);
    if (declined) throw new Error(declined);
    const request: Asked = { call };
    this.asked.set(walletId, request);
    this.mostOpen = Math.max(this.mostOpen, [...this.asked.values()].filter((a) => !a.result).length);
    const wait = this.opts.approveAfterMs?.(n) ?? 8_000;
    const raisedAt = this.now;
    if (wait >= APPROVAL_WINDOW) this.later.push({ at: raisedAt + APPROVAL_WINDOW, run: () => (request.result = { status: "rejected", error: EXPIRED }) });
    else this.later.push({ at: raisedAt + wait, run: () => (request.result = this.approve(call, n, raisedAt + wait)) });
    this.opts.onRaise?.(n, this);
    if (this.opts.leaveOn === n) {
      this.leave();
      return new Promise(() => {});
    }
    return { transactionId: walletId };
  }

  private approve(call: Call, n: number, at: number): Status {
    const record = this.held.find((r) => r.plaintext === call.inputs[2]);
    if (!record || record.spent) return { status: "failed" };
    const minor = BigInt(call.inputs[1]!.replace("u128", ""));
    const transactionId = AT(100 + n);
    record.spent = { by: "transfer", to: call.inputs[0]!, minor, transactionId };
    this.landed.push({ to: call.inputs[0]!, minor, transactionId });
    if (record.amount > minor) this.mint(record.amount - minor, at);
    return { status: "accepted", transactionId };
  }

  async transactionStatus(id: string): Promise<Status> {
    this.tick();
    const request = this.asked.get(id);
    if (!request) throw new Error("not found");
    return request.result ?? { status: "pending" };
  }

  /** The account's own transfers, as a look reads them: what spent the record a payment set aside. */
  readonly find = async (q: PaymentQuery): Promise<PaymentLookup> => {
    this.tick();
    if (!q.attempt) return "unknown";
    for (const r of this.held) {
      if ((await recordTag(r.plaintext)) !== q.attempt) continue;
      if (!r.spent) return "unknown";
      if (r.spent.by === "transfer" && r.spent.to === q.to && r.spent.minor === q.minor) return { found: r.spent.transactionId };
      return "none";
    }
    return "unknown";
  };

  /** What the account lists now, as amounts. */
  async listed(): Promise<bigint[]> {
    return ((await this.requestRecords(USDCX_PROGRAM)) as { spent: boolean; recordPlaintext: string }[])
      .filter((r) => !r.spent)
      .map((r) => BigInt(/amount:\s*(\d+)u128/.exec(r.recordPlaintext)![1]!));
  }
}

/** The books as the pay panel keeps them: each thing the queue says is written onto its paycheck, so a later run starts from what an earlier one left. */
function keeper(paychecks: Paycheck[]) {
  const set = (workerId: string, settlement: Settlement) => {
    paychecks.find((p) => p.workerId === workerId)!.settlement = settlement;
  };
  const noted = (e: { attempt?: string; since?: number }) => ({ ...(e.attempt ? { attempt: e.attempt } : {}), ...(e.since !== undefined ? { since: e.since } : {}) });
  return {
    paychecks,
    beforeSend: async (workerId: string, attempt: string, since?: number) => set(workerId, { status: "pending", ...noted({ attempt, ...(since !== undefined ? { since } : {}) }) }),
    onProgress: (e: PayQueueEvent) => {
      if (e.kind === "sent") set(e.workerId, { status: "pending", reference: e.reference, ...noted(e) });
      if (e.kind === "settled") set(e.workerId, { status: "settled", reference: e.transactionId });
      if (e.kind === "failed") set(e.workerId, { status: "failed", failure: e.failure, ...noted(e) });
      if (e.kind === "unconfirmed") set(e.workerId, keptFrom(e));
    },
  };
}

const crew = (n: number) => Array.from({ length: n }, (_x, i) => `w${i + 1}`);

async function payWith(shield: TimedShield, books: ReturnType<typeof keeper>, extra: Partial<Parameters<typeof runPayQueue>[0]> = {}) {
  const events: PayQueueEvent[] = [];
  const result = await runPayQueue({
    wallet: shield,
    network: fakeNetwork(),
    run: run(books.paychecks),
    links: links(...books.paychecks.map((p) => p.workerId)),
    clock: shield.clock,
    sleep: shield.sleep,
    beforeSend: books.beforeSend,
    findPayment: shield.find,
    onProgress: (e) => {
      events.push(e);
      books.onProgress(e);
    },
    ...extra,
  });
  return { events, result };
}

/** Each payee, and how many transfers reached the chain for them. */
const paidTimes = (shield: TimedShield, workers: string[]) => workers.map((_w, i) => shield.landed.filter((l) => l.to === ADDR(i + 1)).length);
const promptsFor = (events: PayQueueEvent[]) => events.filter((e) => e.kind === "approving").map((e) => (e as { workerId: string }).workerId);

describe("runPayQueue: one payment at a time, each from what the last one left", () => {
  it("one deposit, three payees, a wallet that merges new records within 5 s: all three paid with 3 payment prompts and 0 splits", async () => {
    for (const combine of ["hidden", "listed", undefined] as const) {
      const shield = new TimedShield([centsToMinor(10_00n)], { ...(combine ? { combine } : {}) });
      const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
      const { result, events } = await payWith(shield, books);
      expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
      expect(result.failed).toEqual([]);
      expect(result.unconfirmed).toEqual([]);
      expect(result.stalled).toBeUndefined();
      expect(shield.calls.filter((c) => c.function === TRANSFER_FUNCTION)).toHaveLength(3);
      expect(shield.calls.filter((c) => c.function !== TRANSFER_FUNCTION)).toHaveLength(0);
      expect(promptsFor(events)).toEqual(["w1", "w2", "w3"]);
      expect(shield.mostOpen).toBe(1);
      expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
      expect(await shield.listed()).toEqual([centsToMinor(7_00n)]);
    }
  });

  it("keeps one prompt open at a time: twelve payees and a person taking 30 s over each are all paid, none left to expire", async () => {
    // Raised together, the tenth, eleventh and twelfth prompts would wait past Shield's five minutes.
    const shield = new TimedShield([centsToMinor(2000_00n)], { approveAfterMs: () => 30_000 });
    const books = keeper(crew(12).map((w) => paycheck(w, 100_00n)));
    const { result } = await payWith(shield, books);
    expect(result.settled).toHaveLength(12);
    expect(result.failed).toEqual([]);
    expect(shield.mostOpen).toBe(1);
    expect(shield.calls).toHaveLength(12);
    expect(paidTimes(shield, crew(12))).toEqual(Array(12).fill(1));
  });

  it("several records and nothing combining them: each payee paid once, three prompts", async () => {
    const shield = new TimedShield([centsToMinor(3_00n), centsToMinor(10_00n)]);
    const books = keeper([paycheck("w1", 1_00n), paycheck("w2", 2_50n), paycheck("w3", 50n)]);
    const { result } = await payWith(shield, books);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
    expect(shield.calls).toHaveLength(3);
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
    expect((await shield.listed()).reduce((a, b) => a + b, 0n)).toBe(centsToMinor(9_00n));
  });

  it("two records that only one order of picks pays everyone from: each payee paid once, one prompt open at a time, three prompts", async () => {
    const shield = new TimedShield([centsToMinor(10_00n), centsToMinor(6_00n)]);
    const books = keeper([paycheck("w1", 4_00n), paycheck("w2", 6_00n), paycheck("w3", 5_00n)]);
    const { result, events } = await payWith(shield, books);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([]);
    expect(result.stalled).toBeUndefined();
    expect(promptsFor(events)).toEqual(["w1", "w2", "w3"]);
    expect(shield.calls.every((c) => c.function === TRANSFER_FUNCTION)).toBe(true);
    expect(shield.calls[0]!.inputs[2]).toContain(`amount: ${centsToMinor(10_00n)}u128`);
    expect(shield.mostOpen).toBe(1);
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
    expect(await shield.listed()).toEqual([centsToMinor(1_00n)]);
  });

  it("a later payee's set-aside record goes mid-run, so no plan pays everyone still to come: the payee whose turn it is is paid all the same", async () => {
    const shield = new TimedShield([centsToMinor(5_00n), centsToMinor(3_00n)], {
      // While the first prompt is open, the 3.00 that w3's earlier try set aside goes into something else.
      onRaise: (n, s) => void (n === 0 && s.lose(1)),
    });
    const tag = await recordTag(plaintextOf(centsToMinor(3_00n), "t2"));
    const books = keeper([paycheck("w1", 1_00n), paycheck("w2", 4_00n), paycheck("w3", 3_00n, { status: "failed", failure: EXPIRED, attempt: tag, since: HEIGHT })]);
    const { result, events } = await payWith(shield, books);
    // What w1's payment left covers w2 and not w2 and w3 together: w2 is paid from it, and w3 is looked for at its turn.
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2"]);
    expect(result.unconfirmed).toEqual([{ workerId: "w3", failure: expect.stringMatching(new RegExp(`^${NOT_PAID}`)) }]);
    expect(result.failed).toEqual([]);
    expect(result.stalled).toBeUndefined();
    expect(promptsFor(events)).toEqual(["w1", "w2"]);
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 0]);
  });

  it("money arriving between two payments is combined with the change: the next payment is made from the combined record, and each person is paid once", async () => {
    for (const combine of ["hidden", "listed"] as const) {
      const shield = new TimedShield([centsToMinor(10_00n)], {
        combine,
        // One second after the first payment's block, a deposit: Shield starts combining it with the change.
        onRaise: (n, s) => void (n === 0 && s.deposit(centsToMinor(1n), s.now + 9_000)),
      });
      const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
      const { result, events } = await payWith(shield, books);
      expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
      expect(result.failed).toEqual([]);
      expect(result.unconfirmed).toEqual([]);
      // Left out of the list while they are combined, the two records are waited for and w2 is asked once, from the
      // new one. Still listed meanwhile, the change is set aside, goes into the new record before the prompt is
      // approved, is looked for and found unpaid, and w2 is asked again from the new one.
      expect(promptsFor(events)).toEqual(combine === "hidden" ? ["w1", "w2", "w3"] : ["w1", "w2", "w2", "w3"]);
      const second = shield.calls.filter((c) => c.inputs[0] === ADDR(2)).at(-1)!;
      expect(second.inputs[2]).toContain(`amount: ${centsToMinor(9_01n)}u128`);
      expect(shield.mostOpen).toBe(1);
      expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
      expect(await shield.listed()).toEqual([centsToMinor(7_01n)]);
    }
  });

  it("money arriving while a prompt is open takes the record it was spending: the payment is looked for, found unpaid, and asked again from the new record", async () => {
    for (const combine of ["hidden", "listed"] as const) {
      const shield = new TimedShield([centsToMinor(10_00n)], {
        combine,
        // One second after the second prompt is raised: the change it set aside goes into a combined record before it is approved.
        onRaise: (n, s) => void (n === 1 && s.deposit(centsToMinor(1n), s.now + 1_000)),
      });
      const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
      const kept: [string, string][] = [];
      const { result, events } = await payWith(shield, books, { beforeSend: async (w, tag, since) => (kept.push([w, tag]), books.beforeSend(w, tag, since)) });
      expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2", "w3"]);
      expect(result.failed).toEqual([]);
      expect(result.unconfirmed).toEqual([]);
      // Four prompts for three people: w2's first was for a record that was gone by the time it was approved.
      expect(promptsFor(events)).toEqual(["w1", "w2", "w2", "w3"]);
      expect(shield.mostOpen).toBe(1);
      // Each of w2's two tries had its own record's tag kept before Shield was asked.
      const w2 = kept.filter(([w]) => w === "w2").map(([, tag]) => tag);
      expect(w2).toHaveLength(2);
      expect(w2[0]).not.toBe(w2[1]);
      expect(w2[1]).toBe(await recordTag(shield.calls[2]!.inputs[2]!));
      expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
      expect(await shield.listed()).toEqual([centsToMinor(7_01n)]);
    }
  });

  it("without a look that can say the record went elsewhere, that payment stays not confirmed, the rest wait, and paying on later pays each person once", async () => {
    const shield = new TimedShield([centsToMinor(10_00n)], { combine: "hidden", onRaise: (n, s) => void (n === 1 && s.deposit(centsToMinor(1n), s.now + 1_000)) });
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    // No look at all: nothing says whether w2's first try went through.
    const a = await payWith(shield, books, { findPayment: undefined as never });
    expect(a.result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(a.result.unconfirmed).toEqual([{ workerId: "w2", failure: expect.stringMatching(/may still go through/) }]);
    expect(a.result.stalled).toMatchObject({ at: 2, of: 3 });
    expect(promptsFor(a.events)).toEqual(["w1", "w2"]);
    expect(books.paychecks[2]!.settlement).toEqual({ status: "pending" }); // w3 was never asked for

    // Paying on, with the look: w2's record went into something else and nothing paid them. That is said, not acted on;
    // w3, never asked for, is paid from the record now listed.
    const b = await payWith(shield, books);
    expect(b.result.unconfirmed).toEqual([{ workerId: "w2", failure: expect.stringMatching(new RegExp(`^${NOT_PAID}`)) }]);
    expect(b.result.settled.map((s) => s.workerId)).toEqual(["w3"]);
    expect(promptsFor(b.events)).toEqual(["w3"]);

    // The person says pay again: a fresh record, one payment.
    books.paychecks[1]!.settlement = { status: "failed", failure: "Marked to pay again after checking Shield" };
    const c = await payWith(shield, books);
    expect(c.result.settled.map((s) => s.workerId)).toEqual(["w2"]);
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
  });

  it("a prompt left to expire stops the run there: that line keeps its record, the ones after it wait, and paying on asks again on the same record", async () => {
    const shield = new TimedShield([centsToMinor(10_00n)], { combine: "hidden", approveAfterMs: (n) => (n === 1 ? 6 * MINUTE : 8_000) });
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    const a = await payWith(shield, books);
    expect(a.result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(a.result.failed).toEqual([{ workerId: "w2", failure: EXPIRED }]);
    expect(a.result.unconfirmed).toEqual([]);
    expect(a.result.stalled).toMatchObject({ at: 2, of: 3 });
    expect(shield.calls).toHaveLength(2);
    expect(books.paychecks[1]!.settlement).toMatchObject({ status: "failed", attempt: await recordTag(shield.calls[1]!.inputs[2]!) });
    expect(books.paychecks[2]!.settlement).toEqual({ status: "pending" });

    const b = await payWith(shield, books);
    expect(b.result.settled.map((s) => s.workerId)).toEqual(["w2", "w3"]);
    expect(shield.calls[2]!.inputs[2]).toBe(shield.calls[1]!.inputs[2]); // the record the expired prompt had set aside
    expect(shield.calls).toHaveLength(4);
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
  });

  it("a payment turned down in Shield stops the run there: the ones after it wait, and nobody is paid twice", async () => {
    let turnDown = true;
    const shield = new TimedShield([centsToMinor(10_00n)], { combine: "hidden", declines: (n) => (turnDown && n === 1 ? "User rejected the request" : undefined) });
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    const a = await payWith(shield, books);
    expect(a.result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(a.result.unconfirmed).toEqual([{ workerId: "w2", failure: expect.stringContaining("User rejected the request") }]);
    expect(a.result.stalled).toMatchObject({ at: 2, of: 3 });
    expect(promptsFor(a.events)).toEqual(["w1", "w2"]);
    expect(books.paychecks[2]!.settlement).toEqual({ status: "pending" });

    turnDown = false;
    const b = await payWith(shield, books);
    expect(b.result.settled.map((s) => s.workerId)).toEqual(["w2", "w3"]);
    expect(shield.calls[2]!.inputs[2]).toBe(shield.calls[1]!.inputs[2]); // the same record as the try that was turned down
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
  });

  it("what a payment left isn't listed within 2 minutes: the run stalls at 2 of 3 with nothing more asked, and paying on later pays the rest", async () => {
    const shield = new TimedShield([centsToMinor(10_00n)]);
    shield.listLagMs = 60 * MINUTE; // Shield's list is far behind the chain
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    const started = shield.now;
    const a = await payWith(shield, books);
    expect(a.result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(a.result.failed).toEqual([]);
    expect(a.result.unconfirmed).toEqual([]);
    expect(a.result.stalled).toEqual({ at: 2, of: 3, why: expect.stringMatching(/hasn't listed/) });
    expect(a.events.at(-1)).toEqual({ kind: "stalled", ...a.result.stalled });
    expect(shield.calls).toHaveLength(1);
    expect(shield.now - started).toBeGreaterThanOrEqual(2 * MINUTE);
    expect(shield.now - started).toBeLessThan(4 * MINUTE);
    // Nothing was kept or said for the two not yet asked for.
    expect(books.paychecks.slice(1).map((p) => p.settlement)).toEqual([{ status: "pending" }, { status: "pending" }]);

    shield.listEverything();
    const b = await payWith(shield, books);
    expect(b.result.settled.map((s) => s.workerId)).toEqual(["w2", "w3"]);
    expect(b.events.filter((e) => e.kind === "approving")).toMatchObject([{ workerId: "w2", step: 1, of: 2 }, { workerId: "w3", step: 2, of: 2 }]);
    expect(paidTimes(shield, crew(3))).toEqual([1, 1, 1]);
  });

  it("a payment is asked for at most three times in a run, and only while the look says its record went elsewhere", async () => {
    // A deposit lands a second after each of w2's prompts is raised, so the record each one set aside is combined away.
    const shield = new TimedShield([centsToMinor(10_00n)], { combine: "hidden", onRaise: (n, s) => void (n >= 1 && s.deposit(centsToMinor(1n), s.now + 1_000)) });
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    const { result, events } = await payWith(shield, books);
    expect(MAX_ASKS).toBe(3);
    expect(promptsFor(events)).toEqual(["w1", "w2", "w2", "w2"]);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([{ workerId: "w2", failure: expect.stringMatching(new RegExp(`^${NOT_PAID}`)) }]);
    expect(result.stalled).toMatchObject({ at: 2, of: 3 });
    expect(books.paychecks[1]!.settlement).toMatchObject({ status: "pending", attempt: await recordTag(shield.calls[3]!.inputs[2]!) });
    expect(paidTimes(shield, crew(3))).toEqual([1, 0, 0]);
  });

  it("asked again from a new record only once that record's tag is kept: if it can't be, the line fails with the tag it already had and nothing is asked", async () => {
    const shield = new TimedShield([centsToMinor(10_00n)], { combine: "hidden", onRaise: (n, s) => void (n === 1 && s.deposit(centsToMinor(1n), s.now + 1_000)) });
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    let keeps = 0;
    const beforeSend = async (w: string, tag: string, since?: number) => {
      if (w === "w2" && ++keeps === 2) throw new Error("These books changed in another tab or window");
      await books.beforeSend(w, tag, since);
    };
    const { result, events } = await payWith(shield, books, { beforeSend });
    expect(promptsFor(events)).toEqual(["w1", "w2"]);
    expect(result.failed).toEqual([{ workerId: "w2", failure: "These books changed in another tab or window" }]);
    expect(failedIn(events).attempt).toBe(await recordTag(shield.calls[1]!.inputs[2]!)); // the tag of its first try, the one the books hold
    expect(shield.calls).toHaveLength(2);
    expect(paidTimes(shield, crew(3))).toEqual([1, 0, 0]);
  });

  it("a record set aside on an earlier run that goes while this one is under way is looked for at its turn, never asked for, and the run goes on", async () => {
    const shield = new TimedShield([centsToMinor(5_00n), centsToMinor(3_00n)], {
      // While the first prompt is open, the 3.00 that w2's earlier try set aside goes into something else.
      onRaise: (n, s) => void (n === 0 && s.lose(1)),
    });
    const tag = await recordTag(plaintextOf(centsToMinor(3_00n), "t2"));
    const books = keeper([paycheck("w1", 1_00n), paycheck("w2", 1_00n, { status: "failed", failure: EXPIRED, attempt: tag, since: HEIGHT }), paycheck("w3", 1_00n)]);
    const { result, events } = await payWith(shield, books);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w3"]);
    expect(result.unconfirmed).toEqual([{ workerId: "w2", failure: expect.stringMatching(new RegExp(`^${NOT_PAID}`)) }]);
    expect(result.stalled).toBeUndefined();
    expect(promptsFor(events)).toEqual(["w1", "w3"]);
    // Neither w1 nor w3 was given the record w2 had set aside.
    for (const c of shield.calls) expect(await recordTag(c.inputs[2]!)).not.toBe(tag);
    expect(paidTimes(shield, crew(3))).toEqual([1, 0, 1]);
  });

  it("a record another payee set aside is never taken, even when it is the one that fits", async () => {
    const shield = new TimedShield([centsToMinor(1_00n), centsToMinor(5_00n)]);
    const tag = await recordTag(plaintextOf(centsToMinor(1_00n), "t1"));
    // w2's earlier try, outcome unknown, set aside the 1.00 record and was taken by Shield: it is asked about, not sent.
    const books = keeper([paycheck("w1", 1_00n), paycheck("w2", 50n, { status: "pending", reference: "shield_lost", attempt: tag, failure: "No answer from Shield in time" })]);
    const { result } = await payWith(shield, books, { limits: { resumeCapMs: 10_000 }, findPayment: undefined as never });
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(shield.calls).toHaveLength(1);
    expect(shield.calls[0]!.inputs[2]).toContain(`amount: ${centsToMinor(5_00n)}u128`); // not the 1.00 that fits exactly
    expect(result.unconfirmed.map((u) => u.workerId)).toEqual(["w2"]);
  });

  it("Shield stops answering for the account's records mid-run: the run stalls before the next payment, with nothing asked blind", async () => {
    const shield = new TimedShield([centsToMinor(10_00n)], { onRaise: (n, s) => void (n === 0 && (s.unlisted = true)) });
    const books = keeper(crew(3).map((w) => paycheck(w, 1_00n)));
    const { result } = await payWith(shield, books);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1"]);
    expect(result.stalled).toMatchObject({ at: 2, of: 3 });
    expect(shield.calls).toHaveLength(1);
    expect(books.paychecks.slice(1).map((p) => p.settlement)).toEqual([{ status: "pending" }, { status: "pending" }]);
  });

  it("a reload between payment 4 and 5 resumes at 5 and pays each worker once", async () => {
    // (a) The page reloads while Shield has the fifth request, which it goes on to finish.
    // (b) The same, and Shield never gets to it: the prompt is left until it expires.
    // (c) The page reloads after the fifth was taken (its id kept), before its outcome was heard.
    for (const how of ["finished", "abandoned", "taken"] as const) {
      const shield = new TimedShield([centsToMinor(100_00n)], {
        combine: "hidden",
        ...(how === "taken" ? {} : { leaveOn: 4 }),
        approveAfterMs: (n) => (how === "abandoned" && n === 4 ? 60 * MINUTE : 8_000),
      });
      const books = keeper(crew(6).map((w) => paycheck(w, 10_00n)));
      if (how === "taken") {
        // The page goes away as soon as the books hold the id Shield gave the fifth request.
        let leave!: () => void;
        const left = new Promise<void>((resolve) => (leave = resolve));
        const sleep = async (ms: number) => (books.paychecks[4]!.settlement.reference ? (leave(), new Promise<void>(() => {})) : shield.sleep(ms));
        await Promise.race([payWith(shield, books, { sleep }), left]);
      } else {
        await Promise.race([payWith(shield, books), shield.left]);
      }
      // What the books hold at the reload: four settled, the fifth with its record's tag kept, the sixth untouched.
      expect(books.paychecks.map((p) => p.settlement.status)).toEqual(["settled", "settled", "settled", "settled", "pending", "pending"]);
      expect(books.paychecks[4]!.settlement.attempt).toBe(await recordTag(shield.calls[4]!.inputs[2]!));
      expect(!!books.paychecks[4]!.settlement.reference).toBe(how === "taken");
      expect(books.paychecks[5]!.settlement).toEqual({ status: "pending" });
      expect(shield.calls).toHaveLength(5);
      if (how !== "abandoned") await shield.sleep(30_000); // Shield carries on without the page

      const again = await payWith(shield, books);
      expect(again.result.settled.map((s) => s.workerId)).toEqual(["w5", "w6"]);
      expect(again.result.failed).toEqual([]);
      expect(again.result.unconfirmed).toEqual([]);
      // Nothing is asked again for the four already paid, and the fifth is asked again only when its record is still unspent.
      expect(promptsFor(again.events)).toEqual(how === "abandoned" ? ["w5", "w6"] : ["w6"]);
      if (how === "abandoned") expect(shield.calls[5]!.inputs[2]).toBe(shield.calls[4]!.inputs[2]);
      if (how === "finished") expect(again.result.settled[0]).toMatchObject({ workerId: "w5", found: true });
      expect(books.paychecks.every((p) => p.settlement.status === "settled")).toBe(true);
      await shield.sleep(10 * MINUTE); // the abandoned prompt expires; nothing more lands
      expect(paidTimes(shield, crew(6))).toEqual([1, 1, 1, 1, 1, 1]);
      expect(await shield.listed()).toEqual([centsToMinor(40_00n)]);
    }
  });

  it("a payment taken before a reload settles on the next run, and the one after it waits until what it left is listed", async () => {
    const shield = new TimedShield([centsToMinor(10_00n)]);
    const books = keeper(crew(2).map((w) => paycheck(w, 1_00n)));
    let leave!: () => void;
    const left = new Promise<void>((resolve) => (leave = resolve));
    const sleep = async (ms: number) => (books.paychecks[0]!.settlement.reference ? (leave(), new Promise<void>(() => {})) : shield.sleep(ms));
    await Promise.race([payWith(shield, books, { sleep }), left]);
    shield.listLagMs = 30_000; // what the first payment leaves shows up half a minute after its block

    const reopened = shield.now;
    const { result, events } = await payWith(shield, books);
    expect(result.settled.map((s) => s.workerId)).toEqual(["w1", "w2"]);
    expect(promptsFor(events)).toEqual(["w2"]);
    expect(shield.calls[1]!.inputs[2]).toContain(`amount: ${centsToMinor(9_00n)}u128`);
    expect(shield.now - reopened).toBeGreaterThanOrEqual(38_000);
    expect(paidTimes(shield, crew(2))).toEqual([1, 1]);
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
