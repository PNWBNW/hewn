import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Books, addAccount, postEntry, systemAccount } from "./books";
import { netIncome, trialBalance } from "./reports";
import { type StatementRow, type StatementSection, balanceSheet, cashFlow, fiscalYearOf, profitAndLoss } from "./statements";
import { clock, sampleBooks } from "./test_helpers";

/** sampleBooks plus one account of each statement type, sub-accounts, and two years of activity. */
function twoYears() {
  let { books, ids } = sampleBooks();
  const acct = (key: string, input: Parameters<typeof addAccount>[1]) => {
    const r = addAccount(books, input);
    books = r.books;
    ids[key] = r.account.id;
  };
  acct("officeRent", { name: "Office", type: "expense", parentId: ids.rent!, number: "6252" });
  acct("storageRent", { name: "Storage", type: "expense", parentId: ids.rent!, number: "6251" });
  acct("advertising", { name: "Advertising", type: "expense", number: "6000" });
  acct("unused", { name: "Unused", type: "expense", number: "6999" });
  acct("cogs", { name: "Materials", type: "cost_of_goods_sold" });
  acct("interest", { name: "Interest Earned", type: "other_income" });
  acct("penalties", { name: "Penalties", type: "other_expense" });
  acct("equipment", { name: "Equipment", type: "fixed_asset", number: "1500" });
  acct("depreciation", { name: "Accumulated Depreciation", type: "fixed_asset", number: "1590" });
  acct("loan", { name: "Truck Loan", type: "long_term_liability" });
  acct("draw", { name: "Owner's Draw", type: "equity" });

  const post = (date: string, lines: Parameters<typeof postEntry>[1]["lines"]) => {
    books = postEntry(books, { date, lines }, clock).books;
  };
  // 2025
  post("2025-01-05", [{ accountId: ids.checking!, debit: 1_000_000n }, { accountId: ids.owner!, credit: 1_000_000n }]);
  post("2025-03-01", [{ accountId: ids.equipment!, debit: 500_000n }, { accountId: ids.loan!, credit: 500_000n }]);
  post("2025-06-01", [{ accountId: ids.checking!, debit: 400_000n }, { accountId: ids.sales!, credit: 400_000n }]);
  post("2025-06-02", [{ accountId: ids.officeRent!, debit: 150_000n }, { accountId: ids.checking!, credit: 150_000n }]);
  post("2025-12-31", [{ accountId: ids.rent!, debit: 10_000n }, { accountId: ids.depreciation!, credit: 10_000n }]);
  // 2026
  post("2026-02-01", [{ accountId: ids.checking!, debit: 90_000n }, { accountId: ids.sales!, credit: 90_000n }]);
  post("2026-02-03", [{ accountId: ids.storageRent!, debit: 30_000n }, { accountId: ids.card!, credit: 30_000n }]);
  post("2026-02-04", [{ accountId: ids.cogs!, debit: 20_000n }, { accountId: ids.checking!, credit: 20_000n }]);
  post("2026-02-05", [{ accountId: ids.checking!, debit: 1_234n }, { accountId: ids.interest!, credit: 1_234n }]);
  post("2026-02-06", [{ accountId: ids.penalties!, debit: 500n }, { accountId: ids.checking!, credit: 500n }]);
  post("2026-02-07", [{ accountId: ids.draw!, debit: 25_000n }, { accountId: ids.checking!, credit: 25_000n }]);
  post("2026-02-08", [{ accountId: ids.advertising!, debit: 4_000n }, { accountId: ids.checking!, credit: 4_000n }]);
  // A refund against advertising later in the year, so it nets negative in March.
  post("2026-03-02", [{ accountId: ids.checking!, debit: 1_000n }, { accountId: ids.advertising!, credit: 1_000n }]);
  return { books, ids };
}

const flat = (rows: StatementRow[]): StatementRow[] => rows.flatMap((r) => [r, ...flat(r.children)]);
const find = (s: StatementSection, id: string): StatementRow | undefined =>
  [...flat(s.rows), ...s.groups.flatMap((g) => (find(g, id) ? [find(g, id)!] : []))].find((r) => r.accountId === id);

