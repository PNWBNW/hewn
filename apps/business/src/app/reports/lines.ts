// Turns a statement into the lines a reader sees: headings, account rows,
// subtotals and totals. The screen and the CSV download both draw from these
// lines, so what you download is exactly what you saw.

import {
  type Account,
  type Amounts,
  type BalanceSheet,
  type CashFlow,
  type ProfitAndLoss,
  type StatementRow,
  type StatementSection,
  type TagProfit,
  type TrialBalance,
  formatCents,
} from "@pnw/ledger";
import type { SalesTaxReport } from "@pnw/sales";

export type LineKind = "heading" | "account" | "subtotal" | "total" | "grand";

export type ReportLine = {
  kind: LineKind;
  label: string;
  depth: number;
  /** Null on a heading. */
  amounts: Amounts | null;
  /** Show zero as blank (a parent's own amount, a trial balance column). */
  blankZero?: boolean;
};

export type Report = {
  title: string;
  /** "As of …" or the date range. */
  subtitle: string;
  columns: string[];
  lines: ReportLine[];
  /** A sentence under the figures (a margin, a tie-out), also written into the CSV. */
  note?: string;
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const hasRows = (s: StatementSection) => s.rows.length > 0 || s.groups.length > 0;
const anyNonZero = (a: Amounts) => a.some((v) => v !== 0n);

function accountLines(rows: StatementRow[], depth: number): ReportLine[] {
  return rows.flatMap((r): ReportLine[] => {
    const label = r.number ? `${r.number} ${r.name}` : r.name;
    if (r.children.length === 0) return [{ kind: "account", label, depth, amounts: r.total }];
    return [
      { kind: "account", label, depth, amounts: r.own, blankZero: true },
      ...accountLines(r.children, depth + 1),
      { kind: "subtotal", label: `Total ${label}`, depth, amounts: r.total },
    ];
  });
}

/** A section: heading, its groups and rows one level in, then its total. */
function sectionLines(s: StatementSection, depth: number, kind: "total" | "subtotal" = "total"): ReportLine[] {
  return [
    { kind: "heading", label: s.label, depth, amounts: null },
    ...s.groups.flatMap((g) => sectionLines(g, depth + 1, "subtotal")),
    ...accountLines(s.rows, depth + 1),
    { kind, label: `Total ${lowerFirst(s.label)}`, depth, amounts: s.total },
  ];
}

export function profitAndLossLines(pl: ProfitAndLoss): ReportLine[] {
  const lines = sectionLines(pl.income, 0);
  if (hasRows(pl.costOfGoodsSold)) {
    lines.push(...sectionLines(pl.costOfGoodsSold, 0), { kind: "grand", label: "Gross profit", depth: 0, amounts: pl.grossProfit });
  }
  lines.push(...sectionLines(pl.expenses, 0));
  const other = hasRows(pl.otherIncome) || hasRows(pl.otherExpenses);
  if (other) {
    lines.push({ kind: "grand", label: "Net operating income", depth: 0, amounts: pl.netOperatingIncome });
    if (hasRows(pl.otherIncome)) lines.push(...sectionLines(pl.otherIncome, 0));
    if (hasRows(pl.otherExpenses)) lines.push(...sectionLines(pl.otherExpenses, 0));
    lines.push({ kind: "grand", label: "Net other income", depth: 0, amounts: pl.netOtherIncome });
  }
  lines.push({ kind: "grand", label: "Net income", depth: 0, amounts: pl.netIncome });
  return lines;
}

export function balanceSheetLines(bs: BalanceSheet): ReportLine[] {
  return [
    ...sectionLines(bs.assets, 0).map((l, i, all) => (i === all.length - 1 ? { ...l, kind: "grand" as const } : l)),
    ...sectionLines(bs.liabilities, 0),
    ...sectionLines(bs.equity, 0),
    { kind: "grand", label: "Total liabilities and equity", depth: 0, amounts: bs.liabilitiesAndEquity },
  ];
}

/** Cash flow, indirect method: net income and its adjustments, then investing and financing, down to the cash on hand. */
export function cashFlowLines(cf: CashFlow): ReportLine[] {
  const lines: ReportLine[] = [
    { kind: "heading", label: cf.operating.label, depth: 0, amounts: null },
    { kind: "account", label: "Net income", depth: 1, amounts: cf.netIncome },
  ];
  for (const g of cf.operating.groups) {
    lines.push(
      { kind: "heading", label: g.label, depth: 1, amounts: null },
      ...accountLines(g.rows, 2),
      { kind: "subtotal", label: "Total adjustments", depth: 1, amounts: g.total },
    );
  }
  lines.push({ kind: "total", label: `Net cash from ${lowerFirst(cf.operating.label)}`, depth: 0, amounts: cf.operating.total });
  for (const s of [cf.investing, cf.financing]) {
    if (!hasRows(s)) continue;
    lines.push(
      { kind: "heading", label: s.label, depth: 0, amounts: null },
      ...accountLines(s.rows, 1),
      { kind: "total", label: `Net cash from ${lowerFirst(s.label)}`, depth: 0, amounts: s.total },
    );
  }
  lines.push(
    { kind: "grand", label: "Net change in cash", depth: 0, amounts: cf.netChange },
    { kind: "account", label: "Cash at start of period", depth: 0, amounts: cf.cashAtStart },
    { kind: "grand", label: "Cash at end of period", depth: 0, amounts: cf.cashAtEnd },
  );
  return lines;
}

/** Trial balance, debit and credit columns, with accounts in the order given (chart order). */
export function trialBalanceLines(chartOrder: Account[], tb: TrialBalance): ReportLine[] {
  const byId = new Map(tb.rows.map((r) => [r.accountId, r]));
  const lines: ReportLine[] = chartOrder
    .filter((account) => byId.has(account.id))
    .map((account) => {
      const r = byId.get(account.id)!;
      return {
        kind: "account",
        label: account.number ? `${account.number} ${account.name}` : account.name,
        depth: 0,
        amounts: [r.debit, r.credit],
        blankZero: true,
      };
    });
  lines.push({ kind: "grand", label: "Total", depth: 0, amounts: [tb.totalDebit, tb.totalCredit] });
  return lines;
}

/** "37.6%" from basis points; "n/a" without income. */
export function formatMargin(bp: number | null): string {
  if (bp === null) return "n/a";
  const sign = bp < 0 ? "-" : "";
  const abs = Math.abs(bp);
  // Tenths of a percent, half up, in integers.
  const tenths = Math.floor((abs + 5) / 10);
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** One line per project: income, costs (job costs plus expenses, labour included), profit; then the total. */
export function projectSummaryLines(summary: { rows: TagProfit[]; total: TagProfit }, names: Map<string, string>): ReportLine[] {
  const amounts = (r: TagProfit) => [r.income, r.costOfGoodsSold + r.expenses, r.profit];
  return [
    ...summary.rows.map((r): ReportLine => ({
      kind: "account",
      label: `${names.get(r.tagId) ?? r.tagId} · ${formatMargin(r.marginBp)} margin`,
      depth: 0,
      amounts: amounts(r),
    })),
    { kind: "grand", label: `All projects · ${formatMargin(summary.total.marginBp)} margin`, depth: 0, amounts: amounts(summary.total) },
  ];
}

/**
 * The sales tax liability as a statement: owed at the start, tax on each
 * invoice, voids, payments, adjustments, and owed at the end. The lines add
 * up top to bottom, so the last line is Sales Tax Payable on the end date.
 */
export function salesTaxLines(r: SalesTaxReport, customers: Map<string, string>): ReportLine[] {
  const lines: ReportLine[] = [
    { kind: "account", label: "Owed at the start", depth: 0, amounts: [r.opening] },
    { kind: "heading", label: "Tax on invoices", depth: 0, amounts: null },
    ...r.invoices.map((i): ReportLine => ({
      kind: "account",
      label: `${i.number} · ${customers.get(i.customerId) ?? i.customerId} · ${i.date}${i.void ? " (void)" : ""}`,
      depth: 1,
      amounts: [i.tax],
    })),
    { kind: "subtotal", label: "Tax collected", depth: 0, amounts: [r.collected] },
  ];
  if (r.voided !== 0n) lines.push({ kind: "account", label: "Less voided invoices", depth: 0, amounts: [-r.voided] });
  lines.push({ kind: "heading", label: "Payments to the agency", depth: 0, amounts: null });
  for (const p of r.payments) lines.push({ kind: "account", label: `${p.date} · ${p.memo ?? "Payment"}`, depth: 1, amounts: [-p.amount] });
  lines.push({ kind: "subtotal", label: "Total paid", depth: 0, amounts: [-r.paid] });
  if (r.adjustments !== 0n) lines.push({ kind: "account", label: "Other adjustments (journal entries)", depth: 0, amounts: [r.adjustments] });
  lines.push({ kind: "grand", label: "Owed at the end", depth: 0, amounts: [r.owed] });
  return lines;
}

/** True when the report has nothing but zero totals to show. */
export function isEmptyReport(report: Report): boolean {
  return report.lines.every((l) => l.kind === "heading" || !l.amounts || !anyNonZero(l.amounts));
}

// ---- CSV ---------------------------------------------------------------------

/** Quotes a text cell, and defuses one a spreadsheet would run as a formula. */
function textCell(text: string): string {
  const safe = /^\s*[=+\-@]|^[\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) || safe !== text || /^\s/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Plain number for spreadsheets: no thousands separators. */
const amountCell = (c: bigint) => formatCents(c).replace(/,/g, "");

export function reportCsv(report: Report, businessName: string): string {
  const rows: string[] = [
    textCell(report.title),
    textCell(businessName),
    textCell(report.subtitle),
    "",
    ["Account", ...report.columns].map(textCell).join(","),
  ];
  for (const line of report.lines) {
    const label = textCell(`${"  ".repeat(line.depth)}${line.label}`);
    const amounts = line.amounts
      ? line.amounts.map((c) => (line.blankZero && c === 0n ? "" : amountCell(c)))
      : report.columns.map(() => "");
    rows.push([label, ...amounts].join(","));
  }
  if (report.note) rows.push("", textCell(report.note));
  return `${rows.join("\r\n")}\r\n`;
}
