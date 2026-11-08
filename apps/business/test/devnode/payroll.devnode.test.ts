// ---------------------------------------------------------------------------
// A three-worker payroll run against a real Aleo node: the Phase 2 criterion
// rehearsed (BUILD_PLAN.md), with Hewn's own code at every step. The payroll
// package posts the run and its three journal entries (`postPayRun`); the
// rail's pay queue plans the transfers, builds the freeze-list proof and
// sends `split` and `transfer_private` exactly as it does through Shield
// (`runPayQueue`); each settlement is written back the way the Pay panel
// writes it (`markPaycheckSettlement`). What the unit tests can only fake is
// checked here against the VM: the inputs the queue builds are what the
// stablecoin takes, the records it reads back are what the chain returns,
// each worker ends up holding exactly their net pay, and each entry is
// balanced and linked to the transaction that paid it.
//
// The stablecoin is the stand-in from pnw_mvp_v2/src/stubs (the deployed one
// can't be copied to a devnode: only its issuer may deploy or mint it). It
// moves value the way the deployed program does; its freeze-list proof is
// taken and not checked, since the freeze-list program isn't on a devnode.
// Test-only keys (harness.ts): the wallet here signs with the node's seeded
// account; in the app, Shield signs (INV-11).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinalizeRevertError, waitForConfirmation } from "@provablehq/veil-core";
import { type Books, type Entry, addAccount, applyTemplate, createBooks, verifyChain } from "@pnw/ledger";
import { type Payroll, type Settlement, type W4, addWorker, emptyPayroll, markPaycheckSettlement, postPayRun } from "@pnw/payroll";
import { type PayQueueEvent, type RailNetwork, RailNetworkError, type RailWallet, USDCX_PROGRAM, centsToMinor, explorerNetwork, runPayQueue } from "@pnw/rail";
import { FREEZELIST_PROGRAM } from "@pnw/rail";
import { type Aleo, type Clients, type Devnode, type Listed, type Output, deploy, opened, outputsOf, send, sendTx, start } from "./harness";

/** The stand-in's bytecode, built by Leo 4.0.0 from pnw_mvp_v2/src/stubs/test_usdcx_stablecoin.aleo (README.md). */
const PROGRAM_SHA256 = "1b00b69ef302f2c6a5af8e6888b8e33cb9fd77edf332cf79a35241f952586bc0";
/** The devnode's REST API, the same shape as the explorer's. */
const DEVNODE_REST = "http://127.0.0.1:3030/testnet";

const TRANSFER_OUTPUTS = ["ComplianceRecord", "Token", "Token"] as const;
const SPLIT_OUTPUTS = ["Token", "Token"] as const;
const MINT_OUTPUTS = ["ComplianceRecord", "Token"] as const;

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-11-06T18:00:00.000Z" };

let node: Devnode;
let business: Clients;
let aleo: Aleo;

beforeAll(async () => {
  ({ node, clients: business, aleo } = await start());
  await deploy(business, "test_usdcx_stablecoin.aleo", PROGRAM_SHA256);
});

afterAll(async () => {
  await node?.stop();
});

// ---- The wallet, as the rail sees it ----------------------------------------------

/**
 * A RailWallet over the devnode client for the business's account: it signs and sends the
 * calls the queue builds, answers for them the way Shield's adaptor does (an on-chain id, then
 * "accepted" once the node confirms it), and lists the account's Token records, spending the one
 * each call consumed and adding the ones it produced.
 */
class DevnodeWallet implements RailWallet {
  readonly address: string;
  readonly calls: { program: string; function: string; inputs: string[] }[] = [];
  private readonly records = new Map<string, { recordPlaintext: string; spent: boolean }>();
  private readonly pending = new Map<string, { inputs: string[]; function: string }>();

  constructor(
    private readonly clients: Clients,
    private readonly chain: Aleo,
  ) {
    this.address = clients.account.address;
  }

  /** Adds the Token records among `outputs` this account can open. */
  credit(outputs: Output[], names: readonly string[]): Listed[] {
    const mine = opened(this.chain, outputs, this.clients.account.viewKey, names).filter((r) => r.recordName === "Token");
    for (const r of mine) this.records.set(r.recordPlaintext, { recordPlaintext: r.recordPlaintext, spent: false });
    return mine;
  }

  unspent(): string[] {
    return [...this.records.values()].filter((r) => !r.spent).map((r) => r.recordPlaintext);
  }

