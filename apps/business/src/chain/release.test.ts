// The release seam: what a releaser says Shield will be asked, against what a
// wallet is really asked when the pay queue pays a run and each paystub is
// then sent, the way the pay panel does it.
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks, emptyDimensions } from "@pnw/ledger";
import { type Payroll, type W4, addWorker, emptyPayroll, ensureRailAccount, markPaycheckSettlement, postPayRun } from "@pnw/payroll";
import { PROGRAMS } from "@pnw/config/programs";
import {
  NOT_ASKED,
  NOT_LISTED,
  type PayQueueContext,
  type PayQueueResult,
  type RailNetwork,
  RailNetworkError,
  TRANSFER_FUNCTION,
  centsToMinor,
  fetchTokenRecords,
  outstanding,
  totalBalance,
} from "@pnw/rail";
import { emptySales } from "@pnw/sales";
import type { Company } from "../books/company";
import type { Rail } from "../books/rail";
import { deliverPaystub } from "./deliver";
import { LetterBox, SEND_FUNCTION } from "./letters";
import { dueFromRail, shortOnRail, tagRecords } from "./pay_outcome";
import { type Prompt, type Releaser, pickReleaser, promptSummary, sequentialReleaser } from "./release";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-11-13T12:00:00.000Z" };
const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const account = (n: number) => `aleo1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l"[n % 32]!.repeat(58)}`;
const KEY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const AT = (n: number) => `at1tx${n}`.padEnd(61, "x");
const USDCX = PROGRAMS.external.usdcx;

/** A posted rail run for `n` hourly people, each linked to an account with a key for their paystubs. */
function setup(n: number) {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = ensureRailAccount(books);
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const workers = Array.from({ length: n }, (_x, i) => {
    const added = addWorker(payroll, { name: `Worker ${i + 1}`, payType: "hourly", rate: 3000n, frequency: "weekly", w4: W4_SINGLE });
    payroll = added.payroll;
    return added.worker;
  });
  const posted = postPayRun(
    books,
    payroll,
    { payDate: "2026-11-13", periodStart: "2026-11-07", periodEnd: "2026-11-13", bankAccountId: rail.accountId, mode: "rail", lines: workers.map((w, i) => ({ workerId: w.id, hours: 20 + i })) },
    clock,
  );
  const links = workers.map((w, i) => ({ workerId: w.id, address: account(i + 1), nameHash: `${i + 1}`, agreementId: KEY(i + 1).slice(0, 8), status: "linked" as const, partiesKey: KEY(i + 1) }));
  const company: Company = {
    books: posted.books,
    payroll: posted.payroll,
    sales: emptySales(),
    dimensions: emptyDimensions(),
    rail: { version: 1, network: "testnet", address: EMPLOYER, linkedAt: clock.now(), links } satisfies Rail,
  };
  return { company, runId: posted.run.id, workers, links: new Map(links.map((l) => [l.workerId, l.address])) };
}

type Call = { program: string; function: string; inputs: string[] };

/** A wallet for both halves of a release: it lists the account's USDCx, takes every request, and lets each transfer leave its change. */
function fakeShield(deposits: bigint[]) {
  const calls: Call[] = [];
  const listed: string[] = [];
  let minted = 0;
  const records = deposits.map((amount) => ({ plaintext: `{\n  owner: ${EMPLOYER}.private,\n  amount: ${amount}u128.private,\n  _nonce: ${++minted}group.public\n}`, amount, spent: false }));
  return {
    calls,
    /** Every record plaintext the wallet has ever listed. */
    listed,
    address: EMPLOYER,
    async requestRecords(program: string) {
      if (program !== USDCX) return []; // no letters yet
      for (const r of records) if (!listed.includes(r.plaintext)) listed.push(r.plaintext);
      return records.map((r) => ({ recordName: "Token", spent: r.spent, recordPlaintext: r.plaintext }));
    },
    async executeTransaction(opts: Call & { privateFee: false }) {
      calls.push({ program: opts.program, function: opts.function, inputs: opts.inputs });
      if (opts.program === USDCX) {
        const source = records.find((r) => r.plaintext === opts.inputs[2] && !r.spent)!;
        const amount = BigInt(opts.inputs[1]!.replace("u128", ""));
        source.spent = true;
        if (source.amount > amount) records.push({ plaintext: `{\n  owner: ${EMPLOYER}.private,\n  amount: ${source.amount - amount}u128.private,\n  _nonce: ${++minted}group.public\n}`, amount: source.amount - amount, spent: false });
      }
      return { transactionId: `shield_${calls.length}` };
    },
    async transactionStatus(id: string) {
      return { status: "accepted", transactionId: AT(Number(id.replace("shield_", ""))) };
    },
  };
}