describe("profit and loss", () => {
  const { books, ids } = twoYears();
  const fy2026 = { from: "2026-01-01", to: "2026-12-31" };

  it("lays out income, COGS, gross profit, expenses and other items, positive on the normal side", () => {
    const pl = profitAndLoss(books, fy2026);
    expect(pl.income.total).toEqual([90_000n]);
    expect(pl.costOfGoodsSold.total).toEqual([20_000n]);
    expect(pl.grossProfit).toEqual([70_000n]);
    expect(pl.expenses.total).toEqual([33_000n]); // storage 300 + advertising 40 − 10
    expect(pl.netOperatingIncome).toEqual([37_000n]);
    expect(pl.otherIncome.total).toEqual([1_234n]);
    expect(pl.otherExpenses.total).toEqual([500n]);
    expect(pl.netOtherIncome).toEqual([734n]);
    expect(pl.netIncome).toEqual([37_734n]);
    expect(pl.netIncome[0]).toBe(netIncome(books, fy2026.from, fy2026.to));
  });

  it("nests sub-accounts under their parent with a rolled-up total, in number-then-name order", () => {
    const pl = profitAndLoss(books, { from: "2025-01-01", to: "2025-12-31" });
    const rent = pl.expenses.rows.find((r) => r.accountId === ids.rent)!;
    expect(rent.own).toEqual([10_000n]);
    expect(rent.total).toEqual([160_000n]);
    expect(rent.children.map((c) => c.name)).toEqual(["Office"]); // Storage had nothing in 2025
    const pl26 = profitAndLoss(books, fy2026);
    // Advertising (6000) before Rent (no number); Storage (6251) before Office (6252).
    expect(pl26.expenses.rows.map((r) => r.name)).toEqual(["Advertising", "Rent"]);
    const rent26 = pl26.expenses.rows.find((r) => r.accountId === ids.rent)!;
    expect(rent26.own).toEqual([0n]);
    expect(rent26.children.map((c) => c.name)).toEqual(["Storage"]);
  });

  it("leaves out accounts with nothing in the range, and shows a net refund as a negative", () => {
    const march = profitAndLoss(books, { from: "2026-03-01", to: "2026-03-31" });
    expect(flat(march.expenses.rows).map((r) => r.name)).toEqual(["Advertising"]);
    expect(march.expenses.total).toEqual([-1_000n]);
    expect(find(profitAndLoss(books, fy2026).expenses, ids.unused!)).toBeUndefined();
  });

  it("returns a comparison column beside the main one", () => {
    const pl = profitAndLoss(books, fy2026, { from: "2025-01-01", to: "2025-12-31" });
    expect(pl.columns).toHaveLength(2);
    expect(pl.income.total).toEqual([90_000n, 400_000n]);
    expect(pl.netIncome).toEqual([37_734n, 240_000n]);
    // Storage has 2026 activity only; it still shows, with a zero in the 2025 column.
    expect(find(pl.expenses, ids.storageRent!)?.own).toEqual([30_000n, 0n]);
  });
});

describe("balance sheet", () => {
  const { books, ids } = twoYears();

  it("balances, and groups accounts the way a bookkeeper expects", () => {
    const bs = balanceSheet(books, "2026-02-28");
    expect(bs.assets.total).toEqual(bs.liabilitiesAndEquity);
    expect(bs.assets.groups.map((g) => g.id)).toEqual(["current_assets", "fixed_assets"]);
    expect(bs.assets.groups[0]!.groups.map((g) => g.id)).toEqual(["bank"]);
    expect(bs.liabilities.groups.map((g) => g.id)).toEqual(["current_liabilities", "long_term_liabilities"]);
    // Accumulated depreciation is a contra asset: negative on the asset side.
    expect(find(bs.assets, ids.depreciation!)?.own).toEqual([-10_000n]);
    expect(find(bs.liabilities, ids.card!)?.own).toEqual([30_000n]);
    expect(find(bs.equity, ids.draw!)?.own).toEqual([-25_000n]);
  });

  it("puts prior years in Retained Earnings and this year in Net income, matching the P&L and trial balance", () => {
    const asOf = "2026-02-28";
    const bs = balanceSheet(books, asOf);
    const fy = fiscalYearOf(books, asOf);
    const retained = systemAccount(books, "retained_earnings").id;

    const ytd = profitAndLoss(books, { from: fy.from, to: asOf });
    expect(bs.netIncome).toEqual(ytd.netIncome);
    expect(bs.equity.rows.at(-1)).toMatchObject({ accountId: null, name: "Net income", total: ytd.netIncome });

    const prior = profitAndLoss(books, { from: "2025-01-01", to: "2025-12-31" });
    expect(find(bs.equity, retained)?.own).toEqual(prior.netIncome);
    expect(prior.netIncome[0]).toBe(trialBalance(books, asOf).rows.find((r) => r.accountId === retained)!.credit);
  });

  it("compares two dates side by side", () => {
    const bs = balanceSheet(books, "2026-02-28", "2025-12-31");
    expect(bs.columns).toEqual(["2026-02-28", "2025-12-31"]);
    expect(bs.assets.total).toEqual(bs.liabilitiesAndEquity);
    // At 2025-12-31 the year's profit is still "Net income"; it moves to Retained Earnings on 2026-01-01.
    expect(bs.netIncome[1]).toBe(240_000n);
    expect(find(bs.equity, systemAccount(books, "retained_earnings").id)?.own).toEqual([240_000n, 0n]);
  });

  it("has an empty, balanced shape for books with no entries", () => {
    const bs = balanceSheet(sampleBooks().books, "2026-10-31");
    expect(bs.assets).toMatchObject({ groups: [], total: [0n] });
    expect(bs.equity.rows).toEqual([expect.objectContaining({ name: "Net income", total: [0n] })]);
  });
});

