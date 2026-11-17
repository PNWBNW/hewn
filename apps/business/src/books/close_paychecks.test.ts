// The close and a rail run's paychecks: a paycheck with nothing to pay never holds a close, and
// every settlement in the period root is tied to its own paycheck's entry, whatever place the
// paycheck has in its run.
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, checkPeriodProof, createBooks, periodProofToJson, readPeriodProof } from "@pnw/ledger";
import { type Payroll, type W4, addWorker, emptyPayroll, ensureRailAccount, markPaycheckSettlement, postPayRun, previewPayRun, updateWorker } from "@pnw/payroll";
import { closeChecks, closeRange, periodProofFor, settlementsIn } from "./close";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import { startFromShield } from "./opening";
import type { Rail } from "./rail";
import { reconcileShield } from "./reconcile";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-10-16T12:00:00.000Z" };
const SETTLED_AT = "2026-10-17T09:00:00.000Z";
const SECRET = "ab".repeat(32);
const account = (c: string) => `aleo1${c.repeat(58)}`;
const transfer = (c: string) => `at1${c.repeat(58)}`;
const EMPLOYER = account("q");
const ADDRESS = { Ana: account("z"), Ben: account("y"), Cy: account("x") } as const;
const TX = { Ana: transfer("a"), Ben: transfer("c") } as const;
const opts = { today: "2026-11-02", now: "2026-11-02T18:00:00.000Z", shieldMatches: true, newSecret: SECRET };

type Name = keyof typeof ADDRESS;

/**
 * A rail run for the week of 2026-10-10 paid on the 16th: Ana 40 hours, Ben 30, and, when `zero`
 * says where, Cy with nothing to pay: no hours, or (`how` "all withheld") 10 hours whose withholding
 * takes all of his pay. Ana's and Ben's transfers settled on the 17th; Cy's paycheck is left as
 * posting left it.
 */
function railCompany(zero: "none" | "first" | "last" = "none", how: "no hours" | "all withheld" = "no hours"): { company: Company; ids: Record<Name, string> } {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = ensureRailAccount(books);
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const ids = {} as Record<Name, string>;
  for (const [name, rate] of [["Ana", 3000n], ["Ben", 2550n], ["Cy", 2000n]] as const) {
    const added = addWorker(payroll, { name, payType: "hourly", rate, frequency: "weekly", w4: W4_SINGLE });
    payroll = added.payroll;
    ids[name] = added.worker.id;
  }
  const hours = how === "all withheld" ? 10 : 0;
  if (how === "all withheld") {
    // Extra withholding equal to what 10 hours would pay leaves Cy a net of zero.
    const plain = previewPayRun(payroll, { payDate: "2026-10-16", periodStart: "2026-10-10", periodEnd: "2026-10-16", bankAccountId: rail.accountId, lines: [{ workerId: ids.Cy, hours }] })[0]!;
    payroll = updateWorker(payroll, ids.Cy, { w4: { ...W4_SINGLE, extraWithholding: plain.net } });
  }
  const paid = [{ workerId: ids.Ana, hours: 40 }, { workerId: ids.Ben, hours: 30 }];
  const nothing = { workerId: ids.Cy, hours };
  const lines = zero === "first" ? [nothing, ...paid] : zero === "last" ? [...paid, nothing] : paid;
  const posted = postPayRun(
    books,
    payroll,
    { payDate: "2026-10-16", periodStart: "2026-10-10", periodEnd: "2026-10-16", bankAccountId: rail.accountId, mode: "rail", lines },
    clock,
  );
  payroll = posted.payroll;
  for (const name of ["Ana", "Ben"] as const) {
    payroll = markPaycheckSettlement(payroll, posted.run.id, ids[name], { status: "settled", reference: TX[name], height: 4_210_000, settledAt: SETTLED_AT });
  }
  const links = (Object.keys(ADDRESS) as Name[]).map((name) => ({
    workerId: ids[name],
    address: ADDRESS[name],
    nameHash: "12345",
    agreementId: "01020304",
    status: "linked" as const,
    partiesKey: "0123456789abcdef".repeat(4),
  }));
  const linked: Rail = { version: 1, network: "testnet", address: EMPLOYER, linkedAt: clock.now(), links };
  return { company: { ...emptyCompany(posted.books), payroll, rail: linked }, ids };
}

const runOf = (c: Company) => c.payroll.runs[0]!;
const paycheckOf = (c: Company, workerId: string) => runOf(c).paychecks.find((p) => p.workerId === workerId)!;
/** The entry that commits to this person's paystub in the run: the one their settlement must be tied to. */
const entryFor = (c: Company, workerId: string) => c.books.entries.find((e) => runOf(c).entryIds.includes(e.id) && e.source.doc === paycheckOf(c, workerId).paystubHash)!;
/**
 * How a build from before settlements were paired by paystub reads the same books (main at 3bd53ae,
 * books/close.ts): its close waits while any paycheck of a run paid by the end isn't settled, and it
 * ties the paycheck at each place in a rail run to the entry at the same place.
 */