  async requestRecords(programId: string, all?: boolean): Promise<unknown[]> {
    expect(programId).toBe(USDCX_PROGRAM);
    return [...this.records.values()].filter((r) => all || !r.spent).map((r) => ({ recordName: "Token", ...r }));
  }

  async executeTransaction(opts: { program: string; function: string; inputs: string[]; fee?: number; privateFee: false }): Promise<{ transactionId: string }> {
    const call = { program: opts.program, function: opts.function, inputs: opts.inputs };
    this.calls.push(call);
    const transactionId = await this.clients.walletClient.writeContract(call);
    this.pending.set(transactionId, { inputs: opts.inputs, function: opts.function });
    return { transactionId };
  }

  async transactionStatus(id: string): Promise<{ status: string; transactionId?: string; error?: string }> {
    const sent = this.pending.get(id);
    if (!sent) return { status: "accepted", transactionId: id };
    let tx: unknown;
    try {
      tx = await waitForConfirmation(this.clients.publicClient, id, 20_000);
    } catch (e) {
      if (e instanceof FinalizeRevertError) return { status: "rejected", transactionId: id, error: e.message };
      return { status: "pending", transactionId: id }; // not in a block yet
    }
    // Confirmed: the record it spent is gone, and the ones it made are the account's now.
    const spentIndex = sent.function === "split" ? 0 : 2;
    const spent = this.records.get(sent.inputs[spentIndex] ?? "");
    if (spent) spent.spent = true;
    this.credit(outputsOf(tx), sent.function === "split" ? SPLIT_OUTPUTS : TRANSFER_OUTPUTS);
    this.pending.delete(id);
    return { status: "accepted", transactionId: id };
  }
}

/**
 * The devnode's REST API as the rail reads the explorer. The freeze-list program isn't on a
 * devnode, so its mapping reads answer "not found", which the rail takes as an empty list, as it
 * would from the explorer before the first address is frozen.
 */
function devnodeNetwork(): RailNetwork {
  const rest = explorerNetwork(DEVNODE_REST, fetch);
  return {
    async fetchJson(path: string) {
      try {
        return await rest.fetchJson(path);
      } catch (e) {
        if (path.startsWith(`program/${FREEZELIST_PROGRAM}/`) && e instanceof RailNetworkError) throw new RailNetworkError("not found", 404);
        throw e;
      }
    },
  };
}

// ---- The books, as the Payroll page posts them ------------------------------------

function setup() {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = addAccount(books, { name: "Shield account", type: "bank" });
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const add = (w: Partial<Parameters<typeof addWorker>[1]> & { name: string }) => {
    const r = addWorker(payroll, { payType: "hourly", rate: 2500n, frequency: "biweekly", w4: W4_SINGLE, ...w });
    payroll = r.payroll;
    return r.worker.id;
  };
  const lines = [
    { workerId: add({ name: "Ana", payType: "salary", rate: 5_200_000n }) },
    { workerId: add({ name: "Ben", rate: 2550n }), hours: 80.25, tags: { project: "proj-1" } },
    { workerId: add({ name: "Cy", rate: 3000n, w4: { ...W4_SINGLE, filingStatus: "married_filing_jointly", dependentCredit: 400_000n, extraWithholding: 2500n } }), hours: 72 },
  ];
  return { books, payroll, railId: rail.account.id, input: { payDate: "2026-11-06", periodStart: "2026-10-16", periodEnd: "2026-10-31", lines } };
}

/** What the Pay panel does with each queue event: the settlement written to the vault. */
function settleTo(payroll: Payroll, runId: string, workerId: string, target: Settlement): Payroll {
  const current = payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
  if (!current || current.status === "settled") return payroll;
  return markPaycheckSettlement(payroll, runId, workerId, target);
}

const sumDebits = (e: Entry) => e.lines.reduce((s, l) => s + l.debit, 0n);
const sumCredits = (e: Entry) => e.lines.reduce((s, l) => s + l.credit, 0n);

/** The Token records in a transaction's outputs that `viewKey` opens. */
async function tokensIn(network: RailNetwork, txId: string, viewKey: string): Promise<bigint[]> {
  const tx = await network.fetchJson(`transaction/${txId}`);
  return opened(aleo, outputsOf(tx), viewKey, TRANSFER_OUTPUTS)
    .filter((r) => r.recordName === "Token")
    .map((r) => BigInt(/amount:\s*(\d+)u128/.exec(r.recordPlaintext)![1]!));
}