describe("cash flow", () => {
  const { books, ids } = twoYears();
  const fy2026 = { from: "2026-01-01", to: "2026-12-31" };
  const fy2025 = { from: "2025-01-01", to: "2025-12-31" };
  const cf = cashFlow(books, fy2026, fy2025);
  const bankTotal = (asOf: string) => {
    const bs = balanceSheet(books, asOf);
    return bs.assets.groups.find((g) => g.id === "current_assets")!.groups.find((g) => g.id === "bank")!.total[0]!;
  };

  it("starts from net income and adjusts for the other current accounts, as their effect on cash", () => {
    expect(cf.netIncome).toEqual([37_734n, 240_000n]);
    // 2026: storage rent went on the card (cash kept); 2025: nothing current moved.
    expect(find(cf.operating, ids.card!)?.total).toEqual([30_000n, 0n]);
    expect(cf.operating.rows.map((r) => r.name)).toEqual(["Net income"]);
    expect(cf.operating.total).toEqual([67_734n, 240_000n]);
  });

  it("puts fixed assets under investing and debt and equity under financing", () => {
    // 2025: the truck bought on a loan, and its depreciation (a contra fixed asset, so investing).
    expect(find(cf.investing, ids.equipment!)?.total).toEqual([0n, -500_000n]);
    expect(find(cf.investing, ids.depreciation!)?.total).toEqual([0n, 10_000n]);
    expect(cf.investing.total).toEqual([0n, -490_000n]);
    expect(find(cf.financing, ids.loan!)?.total).toEqual([0n, 500_000n]);
    expect(find(cf.financing, ids.owner!)?.total).toEqual([0n, 1_000_000n]);
    expect(find(cf.financing, ids.draw!)?.total).toEqual([-25_000n, 0n]);
    expect(cf.financing.total).toEqual([-25_000n, 1_500_000n]);
  });

  it("reconciles to the other two statements: net income is the P&L's, and the net change is the change in the bank balances", () => {
    expect(cf.netIncome).toEqual([profitAndLoss(books, fy2026).netIncome[0], profitAndLoss(books, fy2025).netIncome[0]]);
    expect(cf.netIncome[0]).toBe(balanceSheet(books, "2026-12-31").netIncome[0]);
    expect(cf.netChange).toEqual([42_734n, 1_250_000n]);
    expect(cf.cashAtStart).toEqual([1_250_000n, 0n]);
    expect(cf.cashAtEnd).toEqual([1_292_734n, 1_250_000n]);
    expect(cf.cashAtEnd[0]).toBe(bankTotal("2026-12-31"));
    expect(cf.cashAtStart[0]).toBe(bankTotal("2025-12-31"));
    expect(cf.netChange[0]).toBe(bankTotal("2026-12-31") - bankTotal("2025-12-31"));
  });

  it("has an empty shape for books with no entries", () => {
    const empty = cashFlow(sampleBooks().books, fy2026);
    expect(empty.netIncome).toEqual([0n]);
    expect(empty.operating.groups).toEqual([]);
    expect(empty.investing.rows).toEqual([]);
    expect(empty.financing.rows).toEqual([]);
    expect(empty.netChange).toEqual([0n]);
    expect(empty.cashAtEnd).toEqual([0n]);
  });
});

