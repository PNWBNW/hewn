// Turns a statement into the lines a reader sees: headings, account rows,
// subtotals and totals. The screen and the CSV download both draw from these
// lines, so what you download is exactly what you saw.

import {
  type Account,
  type Amounts,
  type BalanceSheet,
  type ProfitAndLoss,
  type StatementRow,
  type StatementSection,
  type TrialBalance,
  formatCents,
} from "@pnw/ledger";

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
  return `${rows.join("\r\n")}\r\n`;
}