/** The explorer: the chain's height, and the stablecoin's freeze list with nobody on it, under each name it is read by. */
const network: RailNetwork = {
  async fetchJson(path) {
    if (path === "block/height/latest") return 4_000_000;
    if (/freeze_list_count/.test(path)) return "0u32";
    if (/freeze_list_last_index\/true$/.test(path)) return "0u32";
    if (/freeze_list_index\/0u32$/.test(path)) return "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
    if (/freeze_list_root\/1u8$/.test(path)) return "0field"; // the root `tree` below makes of an empty list
    throw new RailNetworkError("not found", 404);
  },
};
const tree = {
  generateLeaves: (a: string[]) => a.map((_x, i) => `${i + 1}field`).concat("0field"),
  buildTree: (l: string[]) => l.map((_x, i) => BigInt(i)),
  getLeafIndices: () => [0, 1] as [number, number],
  getSiblingPath: (_t: bigint[], leaf_index: number, depth: number) => ({ siblings: Array<bigint>(depth).fill(0n), leaf_index }),
  formatMerkleProof: () => "[PROOF]",
};
const instant = { clock: { now: () => 0 }, sleep: async () => {}, limits: { pollMinMs: 1, confirmCapMs: 0 } };

/** A whole release as the pay panel runs it: the releaser pays, each settlement is written, then each paystub is sent in turn. */
async function releaseAll(releaser: Releaser, wallet: ReturnType<typeof fakeShield>, start: ReturnType<typeof setup>) {
  let company = start.company;
  const run = company.payroll.runs.find((r) => r.id === start.runId)!;
  const result = await releaser.release({ wallet, network, run, links: start.links, tree, ...instant });
  for (const s of result.settled) {
    company = { ...company, payroll: markPaycheckSettlement(company.payroll, start.runId, s.workerId, { status: "settled", reference: s.transactionId, settledAt: clock.now() }) };
  }
  for (const s of result.settled) {
    const client = new LetterBox({ wallet, to: start.links.get(s.workerId)!, execute: { sleep: async () => {}, pollMs: 1 } });
    company = (await deliverPaystub({ company, runId: start.runId, workerId: s.workerId, client })).company;
  }
  return { result, company };
}