describe("fiscal years", () => {
  it("covers twelve months from the start month", () => {
    const { books } = sampleBooks();
    expect(fiscalYearOf(books, "2026-10-13")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    const july = { ...books, settings: { ...books.settings, fiscalYearStartMonth: 7 } };
    expect(fiscalYearOf(july, "2026-03-01")).toEqual({ from: "2025-07-01", to: "2026-06-30" });
  });
});

// ---- Property: random balanced activity over two fiscal years -----------------------

const { books: base, ids } = twoYears();
const posting = [
  ids.checking!, ids.sales!, ids.rent!, ids.officeRent!, ids.card!, ids.owner!, ids.cogs!,
  ids.interest!, ids.penalties!, ids.equipment!, ids.depreciation!, ids.loan!, ids.draw!,
];
const amount = fc.bigInt({ min: 1n, max: 1_000_000_00n });
const date = fc
  .record({ y: fc.constantFrom(2025, 2026), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) })
  .map(({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
const entry = fc
  .record({ debit: fc.constantFrom(...posting), credit: fc.constantFrom(...posting), cents: amount, date })
  .filter((e) => e.debit !== e.credit)
  .map((e) => ({ date: e.date, lines: [{ accountId: e.debit, debit: e.cents }, { accountId: e.credit, credit: e.cents }] }));

describe("statements (property-based)", () => {
  it("assets = liabilities + equity, and net income ties to the P&L and Retained Earnings, for any activity", () => {
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 25 }), fc.integer({ min: 1, max: 12 }), date, (entries, startMonth, asOf) => {
        let books: Books = { ...base, entries: [], settings: { ...base.settings, fiscalYearStartMonth: startMonth } };
        for (const e of entries) books = postEntry(books, e, clock).books;

        const bs = balanceSheet(books, asOf, "2025-06-30");
        expect(bs.assets.total).toEqual(bs.liabilitiesAndEquity);

        const fy = fiscalYearOf(books, asOf);
        expect(bs.netIncome[0]).toBe(profitAndLoss(books, { from: fy.from, to: asOf }).netIncome[0]);
        const retained = systemAccount(books, "retained_earnings").id;
        const rolled = profitAndLoss(books, { from: "2000-01-01", to: dayBefore(fy.from) }).netIncome[0]!;
        expect(find(bs.equity, retained)?.own[0] ?? 0n).toBe(rolled);
        const tbRow = trialBalance(books, asOf).rows.find((r) => r.accountId === retained);
        expect(tbRow ? tbRow.credit - tbRow.debit : 0n).toBe(rolled);
      }),
      { numRuns: 300 },
    );
  });

  it("cash flow: the net change is the change in the bank accounts, and the statements agree, for any activity and range", () => {
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 25 }), fc.integer({ min: 1, max: 12 }), date, date, (entries, startMonth, d1, d2) => {
        let books: Books = { ...base, entries: [], settings: { ...base.settings, fiscalYearStartMonth: startMonth } };
        for (const e of entries) books = postEntry(books, e, clock).books;
        const [from, to] = d1 <= d2 ? [d1, d2] : [d2, d1];

        const cf = cashFlow(books, { from, to });
        const bank = (asOf: string) =>
          balanceSheet(books, asOf).assets.groups.find((g) => g.id === "current_assets")?.groups.find((g) => g.id === "bank")?.total[0] ?? 0n;
        expect(cf.netChange[0]).toBe(cf.cashAtEnd[0]! - cf.cashAtStart[0]!);
        expect(cf.cashAtEnd[0]).toBe(bank(to));
        expect(cf.cashAtStart[0]).toBe(bank(dayBefore(from)));
        expect(cf.netIncome[0]).toBe(profitAndLoss(books, { from, to }).netIncome[0]);
        expect(cf.operating.total[0]).toBe(cf.netIncome[0]! + (cf.operating.groups[0]?.total[0] ?? 0n));
        expect(cf.netChange[0]).toBe(cf.operating.total[0]! + cf.investing.total[0]! + cf.financing.total[0]!);
      }),
      { numRuns: 300 },
    );
  });
});

function dayBefore(d: string): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day - 1)).toISOString().slice(0, 10);
}
