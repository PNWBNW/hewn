"use client";

// A statement on screen: section headings, indented sub-accounts, subtotals
// and bold totals, money in tabular right-aligned columns. Shared by Reports
// and the project screens.

import { cn } from "@pnw/ui/utils";
import { Money } from "@/books/display";
import { type Report, type ReportLine, isEmptyReport } from "./lines";

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

export function Statement({ report, businessName }: { report: Report; businessName: string }) {
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
      {report.note && <p className="border-t px-4 py-3 text-sm text-muted-foreground">{report.note}</p>}
    </section>
  );
}
