"use client";

// Sales tax: charged on invoices, paid to the agency, and what's owed. The
// report adds down to Sales Tax Payable at the end of the range, and the
// screen says so when it ties. Recording a payment posts Dr Sales Tax
// Payable, Cr bank.

import { useMemo, useState } from "react";
import { balanceOf, formatCents, parseCents, systemAccount } from "@pnw/ledger";
import { recordSalesTaxPayment, salesTaxOwed, salesTaxReport } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { formatDate } from "../reports/dates";
import { salesTaxLines } from "../reports/lines";
import { RangeFields, useRange } from "../reports/RangeFields";
import { Statement } from "../reports/Statement";

export function SalesTaxTab() {
  const { books, sales, update } = useOpenBooks();
  const range = useRange(books.settings.fiscalYearStartMonth, "this_quarter");
  const owedNow = salesTaxOwed(books);
  const [paying, setPaying] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState(books.accounts.find((a) => a.type === "bank" && a.active)?.id ?? "");
  const [agency, setAgency] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const report = useMemo(
    () => (range.valid ? salesTaxReport(books, sales, range.range.from, range.range.to) : null),
    [books, sales, range.range, range.valid],
  );
  // Sales Tax Payable on the end date, straight from the account: the report must land on it.
  const ledgerOwed = useMemo(() => {
    if (!report) return 0n;
    const through = { ...books, entries: books.entries.filter((e) => e.date <= report.to) };
    return -balanceOf(through, systemAccount(books, "sales_tax_payable").id);
  }, [books, report]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sales tax owed now</div>
          <div className="mt-1 text-2xl font-semibold">
            <Money cents={owedNow} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Charged on sent invoices and not yet paid to your state or local agency.</p>
        </div>
        {!paying && (
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              setAmount(owedNow > 0n ? formatCents(owedNow).replace(/,/g, "") : "");
              setPaying(true);
            }}
          >
            Record a sales tax payment
          </Button>
        )}
      </div>

      {paying && (
        <form
          className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const cents = parseCents(amount);
              await update((b) => recordSalesTaxPayment(b, { date, amount: cents, bankAccountId: bank, agency, reference }).books);
              setPaying(false);
              setReference("");
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <Field label="Paid on">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Amount">
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="From">
            <AccountSelect books={books} value={bank} onChange={setBank} filter={(a) => a.type === "bank" && a.active} className={inputClass} />
          </Field>
          <Field label="Agency" hint="Optional, like your state's revenue department.">
            <input className={inputClass} value={agency} onChange={(e) => setAgency(e.target.value)} />
          </Field>
          <Field label="Reference" hint="Optional confirmation number.">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-3">
            <FormError message={error} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => setPaying(false)}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 flex-1 sm:flex-none">
                Record payment
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <RangeFields state={range} />
      </div>
      {!report && <FormError message="Choose a start date on or before the end date." />}
      {report && (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4">
            <Figure label="Invoices" value={String(report.invoices.length)} />
            <Figure label="Taxable sales" cents={report.taxableSales} />
            <Figure label="Tax collected" cents={report.collected - report.voided} />
            <Figure label="Paid to the agency" cents={report.paid} />
          </dl>
          <Statement
            businessName={books.settings.businessName}
            report={{
              title: "Sales tax liability",
              subtitle: `${formatDate(report.from)} – ${formatDate(report.to)}`,
              columns: ["Amount"],
              lines: salesTaxLines(report, new Map(sales.customers.map((c) => [c.id, c.name]))),
              note:
                report.owed === ledgerOwed
                  ? `Ties: owed at the end equals Sales Tax Payable on ${formatDate(report.to)} (${formatCents(ledgerOwed)}).`
                  : `Doesn't tie: Sales Tax Payable on ${formatDate(report.to)} is ${formatCents(ledgerOwed)}.`,
            }}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        This app computes and tracks sales tax; you file the return with your agency. The rate is set per invoice.
      </p>
    </div>
  );
}

function Figure({ label, cents, value }: { label: string; cents?: bigint; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{cents !== undefined ? <Money cents={cents} /> : value}</dd>
    </div>
  );
}
