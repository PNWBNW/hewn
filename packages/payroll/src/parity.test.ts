// Phase 2 exit criterion: "Running the same payroll in fiat mode produces
// identical entries in the vault, minus the chain transfer." The same run is
// posted twice from the same books: once paid outside the app from a bank
// account, once on the rail from the rail balance. Every entry must match
// line for line; the only difference allowed is which account the net pay is
// credited from. No wallet, no network: this runs offline.
import { describe, expect, it } from "vitest";
import { type Books, type Entry, addAccount, applyTemplate, createBooks, verifyChain } from "@pnw/ledger";
import { type Payroll, type W4, addWorker, emptyPayroll, markPaycheckSettlement, postPayRun } from "./payroll";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-10-16T12:00:00.000Z" };

function setup() {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
  const rail = addAccount(books, { name: "Rail balance", type: "bank" });
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
    {
      workerId: add({ name: "Cy", rate: 3000n, w4: { ...W4_SINGLE, filingStatus: "married_filing_jointly", dependentCredit: 400_000n, extraWithholding: 2500n } }),
      hours: 72,
    },
  ];
  const input = { payDate: "2026-10-16", periodStart: "2026-10-01", periodEnd: "2026-10-14", lines };
  return { books, payroll, bankId, railId: rail.account.id, input };
}

/**
 * An entry with the net-pay account masked, so the two modes can be compared
 * line for line. The hash and the link to the previous hash are left out: both
 * are computed over the account id, so they differ by construction.
 */
function masked(e: Entry, payAccount: string) {
  const { hash: _h, prevHash: _p, ...rest } = e;
  return { ...rest, lines: e.lines.map((l) => ({ ...l, accountId: l.accountId === payAccount ? "<net pay>" : l.accountId })) };
}

describe("parity: paid outside the app vs paid on the rail", () => {
  it("posts identical entries, differing only in the account the net pay is credited from", () => {
    const s = setup();
    const external = postPayRun(s.books, s.payroll, { ...s.input, bankAccountId: s.bankId, mode: "external", reference: "ACH batch 4471" }, clock);
    const rail = postPayRun(s.books, s.payroll, { ...s.input, bankAccountId: s.railId, mode: "rail" }, clock);

    expect(external.entries).toHaveLength(3);
    expect(rail.entries).toHaveLength(3);
    for (const [i, ext] of external.entries.entries()) {
      const onRail = rail.entries[i]!;
      // Same accounts, debits, credits, names, tags, memo, date, source (run id and paystub hash)...
      expect(masked(ext, s.bankId)).toEqual(masked(onRail, s.railId));
      // ...and exactly one line differs before masking: the net-pay credit.
      const differing = ext.lines.filter((l, j) => l.accountId !== onRail.lines[j]!.accountId);
      expect(differing).toHaveLength(1);
      expect(differing[0]).toMatchObject({ accountId: s.bankId, credit: external.run.paychecks[i]!.net, debit: 0n });
      expect(onRail.lines[ext.lines.indexOf(differing[0]!)]).toMatchObject({ accountId: s.railId, credit: rail.run.paychecks[i]!.net });
      expect(ext.source.doc).toBe(external.run.paychecks[i]!.paystubHash);
      expect(onRail.source.doc).toBe(rail.run.paychecks[i]!.paystubHash);
    }
    // The paystub each worker is given is the same document either way.
    expect(rail.run.paychecks.map((p) => p.paystubHash)).toEqual(external.run.paychecks.map((p) => p.paystubHash));
    expect(rail.run.paychecks.map((p) => p.workerId)).toEqual(external.run.paychecks.map((p) => p.workerId));
    expect(new Set(external.run.paychecks.map((p) => p.paystubHash)).size).toBe(3);

    // Only the settlement differs: paid now with the bank's reference, or waiting on the rail.
    for (const p of external.run.paychecks) expect(p.settlement).toEqual({ status: "settled", settledAt: "2026-10-16T12:00:00.000Z", reference: "ACH batch 4471" });
    for (const p of rail.run.paychecks) expect(p.settlement).toEqual({ status: "pending" });
    expect(external.run.mode).toBe("external");
    expect(rail.run.mode).toBe("rail");
    expect(verifyChain(external.books)).toEqual({ ok: true });
    expect(verifyChain(rail.books)).toEqual({ ok: true });
  });

  it("settling the rail paychecks afterwards changes neither the entries nor the paystubs", () => {
    const s = setup();
    const rail = postPayRun(s.books, s.payroll, { ...s.input, bankAccountId: s.railId, mode: "rail" }, clock);
    let payroll = rail.payroll;
    for (const [i, p] of rail.run.paychecks.entries()) {
      payroll = markPaycheckSettlement(payroll, rail.run.id, p.workerId, { status: "settled", reference: `at1transfer${i}`, height: 4_210_000 + i, settledAt: "2026-10-16T12:10:00.000Z" });
    }
    const run = payroll.runs[0]!;
    expect(run.paychecks.every((p) => p.settlement.status === "settled")).toBe(true);
    expect(run.paychecks.map((p) => p.paystubHash)).toEqual(rail.run.paychecks.map((p) => p.paystubHash));
    expect(run.entryIds).toEqual(rail.run.entryIds);
    expect(rail.books.entries.map((e) => e.source.doc)).toEqual(run.paychecks.map((p) => p.paystubHash));
  });
});