describe("the sequential releaser's prompt plan", () => {
  it("the prompt plan equals the calls Shield receives: 12 workers from one deposit are 12 payments, then 12 paystubs, and nothing else", async () => {
    const start = setup(12);
    const run = start.company.payroll.runs[0]!;
    const plan = sequentialReleaser.prompts(run, start.links);
    expect(plan.map((p) => p.kind)).toEqual([...Array<string>(12).fill("payment"), ...Array<string>(12).fill("paystub")]);

    const wallet = fakeShield([centsToMinor(20_000_00n)]);
    const { result } = await releaseAll(sequentialReleaser, wallet, start);
    expect(result.settled).toHaveLength(12);
    // What Shield was asked, in order, is what the plan said: the same programs and functions, and for each payment
    // the same payee and amount.
    expect(wallet.calls.map((c) => [c.program, c.function])).toEqual(plan.map((p) => [p.program, p.fn]));
    expect(wallet.calls.slice(0, 12).map((c) => [c.inputs[0], c.inputs[1]])).toEqual(plan.slice(0, 12).map((p) => (p.kind === "payment" ? [p.to, `${p.minor}u128`] : [])));
    expect(wallet.calls.slice(12).map((c) => c.inputs[0])).toEqual(plan.slice(12).map((p) => (p.kind === "paystub" ? start.links.get(p.workerId) : undefined)));
    expect(wallet.calls.filter((c) => c.program === USDCX).every((c) => c.function === TRANSFER_FUNCTION)).toBe(true);
  });

  it("every payment prompt names the stablecoin's program and its private transfer, with the payee's account and the amount in minor units", () => {
    const start = setup(3);
    const run = start.company.payroll.runs[0]!;
    const payments = sequentialReleaser.prompts(run, start.links).filter((p) => p.kind === "payment");
    expect(payments).toEqual(
      run.paychecks.map((p) => ({ kind: "payment", program: PROGRAMS.external.usdcx, fn: TRANSFER_FUNCTION, workerId: p.workerId, to: start.links.get(p.workerId), minor: centsToMinor(p.net) })),
    );
    const paystubs = sequentialReleaser.prompts(run, start.links).filter((p) => p.kind === "paystub");
    expect(paystubs).toEqual(run.paychecks.map((p) => ({ kind: "paystub", program: PROGRAMS.letters.hewn_letters, fn: SEND_FUNCTION, workerId: p.workerId })));
  });

  it("counts only what is still to ask: nothing for someone already paid, no payment for one Shield already has", () => {
    const start = setup(3);
    const [a, b, c] = start.workers.map((w) => w.id) as [string, string, string];
    let payroll = markPaycheckSettlement(start.company.payroll, start.runId, a, { status: "settled", reference: AT(1) });
    payroll = markPaycheckSettlement(payroll, start.runId, b, { status: "pending", reference: "shield_7", attempt: "ab".repeat(16) });
    const plan = sequentialReleaser.prompts(payroll.runs[0]!, start.links);
    expect(plan.map((p) => [p.kind, p.kind === "marker" ? "" : p.workerId])).toEqual([
      ["payment", c],
      ["paystub", b],
      ["paystub", c],
    ]);
    // A run that isn't paid on the rail, or has nobody left to pay, asks nothing.
    expect(sequentialReleaser.prompts({ ...payroll.runs[0]!, mode: "external" }, start.links)).toEqual([]);
    expect(sequentialReleaser.prompts({ ...payroll.runs[0]!, paychecks: [] }, start.links)).toEqual([]);
  });

  it("pins every payment's record by its plaintext, one the wallet listed: Shield is never left to choose a record", async () => {
    const start = setup(4);
    const wallet = fakeShield([centsToMinor(900_00n), centsToMinor(5_000_00n)]);
    await releaseAll(sequentialReleaser, wallet, start);
    const payments = wallet.calls.filter((c) => c.program === USDCX);
    expect(payments).toHaveLength(4);
    for (const c of payments) {
      expect(c.function).toBe(TRANSFER_FUNCTION);
      expect(wallet.listed).toContain(c.inputs[2]);
    }
  });
});