describe("a three-worker payroll run on a real Aleo node", () => {
  it("pays three workers from one USDCx record, each entry balanced and linked to its transfer", async () => {
    // The business holds $10,000 of USDCx as one private record: minted to its public balance and
    // taken private, the route the deployed program offers.
    const wallet = new DevnodeWallet(business, aleo);
    const funds = centsToMinor(1_000_000n);
    await send(business, { program: USDCX_PROGRAM, function: "mint_test", inputs: [business.account.address, `${funds}u128`] });
    const minted = await send(business, { program: USDCX_PROGRAM, function: "transfer_public_to_private", inputs: [business.account.address, `${funds}u128`] });
    expect(wallet.credit(minted, MINT_OUTPUTS)).toHaveLength(1);

    // Three workers, each with a Shield account of their own.
    const workers = [aleo.generateAccount(), aleo.generateAccount(), aleo.generateAccount()];
    const s = setup();
    const links = new Map(s.input.lines.map((l, i) => [l.workerId, workers[i]!.address]));

    // The Payroll page posts the run: three entries, three pending paychecks.
    const posted = postPayRun(s.books, s.payroll, { ...s.input, bankAccountId: s.railId, mode: "rail" }, clock);
    expect(posted.entries).toHaveLength(3);
    expect(posted.run.paychecks.every((p) => p.settlement.status === "pending")).toBe(true);
    let payroll = posted.payroll;
    const runId = posted.run.id;

    // The Pay panel runs the queue and writes each outcome as it arrives.
    const events: PayQueueEvent[] = [];
    const result = await runPayQueue({
      wallet,
      network: devnodeNetwork(),
      run: posted.run,
      links,
      limits: { pollMinMs: 1_000, pollMaxMs: 3_000, recordPollMs: 500, recordWaitMs: 60_000, confirmCapMs: 60_000 },
      beforeSend: async (workerId, attempt) => {
        payroll = settleTo(payroll, runId, workerId, { status: "pending", attempt });
      },
      onProgress: (e) => {
        events.push(e);
        if (e.kind === "sent") payroll = settleTo(payroll, runId, e.workerId, { status: "pending", reference: e.reference, ...(e.attempt ? { attempt: e.attempt } : {}) });
        if (e.kind === "settled")
          payroll = settleTo(payroll, runId, e.workerId, {
            status: "settled",
            reference: e.transactionId,
            settledAt: clock.now(),
            ...(e.height !== undefined ? { height: e.height } : {}),
            ...(e.feeMicrocredits !== undefined ? { feeMicrocredits: e.feeMicrocredits } : {}),
          });
      },
    });

    // Every payment settled, none failed or in doubt; the one record was split before the transfers.
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([]);
    expect(result.settled).toHaveLength(3);
    const planned = events.find((e) => e.kind === "planned");
    expect(planned && planned.kind === "planned" ? planned.splits : -1).toBeGreaterThan(0);
    expect(wallet.calls.filter((c) => c.function === "transfer_private")).toHaveLength(3);
    for (const c of wallet.calls) expect(c.program).toBe(USDCX_PROGRAM);

    // The books: each paycheck settled with its on-chain transaction id, each entry balanced and
    // linked to its paycheck, the chain of entries intact.
    const run = payroll.runs.find((r) => r.id === runId)!;
    const ids = run.paychecks.map((p) => p.settlement.reference!);
    expect(run.paychecks.map((p) => p.settlement.status)).toEqual(["settled", "settled", "settled"]);
    expect(ids.every((id) => id.startsWith("at1"))).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(run.entryIds).toHaveLength(3);
    for (const [i, p] of run.paychecks.entries()) {
      const entry = posted.books.entries.find((e) => e.id === run.entryIds[i])!;
      expect(sumDebits(entry)).toBe(sumCredits(entry));
      expect(sumDebits(entry)).toBeGreaterThan(0n);
      expect(entry.source).toMatchObject({ kind: "payroll", ref: runId, doc: p.paystubHash });
      expect(entry.lines.find((l) => l.accountId === s.railId)).toMatchObject({ credit: p.net, debit: 0n });
    }
    expect(verifyChain(posted.books)).toEqual({ ok: true });

    // The chain: each worker's account holds a Token of exactly their net pay, from the transaction
    // their paycheck names, and nobody else can open it; the business keeps the rest.
    const network = devnodeNetwork();
    let paid = 0n;
    for (const [i, p] of run.paychecks.entries()) {
      const mine = await tokensIn(network, p.settlement.reference!, workers[i]!.viewKey);
      expect(mine).toEqual([centsToMinor(p.net)]);
      for (const [j, other] of workers.entries()) if (j !== i) expect(await tokensIn(network, p.settlement.reference!, other.viewKey)).toEqual([]);
      paid += centsToMinor(p.net);
    }
    const left = wallet.unspent().map((r) => BigInt(/amount:\s*(\d+)u128/.exec(r)![1]!)).reduce((a, b) => a + b, 0n);
    expect(left).toBe(funds - paid);
    expect(paid).toBeGreaterThan(0n);
  }, 600_000);

  it("refuses a run the business can't cover, before anything is sent", async () => {
    const wallet = new DevnodeWallet(business, aleo);
    const funds = centsToMinor(100n); // one dollar
    await send(business, { program: USDCX_PROGRAM, function: "mint_test", inputs: [business.account.address, `${funds}u128`] });
    wallet.credit(await send(business, { program: USDCX_PROGRAM, function: "transfer_public_to_private", inputs: [business.account.address, `${funds}u128`] }), MINT_OUTPUTS);
    const s = setup();
    const posted = postPayRun(s.books, s.payroll, { ...s.input, bankAccountId: s.railId, mode: "rail" }, clock);
    const links = new Map(s.input.lines.map((l) => [l.workerId, aleo.generateAccount().address]));
    await expect(runPayQueue({ wallet, network: devnodeNetwork(), run: posted.run, links, limits: { pollMinMs: 500 } })).rejects.toThrow(/Not enough balance/);
    expect(wallet.calls).toEqual([]);
  }, 300_000);

  it("going private with more USDCx than the business holds is refused on chain", async () => {
    // The route a business's money takes before a pay run, with one unit too many: the node's
    // finalize rejects it, which the wallet reports as "rejected" and the queue as a failed step.
    const funds = centsToMinor(100n);
    await send(business, { program: USDCX_PROGRAM, function: "mint_test", inputs: [business.account.address, `${funds}u128`] });
    await expect(
      send(business, { program: USDCX_PROGRAM, function: "transfer_public_to_private", inputs: [business.account.address, `${funds + 1n}u128`] }),
    ).rejects.toBeInstanceOf(FinalizeRevertError);
  }, 300_000);

  it("a Token the business doesn't own can't be spent by it", async () => {
    // What the Leo test runner lets through and the VM refuses (the stand-in's tests say so): the
    // business pays a worker, then tries to spend the worker's Token. Owning the plaintext is
    // not owning the record.
    const funds = 50n;
    const worker = aleo.generateAccount();
    await send(business, { program: USDCX_PROGRAM, function: "mint_test", inputs: [business.account.address, `${funds}u128`] });
    const [token] = opened(aleo, await send(business, { program: USDCX_PROGRAM, function: "transfer_public_to_private", inputs: [business.account.address, `${funds}u128`] }), business.account.viewKey, MINT_OUTPUTS);
    const proof = `[${Array(2).fill(`{siblings: [${Array(16).fill("0field").join(", ")}], leaf_index: 0u32}`).join(", ")}]`;
    const paid = opened(aleo, await send(business, { program: USDCX_PROGRAM, function: "transfer_private", inputs: [worker.address, "20u128", token!.recordPlaintext, proof] }), worker.viewKey, TRANSFER_OUTPUTS);
    expect(paid.map((r) => r.recordName)).toEqual(["Token"]);
    await expect(
      sendTx(business, { program: USDCX_PROGRAM, function: "transfer_private", inputs: [business.account.address, "1u128", paid[0]!.recordPlaintext, proof] }),
    ).rejects.toThrow();
  }, 300_000);

  // Not tested here: paying more than a Token holds. The stand-in refuses it the way the deployed
  // program does (the subtraction underflows; its Leo test `test_pay_over_token_fails`), but
  // through the SDK that underflow is a panic inside the VM's WebAssembly during local execution:
  // the promise never settles, so the test can only time out. Shield would refuse to build the
  // transaction the same way; the queue never builds one (`planTransfers` splits first).
});
