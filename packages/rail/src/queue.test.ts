import { describe, expect, it } from "vitest";
import type { Paycheck, PayRun, Settlement } from "@pnw/payroll";
import { FREEZELIST_PROGRAM } from "./exclusion";
import fixture from "./fixtures/transaction.json";
import { type PayQueueEvent, SPLIT_FUNCTION, TRANSFER_FUNCTION, outstanding, recordTag, runPayQueue } from "./queue";
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
    if (status.status === "accepted") this.settle(id);
    return status;
  }

  /** On acceptance, spend the input record; for a split, mint its two outputs. */
  private settle(id: string) {
    const call = this.calls.find((c) => c.walletId === id);
    if (!call) return;
    const inputIndex = call.function === SPLIT_FUNCTION ? 0 : 2;
    const source = this.records.find((r) => r.recordPlaintext === call.inputs[inputIndex]);
    if (!source || source.spent) return;
    source.spent = true;
    const sourceAmount = BigInt(/amount:\s*(\d+)u128/.exec(source.recordPlaintext)![1]!);
    const amount = BigInt(call.inputs[1]!.replace("u128", ""));
    if (call.function === SPLIT_FUNCTION) {
      this.addRecord(amount);
      this.addRecord(sourceAmount - amount);
    } else if (sourceAmount > amount) {
      this.addRecord(sourceAmount - amount); // change
    }
  }
}

const accepted = (id: string, pendingPolls = 0): Status[] => [...Array<Status>(pendingPolls).fill({ status: "pending" }), { status: "accepted", transactionId: id }];
const AT = (n: number) => `at1tx${n}`.padEnd(61, "x");

function fakeNetwork(opts: { frozen?: string[]; fail?: Set<string> } = {}): RailNetwork & { calls: string[] } {
  const calls: string[] = [];
  const frozen = opts.frozen ?? [];
  const base = `program/${FREEZELIST_PROGRAM}/mapping`;
  return {
    calls,
    async fetchJson(path) {
      calls.push(path);
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
function fakeTime() {
  let now = 0;
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