describe("a run that stops before what the last payment left is listed", () => {
  it("isn't called short of funds on the pay panel, and paying on once it is listed pays the rest, each person once", async () => {
    const start = setup(3);
    const shield = fakeShield([centsToMinor(20_000_00n)]);
    // Shield's list is behind the chain: until `lagging` is cleared it shows only the records it held at the start.
    let lagging = true;
    type Row = { recordPlaintext: string };
    const held = new Set(((await shield.requestRecords(USDCX)) as Row[]).map((r) => r.recordPlaintext));
    const wallet = { ...shield, requestRecords: async (program: string) => ((await shield.requestRecords(program)) as Row[]).filter((r) => !lagging || held.has(r.recordPlaintext)) };
    let now = 0;
    const timing = { clock: { now: () => now }, sleep: async (ms: number) => void (now += ms), limits: { pollMinMs: 1, confirmCapMs: 0 } };

    const run = start.company.payroll.runs[0]!;
    const first = await sequentialReleaser.release({ wallet, network, run, links: start.links, tree, ...timing });
    expect(first.settled.map((s) => s.workerId)).toEqual([start.workers[0]!.id]);
    expect(first.stalled).toEqual({ at: 2, of: 3, why: NOT_LISTED });

    // What the panel reads of the rail right after: nothing, since the change isn't listed. That isn't a shortfall.
    const due = centsToMinor(run.paychecks.slice(1).reduce((sum, p) => sum + p.net, 0n));
    const balance = totalBalance(await fetchTokenRecords(wallet));
    expect(balance).toBe(0n);
    expect(shortOnRail(balance, due, first.stalled!.why)).toBe(false);

    // Pressed again once Shield lists it (the button still reads Pay now: neither person left was tried): the two
    // people left are paid, and nobody twice.
    lagging = false;
    const payroll = markPaycheckSettlement(start.company.payroll, start.runId, first.settled[0]!.workerId, { status: "settled", reference: first.settled[0]!.transactionId });
    const next = await sequentialReleaser.release({ wallet, network, run: payroll.runs[0]!, links: start.links, tree, ...timing });
    expect(next.settled.map((s) => s.workerId)).toEqual(start.workers.slice(1).map((w) => w.id));
    expect(next.stalled).toBeUndefined();
    const paid = shield.calls.filter((c) => c.program === USDCX).map((c) => c.inputs[0]);
    expect(paid).toEqual(start.workers.map((w) => start.links.get(w.id)));
  });
});

describe("a run that stops at a payment Shield took but never confirmed", () => {
  /**
   * An exactly funded run of three, paid until the second payment: it goes out and lands, but Shield either never
   * says it was accepted ("no answer": the books keep its request id) or throws once it has gone ("threw": they keep
   * only its record, now spent). The books are then written as the pay panel writes them.
   */
  async function stopAtTheSecond(how: "no answer" | "threw") {
    const start = setup(3);
    const run = start.company.payroll.runs[0]!;
    const shield = fakeShield([centsToMinor(run.paychecks.reduce((sum, p) => sum + p.net, 0n))]);
    const second = start.links.get(start.workers[1]!.id)!;
    const wallet = {
      ...shield,
      async executeTransaction(opts: Call & { privateFee: false }) {
        const sent = await shield.executeTransaction(opts);
        if (how === "threw" && opts.inputs[0] === second) throw new Error("Shield restarted");
        return sent;
      },
      transactionStatus: async (id: string) => (how === "no answer" && id === "shield_2" ? { status: "pending" } : shield.transactionStatus(id)),
    };
    let now = 0;
    const timing = { clock: { now: () => now }, sleep: async (ms: number) => void (now += ms), limits: { pollMinMs: 1, confirmCapMs: 0, walletCapMs: 60_000 } };
    const kept = new Map<string, string>();
    const beforeSend = async (workerId: string, attempt: string) => void kept.set(workerId, attempt);
    const first = await sequentialReleaser.release({ wallet, network, run, links: start.links, tree, beforeSend, ...timing });
    expect(first.settled.map((s) => s.workerId)).toEqual([start.workers[0]!.id]);
    expect(first.unconfirmed.map((s) => s.workerId)).toEqual([start.workers[1]!.id]);
    expect(first.stalled).toEqual({ at: 2, of: 3, why: NOT_ASKED });
    const [a, b] = start.workers.map((w) => w.id) as [string, string];
    let payroll = markPaycheckSettlement(start.company.payroll, start.runId, a, { status: "settled", reference: first.settled[0]!.transactionId });
    payroll = markPaycheckSettlement(payroll, start.runId, b, {
      status: "pending",
      failure: first.unconfirmed[0]!.failure,
      attempt: kept.get(b)!,
      ...(how === "no answer" ? { reference: "shield_2" } : {}),
    });
    return { start, shield, timing, run: payroll.runs[0]!, why: first.stalled!.why };
  }

  for (const how of ["no answer", "threw"] as const) {
    it(`isn't called short of funds on the pay panel (${how}), and the next press pays the third person and pays nobody twice`, async () => {
      const { start, shield, timing, run, why } = await stopAtTheSecond(how);
      // What the panel reads of the rail right after: the third person's pay, what the second payment left.
      const records = await tagRecords(await fetchTokenRecords(shield));
      const balance = totalBalance(records);
      const due = outstanding(run);
      expect(balance).toBe(centsToMinor(due[1]!.net));
      expect(balance).toBeLessThan(centsToMinor(due[0]!.net + due[1]!.net)); // less than the run still owes
      // The second payment is asked about or looked for, not paid again: only the third is paid from the rail.
      expect(dueFromRail(due, records)).toBe(centsToMinor(due[1]!.net));
      expect(shortOnRail(balance, dueFromRail(due, records), why)).toBe(false);

      // Continue: the third person is paid; the second is asked about (and settles) or looked for, never asked again.
      const next = await sequentialReleaser.release({ wallet: shield, network, run, links: start.links, tree, ...timing });
      expect(next.settled.map((s) => s.workerId)).toEqual(how === "no answer" ? [start.workers[1]!.id, start.workers[2]!.id] : [start.workers[2]!.id]);
      expect(next.unconfirmed.map((s) => s.workerId)).toEqual(how === "no answer" ? [] : [start.workers[1]!.id]);
      expect(shield.calls.filter((c) => c.program === USDCX).map((c) => c.inputs[0])).toEqual(start.workers.map((w) => start.links.get(w.id)));
    });
  }
});

