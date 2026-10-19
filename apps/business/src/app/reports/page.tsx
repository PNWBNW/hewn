"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import {
  type DateRange,
  assertDate,
  balanceSheet,
  cashFlow,
  formatCents,
  marginBp,
  profitAndLoss,
  profitAndLossForTag,
  profitByTag,
  trialBalance,
} from "@pnw/ledger";
import { salesTaxReport } from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { orderedAccounts, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";
import { type Comparison, type Preset, PRESETS, compareDate, compareRange, formatDate, presetRange, rangeLabel } from "./dates";
import {
  type Report,
  balanceSheetLines,
  cashFlowLines,
  formatMargin,
  profitAndLossLines,
  projectSummaryLines,
  reportCsv,
  salesTaxLines,
  trialBalanceLines,
} from "./lines";
import { Statement } from "./Statement";

type ReportId = "profit_and_loss" | "balance_sheet" | "cash_flow" | "trial_balance" | "project_profitability" | "sales_tax";

const REPORTS: { id: ReportId; label: string; file: string }[] = [
  { id: "profit_and_loss", label: "Profit and loss", file: "profit-and-loss" },
  { id: "balance_sheet", label: "Balance sheet", file: "balance-sheet" },
  { id: "cash_flow", label: "Cash flow", file: "cash-flow" },
  { id: "trial_balance", label: "Trial balance", file: "trial-balance" },
  { id: "project_profitability", label: "Project profitability", file: "project-profitability" },
  { id: "sales_tax", label: "Sales tax liability", file: "sales-tax-liability" },
];

/** Reports over a date range (the rest are "as of" a date). */
const RANGED: ReportId[] = ["profit_and_loss", "cash_flow", "project_profitability", "sales_tax"];

const isDate = (d: string) => {
  try {
    assertDate(d);
    return true;
  } catch {
    return false;
  }
};

export default function ReportsPage() {
  const { books, sales, dimensions } = useOpenBooks();
  const today = todayIso();
  const fiscalStart = books.settings.fiscalYearStartMonth;
  const [reportId, setReportId] = useState<ReportId>("profit_and_loss");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("this_month", today, fiscalStart));
  const [asOf, setAsOf] = useState(today);
  const [comparison, setComparison] = useState<Comparison>("none");
  /** "" = every project, side by side. */
  const [projectId, setProjectId] = useState("");

  const range = useMemo(
    () => (preset === "custom" ? custom : presetRange(preset, today, fiscalStart)),
    [preset, custom, today, fiscalStart],
  );

  // The shown report, or why it can't be shown yet.
  const built = useMemo((): Report | string => {
    if (RANGED.includes(reportId)) {
      if (!isDate(range.from) || !isDate(range.to)) return "Choose a start and end date.";
      if (range.from > range.to) return "The end date is before the start date.";
    }
    const subtitle = `${formatDate(range.from)} – ${formatDate(range.to)}`;
    if (reportId === "project_profitability") {
      const names = new Map(dimensions.projects.map((p) => [p.id, p.name]));
      if (!projectId) {
        const summary = profitByTag(books, "project", range, dimensions.projects.map((p) => p.id));
        return {
          title: "Project profitability",
          subtitle,
          columns: ["Income", "Costs", "Profit"],
          lines: projectSummaryLines(summary, names),
          note: "Costs are job costs plus expenses tagged to the project, including wages and employer payroll taxes.",
        };
      }
      const pl = profitAndLossForTag(books, "project", projectId, range, compareRange(range, comparison));
      const income = pl.income.total[0]! + pl.otherIncome.total[0]!;
      return {
        title: `Profit and loss: ${names.get(projectId) ?? projectId}`,
        subtitle,
        columns: pl.columns.map(rangeLabel),
        lines: profitAndLossLines(pl),
        note: `Margin ${formatMargin(marginBp(pl.netIncome[0]!, income))}. Only lines tagged with this project are counted.`,
      };
    }
    if (reportId === "sales_tax") {
      const r = salesTaxReport(books, sales, range.from, range.to);
      return {
        title: "Sales tax liability",
        subtitle,
        columns: ["Amount"],
        lines: salesTaxLines(r, new Map(sales.customers.map((c) => [c.id, c.name]))),
        note: `Taxable sales ${formatCents(r.taxableSales)} of ${formatCents(r.totalSales)} invoiced. Owed at the end is Sales Tax Payable on ${formatDate(range.to)}.`,
      };
    }
    if (reportId === "profit_and_loss") {
      const other = compareRange(range, comparison);
      const pl = profitAndLoss(books, range, other);
      return {
        title: "Profit and loss",
        subtitle,
        columns: pl.columns.map(rangeLabel),
        lines: profitAndLossLines(pl),
      };
    }
    if (reportId === "cash_flow") {
      const cf = cashFlow(books, range, compareRange(range, comparison));
      return {
        title: "Cash flow",
        subtitle,
        columns: cf.columns.map(rangeLabel),
        lines: cashFlowLines(cf),
        note: "Indirect method: net income, adjusted for the change in every other account over the period. Cash is the bank accounts.",
      };
    }
    if (!isDate(asOf)) return "Choose a date.";
    if (reportId === "balance_sheet") {
      const bs = balanceSheet(books, asOf, compareDate(asOf, comparison));
      return {
        title: "Balance sheet",
        subtitle: `As of ${formatDate(asOf)}`,
        columns: bs.columns.map(formatDate),
        lines: balanceSheetLines(bs),
      };
    }
    return {
      title: "Trial balance",
      subtitle: `As of ${formatDate(asOf)}`,
      columns: ["Debit", "Credit"],
      lines: trialBalanceLines(
        orderedAccounts(books).map(({ account }) => account),
        trialBalance(books, asOf),
      ),
    };
  }, [books, sales, dimensions, reportId, range, asOf, comparison, projectId]);

  function download() {
    if (typeof built === "string") return;
    // A byte-order mark so spreadsheet apps read the dashes and names as UTF-8.
    const blob = new Blob(["﻿", reportCsv(built, books.settings.businessName)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = books.settings.businessName.replace(/[^\w-]+/g, "-").toLowerCase();
    const date = RANGED.includes(reportId) ? `${range.from}-to-${range.to}` : asOf;
    a.href = url;
    a.download = `${name}-${REPORTS.find((r) => r.id === reportId)!.file}-${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (books.entries.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Reports" summary="Statements computed on this device from your books." />
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Nothing to report yet. Once your books have entries, your profit and loss, balance sheet and trial
            balance appear here.
          </p>
          <Link href="/transactions/new" className={cn(buttonVariants({ variant: "outline" }), "mt-4 min-h-11")}>
            New journal entry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        summary="Statements computed on this device from your books."
        action={
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={download} disabled={typeof built === "string"}>
            <Download aria-hidden />
            Download CSV
          </Button>
        }
      />
      <Tabs value={reportId} onValueChange={(v) => setReportId(v as ReportId)} className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {REPORTS.map((r) => (
              <TabsTrigger key={r.id} value={r.id} className="min-h-9 whitespace-nowrap">
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        {RANGED.includes(reportId) ? (
          <>
            <Field label="Dates">
              <select
                className={inputClass}
                value={preset}
                onChange={(e) => {
                  const next = e.target.value as Preset;
                  if (next === "custom") setCustom(range); // start from what's on screen
                  setPreset(next);
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            {preset === "custom" ? (
              <>
                <Field label="From">
                  <input type="date" className={inputClass} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
                </Field>
                <Field label="To">
                  <input type="date" className={inputClass} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
                </Field>
              </>
            ) : (
              <p className="self-end pb-2 text-sm text-muted-foreground sm:col-span-2">
                {formatDate(range.from)} – {formatDate(range.to)}
              </p>
            )}
          </>
        ) : (
          <Field label="As of">
            <input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        )}
        {reportId === "project_profitability" && (
          <Field label="Project">
            <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {dimensions.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.status === "closed" ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(reportId === "profit_and_loss" || reportId === "balance_sheet" || (reportId === "project_profitability" && projectId)) && (
          <Field label="Compare to">
            <select className={inputClass} value={comparison} onChange={(e) => setComparison(e.target.value as Comparison)}>
              <option value="none">No comparison</option>
              <option value="previous_period">{reportId === "balance_sheet" ? "End of previous month" : "Previous period"}</option>
              <option value="previous_year">{reportId === "balance_sheet" ? "Same date last year" : "Same period last year"}</option>
            </select>
          </Field>
        )}
      </div>

      {typeof built === "string" ? <FormError message={built} /> : <Statement report={built} businessName={books.settings.businessName} />}
    </div>
  );
}