const earlierBuild = {
  waits: (c: Company, end: string) => c.payroll.runs.some((r) => r.payDate <= end && r.paychecks.some((p) => p.settlement.status !== "settled")),
  settlements: (c: Company, start: string, end: string) => {
    const hashOf = new Map(c.books.entries.map((e) => [e.id, e.hash]));
    const who = new Map(c.rail!.links.map((l) => [l.workerId, l.address]));
    const out: { entryHash: string; txId: string; recipient: string }[] = [];
    for (const run of c.payroll.runs) {
      if (run.mode !== "rail") continue;
      run.paychecks.forEach((p, i) => {
        const s = p.settlement;
        const on = s.settledAt?.slice(0, 10);
        const hash = hashOf.get(run.entryIds[i] ?? "");
        if (s.status !== "settled" || !s.reference || !on || on < start || on > end || !hash) return;
        out.push({ entryHash: hash, txId: s.reference, recipient: who.get(p.workerId) ?? p.workerId });
      });
    }
    return out;
  },
};
/** As an older build left it: posted pending, and nothing on the rail ever moved it. */
const leftPending = (c: Company, workerId: string): Company => ({
  ...c,
  payroll: { ...c.payroll, runs: c.payroll.runs.map((r) => ({ ...r, paychecks: r.paychecks.map((p) => (p.workerId === workerId ? { ...p, settlement: { status: "pending" as const } } : p)) })) },
});

describe("a period root over rail pay", () => {
  it("is unchanged for a run with no paycheck at zero: the same settlements, entries and root as before", () => {
    const { company, ids } = railCompany("none");
    expect(settlementsIn(company, "2026-10-01", "2026-10-31")).toEqual([
      { entryHash: entryFor(company, ids.Ana).hash, txId: TX.Ana, recipient: ADDRESS.Ana },
      { entryHash: entryFor(company, ids.Ben).hash, txId: TX.Ben, recipient: ADDRESS.Ben },
    ]);
    const { record } = closeRange(company, "2026-10-31", opts);
    expect(record).toMatchObject({ start: "2026-10-16", end: "2026-10-31", entries: 2, settlements: 2 });
    // Pinned from the build before settlements were paired by paystub: the same books close to the same root.
    expect(record.root).toBe("80f82887306be67a2ca00e34e8d4acbaefb6160c6be0b643fcddb9d21964dc0f");
  });

  it("ties each settlement to its own paycheck's entry when a paycheck with nothing to pay comes first", () => {
    const { company, ids } = railCompany("first");
    expect(runOf(company).entryIds).toHaveLength(2); // Cy's paycheck posts no entry
    const settlements = settlementsIn(company, "2026-10-01", "2026-10-31");
    expect(settlements).toEqual([
      { entryHash: entryFor(company, ids.Ana).hash, txId: TX.Ana, recipient: ADDRESS.Ana },
      { entryHash: entryFor(company, ids.Ben).hash, txId: TX.Ben, recipient: ADDRESS.Ben },
    ]);
    // Each entry tied to a settlement is the one that pays that person.
    for (const name of ["Ana", "Ben"] as const) {
      expect(entryFor(company, ids[name]).lines.every((l) => l.name?.id === ids[name])).toBe(true);
    }
    const { company: closed, record } = closeRange(company, "2026-10-31", opts);
    expect(record).toMatchObject({ entries: 2, settlements: 2 });
    const proof = periodProofFor(closed, record, "2026-11-05T00:00:00.000Z");
    const checked = checkPeriodProof(readPeriodProof(periodProofToJson(proof)));
    expect(checked.root).toBe(record.root);
    expect(checked.checks.every((c) => c.ok)).toBe(true);
  });

  it("gives the same settlements whether the paycheck with nothing to pay comes first or last", () => {
    for (const how of ["no hours", "all withheld"] as const) {
      const first = railCompany("first", how);
      const last = railCompany("last", how);
      // Whose entry each settlement is tied to, with its transfer and the account it paid.
      const tie = (c: Company) => settlementsIn(c, "2026-10-01", "2026-10-31").map((s) => [c.books.entries.find((e) => e.hash === s.entryHash)!.lines[0]!.name?.id, s.txId, s.recipient]);
      expect(tie(first.company)).toEqual(tie(last.company));
      expect(tie(first.company)).toEqual([
        [first.ids.Ana, TX.Ana, ADDRESS.Ana],
        [first.ids.Ben, TX.Ben, ADDRESS.Ben],
      ]);
    }
  });

  it("leaves out a settlement whose paystub no entry of its run commits to, rather than tie it to another", () => {
    const { company, ids } = railCompany("none");
    const other = "00".repeat(32);
    const changed: Company = {
      ...company,
      payroll: { ...company.payroll, runs: company.payroll.runs.map((r) => ({ ...r, paychecks: r.paychecks.map((p) => (p.workerId === ids.Ana ? { ...p, paystubHash: other } : p)) })) },
    };
    expect(settlementsIn(changed, "2026-10-01", "2026-10-31")).toEqual([{ entryHash: entryFor(company, ids.Ben).hash, txId: TX.Ben, recipient: ADDRESS.Ben }]);
  });
});