describe("pickReleaser", () => {
  const other = (available: () => Promise<boolean>): Releaser => ({
    mode: "batch",
    available,
    prompts: () => [],
    release: async (_ctx: PayQueueContext): Promise<PayQueueResult> => ({ settled: [], failed: [], unconfirmed: [] }),
  });

  it("takes the first releaser that is available, and the one-at-a-time queue when none is", async () => {
    const ready = other(async () => true);
    const notReady = other(async () => false);
    expect(await pickReleaser([notReady, ready])).toBe(ready);
    expect(await pickReleaser([ready, notReady])).toBe(ready);
    expect(await pickReleaser([notReady])).toBe(sequentialReleaser);
    expect(await pickReleaser()).toBe(sequentialReleaser);
    expect(sequentialReleaser.mode).toBe("sequential");
    expect(await sequentialReleaser.available()).toBe(true);
  });

  it("a releaser that can't say whether it is available is passed over", async () => {
    const broken = other(async () => Promise.reject(new Error("no answer")));
    expect(await pickReleaser([broken])).toBe(sequentialReleaser);
  });
});

describe("promptSummary", () => {
  const prompt = (kind: Prompt["kind"]): Prompt => (kind === "marker" ? { kind, program: "p.aleo", fn: "f", lines: 2 } : { kind, program: "p.aleo", fn: "f", workerId: "w" });
  it("says about how many times Shield will ask, and for what, in the order it will ask, and that it may be more or fewer", () => {
    const start = setup(12);
    expect(promptSummary(sequentialReleaser.prompts(start.company.payroll.runs[0]!, start.links))).toBe(
      "Shield will ask you about 24 times, one at a time (for 12 payments, then 12 paystubs), and may ask a few more or fewer.",
    );
    expect(promptSummary([prompt("payment"), prompt("paystub")])).toBe("Shield will ask you about 2 times, one at a time (for 1 payment, then 1 paystub), and may ask a few more or fewer.");
    expect(promptSummary([prompt("paystub")])).toBe("Shield will likely ask you once (for 1 paystub), and may ask more or not at all.");
    expect(promptSummary([prompt("marker"), prompt("payment"), prompt("payment"), prompt("paystub"), prompt("paystub")])).toBe(
      "Shield will ask you about 5 times, one at a time (for 1 note to your own account, then 2 payments, then 2 paystubs), and may ask a few more or fewer.",
    );
    expect(promptSummary([])).toBeNull();
  });
});
