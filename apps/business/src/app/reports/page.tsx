"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { type DateRange, assertDate, balanceSheet, profitAndLoss, trialBalance } from "@pnw/ledger";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, orderedAccounts, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";
import { type Comparison, type Preset, PRESETS, compareDate, compareRange, formatDate, presetRange, rangeLabel } from "./dates";
import {
  type ReportLine,
  type Report,
  balanceSheetLines,
  isEmptyReport,
  profitAndLossLines,
  reportCsv,
  trialBalanceLines,
} from "./lines";

type ReportId = "profit_and_loss" | "balance_sheet" | "trial_balance";

const REPORTS: { id: ReportId; label: string; file: string }[] = [
  { id: "profit_and_loss", label: "Profit and loss", file: "profit-and-loss" },
  { id: "balance_sheet", label: "Balance sheet", file: "balance-sheet" },
  { id: "trial_balance", label: "Trial balance", file: "trial-balance" },
];

const isDate = (d: string) => {
  try {
    assertDate(d);
    return true;
  } catch {
    return false;
  }
};

export default function ReportsPage() {
  const { books } = useOpenBooks();
  const today = todayIso();
  const fiscalStart = books.settings.fiscalYearStartMonth;
  const [reportId, setReportId] = useState<ReportId>("profit_and_loss");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [custom, setCustom] = useState<DateRange>(() => presetRange("this_month", today, fiscalStart));
  const [asOf, setAsOf] = useState(today);
  const [comparison, setComparison] = useState<Comparison>("none");

  const range = useMemo(
    () => (preset === "custom" ? custom : presetRange(preset, today, fiscalStart)),
    [preset, custom, today, fiscalStart],
  );

  // The shown report, or why it can't be shown yet.
  const built = useMemo((): Report | string => {
    if (reportId === "profit_and_loss") {
      if (!isDate(range.from) || !isDate(range.to)) return "Choose a start and end date.";
      if (range.from > range.to) return "The end date is before the start date.";
      const other = compareRange(range, comparison);
      const pl = profitAndLoss(books, range, other);
      return {
        title: "Profit and loss",
        subtitle: `${formatDate(range.from)} – ${formatDate(range.to)}`,
        columns: pl.columns.map(rangeLabel),
        lines: profitAndLossLines(pl),
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
  }, [books, reportId, range, asOf, comparison]);

  function download() {
    if (typeof built === "string") return;
    // A byte-order mark so spreadsheet apps read the dashes and names as UTF-8.
    const blob = new Blob(["﻿", reportCsv(built, books.settings.businessName)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = books.settings.businessName.replace(/[^\w-]+/g, "-").toLowerCase();
    const date = reportId === "profit_and_loss" ? `${range.from}-to-${range.to}` : asOf;
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
        {reportId === "profit_and_loss" ? (
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
        {reportId !== "trial_balance" && (
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

// ---- Statement ---------------------------------------------------------------

// Literal class names so Tailwind sees them: one step per level of nesting.
const INDENT = ["pl-4", "pl-7", "pl-10", "pl-13", "pl-16", "pl-19", "pl-22", "pl-25", "pl-28"];

const ROW_STYLE: Record<ReportLine["kind"], string> = {
  heading: "font-medium",
  account: "",
  subtotal: "border-t font-medium",
  total: "border-t font-semibold",
  grand: "border-t-2 border-foreground/20 bg-muted/60 font-semibold",
};

function Statement({ report, businessName }: { report: Report; businessName: string }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label={report.title}>
      <header className="border-b px-4 py-3 text-center">
        <h2 className="text-base font-semibold">{report.title}</h2>
        <p className="text-sm text-muted-foreground">{businessName}</p>
        <p className="text-xs text-muted-foreground">{report.subtitle}</p>
      </header>
      {isEmptyReport(report) && (
        <p className="border-b px-4 py-3 text-center text-sm text-muted-foreground">Nothing posted for these dates.</p>
      )}
      {/* Wide comparisons scroll inside this frame, never the page. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-2 pl-4 text-left font-medium">
                Account
              </th>
              {report.columns.map((c, j) => (
                <th key={j} scope="col" className="py-2 pr-4 pl-2 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line, i) => (
              <tr
                key={i}
                className={cn(
                  ROW_STYLE[line.kind],
                  line.kind === "heading" && line.depth === 0 && "bg-muted text-xs tracking-wide text-muted-foreground uppercase",
                )}
              >
                <td className={cn("py-1.5 pr-2 break-words", INDENT[Math.min(line.depth, INDENT.length - 1)])}>{line.label}</td>
                {line.amounts
                  ? line.amounts.map((c, j) => (
                      <td key={j} className="py-1.5 pr-4 pl-2 text-right whitespace-nowrap">
                        <Money cents={c} blankZero={line.blankZero} />
                      </td>
                    ))
                  : report.columns.map((_, j) => <td key={j} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