describe("a period closed by a build that ties settlements by place in the run", () => {
  // Books open on more than one build: a tab still running the earlier one, another device, the
  // installable app. Whatever this build posts, an earlier build either waits to close the run, as it
  // always has for a paycheck with no gross, or ties each settlement to the same entry this build does.
  for (const [zero, how] of [["none", "no hours"], ["first", "no hours"], ["last", "no hours"], ["first", "all withheld"], ["last", "all withheld"]] as const) {
    it(`waits, or ties each settlement to its own entry: nothing to pay ${zero === "none" ? "nowhere" : `${zero}, ${how}`}`, () => {
      const { company } = railCompany(zero, how);
      if (earlierBuild.waits(company, "2026-10-31")) return;
      expect(earlierBuild.settlements(company, "2026-10-01", "2026-10-31")).toEqual(settlementsIn(company, "2026-10-01", "2026-10-31"));
    });
  }

  it("still waits for a paycheck with no gross, which posts no entry and so shifts the places", () => {
    const { company, ids } = railCompany("first");
    expect(runOf(company).entryIds).toHaveLength(2);
    expect(paycheckOf(company, ids.Cy).settlement.status).not.toBe("settled");
    expect(earlierBuild.waits(company, "2026-10-31")).toBe(true);
  });
});

describe("closing with a paycheck that has nothing to pay", () => {
  it("doesn't hold the close: settled as it posted when withholding took all of its pay, pending and not counted when it had no gross", () => {
    const withheld = railCompany("first", "all withheld");
    expect(paycheckOf(withheld.company, withheld.ids.Cy).settlement).toEqual({ status: "settled", settledAt: clock.now() });
    const none = railCompany("first", "no hours");
    expect(paycheckOf(none.company, none.ids.Cy).settlement).toEqual({ status: "pending" });
    for (const { company } of [withheld, none]) {
      expect(closeChecks(company, "2026-10-16", "2026-10-31", opts.today).find((l) => l.id === "payroll")).toEqual({ id: "payroll", ok: true, label: "No paycheck still settling" });
      expect(closeRange(company, "2026-10-31", opts).company.books.marks.closedThrough).toBe("2026-10-31");
    }
  });

  it("doesn't hold the close when an older build left it pending, and the close leaves it as it was", () => {
    const { company, ids } = railCompany("first", "all withheld");
    const old = leftPending(company, ids.Cy);
    expect(old.payroll).not.toEqual(company.payroll);
    expect(closeChecks(old, "2026-10-16", "2026-10-31", opts.today).find((l) => l.id === "payroll")?.ok).toBe(true);
    const { company: closed } = closeRange(old, "2026-10-31", opts);
    expect(closed.payroll).toBe(old.payroll);
    expect(paycheckOf(closed, ids.Cy).settlement).toEqual({ status: "pending" });
    // Saved and opened again, it is still exactly what the older build wrote.
    expect(paycheckOf(companyFromJson(companyToJson(closed)), ids.Cy).settlement).toEqual({ status: "pending" });
  });

  it("still holds the close for a paycheck with something to pay that hasn't settled or has failed", () => {
    const { company, ids } = railCompany("first");
    for (const settlement of [{ status: "pending" as const }, { status: "failed" as const, failure: "rejected" }]) {
      const open: Company = {
        ...company,
        payroll: { ...company.payroll, runs: company.payroll.runs.map((r) => ({ ...r, paychecks: r.paychecks.map((p) => (p.workerId === ids.Ben ? { ...p, settlement } : p)) })) },
      };
      // Ben's is counted; Cy's, with nothing to pay, isn't.
      expect(closeChecks(open, "2026-10-16", "2026-10-31", opts.today).find((l) => l.id === "payroll")).toMatchObject({ ok: false, detail: "1 paycheck not settled yet" });
      expect(() => closeRange(open, "2026-10-31", opts)).toThrow(/1 paycheck not settled yet/);
    }
  });

  it("isn't counted by the Shield check as pay still settling", () => {
    const rail: Rail = { version: 1, network: "testnet", address: EMPLOYER, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
    const started = startFromShield({ ...emptyCompany(createBooks({ businessName: "T", fiscalYearStartMonth: 1 })), rail }, { date: "2026-10-15", minor: 20_000_000n, at: "2026-10-15T10:00:00Z" });
    const shield = ensureRailAccount(started.books);
    const added = addWorker(started.payroll, { name: "Cy", payType: "hourly", rate: 2000n, frequency: "weekly", w4: W4_SINGLE });
    const posted = postPayRun(
      shield.books,
      added.payroll,
      { payDate: "2026-10-16", periodStart: "2026-10-10", periodEnd: "2026-10-16", bankAccountId: shield.accountId, mode: "rail", lines: [{ workerId: added.worker.id, hours: 0 }] },
      clock,
    );
    const c = leftPending({ ...started, books: posted.books, payroll: posted.payroll }, added.worker.id);
    // Shield holds $5.00 more than the books: nothing explains it, and a paycheck with nothing to pay doesn't either.
    expect(reconcileShield(c, 25_000_000n)).toMatchObject({ kind: "off", gap: 5_000_000n });
  });
});
