"use client";

// Payroll tax (a summary; payments are recorded in Payroll) and 1099s:
// vendors flagged for a 1099 with what bill payments paid them in a year.

import { useMemo, useState } from "react";
import Link from "next/link";
import { balanceOf, systemAccount } from "@pnw/ledger";
import { liabilitiesByQuarter } from "@pnw/payroll";
import { paidToVendor } from "@pnw/sales";
import { buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, todayIso } from "@/books/display";

export function PayrollTaxTab() {
  const { books, payroll } = useOpenBooks();
  const owed = -balanceOf(books, systemAccount(books, "payroll_liabilities").id);
  const quarters = useMemo(() => liabilitiesByQuarter(payroll), [payroll]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Payroll taxes owed now</div>
          <div className="mt-1 text-2xl font-semibold">
            <Money cents={owed} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Federal withholding plus both halves of Social Security and Medicare.</p>
        </div>
        <Link href="/payroll?tab=owed" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 sm:min-h-9")}>
          Withholding owed in Payroll
        </Link>
      </div>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {quarters.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No payroll yet.</li>}
        {quarters.map((q) => (
          <li key={q.quarter} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              {q.quarter.replace("-", " ")}
              <span className="block text-xs text-muted-foreground">Form 941 liability</span>
            </span>
            <Money cents={q.total} className="font-medium" />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Record payments to the IRS from Payroll, Withholding owed; they clear what&apos;s owed here too.</p>
    </div>
  );
}

export function Form1099Tab() {
  const { sales } = useOpenBooks();
  const thisYear = Number(todayIso().slice(0, 4));
  const years = useMemo(() => {
    const seen = new Set([thisYear, ...sales.billPayments.map((p) => Number(p.date.slice(0, 4)))]);
    return [...seen].sort((a, b) => b - a);
  }, [sales, thisYear]);
  const [year, setYear] = useState(thisYear);
  const vendors = sales.vendors.filter((v) => v.tracks1099);
  const rows = vendors.map((v) => ({ vendor: v, paid: paidToVendor(sales, v.id, `${year}-01-01`, `${year}-12-31`) }));
  const total = rows.reduce((t, r) => t + r.paid, 0n);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <Field label="Year">
          <select className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {vendors.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No vendors are flagged for a 1099. Tick &ldquo;Track payments for a 1099&rdquo; on a vendor in Expenses, Vendors.
          </li>
        )}
        {rows.map(({ vendor, paid }) => (
          <li key={vendor.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className={cn(!vendor.active && "text-muted-foreground")}>
              {vendor.name}
              {vendor.email && <span className="block text-xs text-muted-foreground">{vendor.email}</span>}
            </span>
            <span className="text-right">
              <span className="block text-xs text-muted-foreground">Paid in {year}</span>
              <Money cents={paid} className="font-medium" />
            </span>
          </li>
        ))}
        {vendors.length > 0 && (
          <li className="flex items-center justify-between gap-3 bg-muted/60 px-4 py-3 text-sm font-semibold">
            <span>Total</span>
            <Money cents={total} />
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground">
        Counts bill payments dated in the year, less any you voided. Check the IRS filing threshold for the year before you file.
      </p>
    </div>
  );
}
