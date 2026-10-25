"use client";

// One invoice laid out to print or save as a PDF, for a customer who isn't on
// the app (docs/CUSTOMERS.md, Step 1). The browser's own print does the rest:
// on a computer, Print or Save as PDF; on a phone's own browser, its print or
// share sheet (Save to Files, Messages, mail). An app's built-in browser, like
// Shield's, may not offer printing; there, send it to a customer on the app
// instead. Nothing leaves the device unless the person sends it.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Printer } from "lucide-react";
import { formatCents } from "@pnw/ledger";
import { TERMS, invoiceBalance, invoiceTotals, lineAmount } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { useOpenBooks } from "@/books/BooksProvider";
import { registeredFor } from "@/books/rail";
import { BRAND } from "@/brand";

export default function PrintInvoicePage() {
  return (
    <Suspense>
      <PrintInvoice />
    </Suspense>
  );
}

const dollars = (cents: bigint) => `$${formatCents(cents)}`;

function PrintInvoice() {
  const { books, sales, rail } = useOpenBooks();
  const id = useSearchParams().get("id");
  const invoice = sales.invoices.find((i) => i.id === id);
  if (!invoice || invoice.state === "draft") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{invoice ? "Send this invoice first; a draft isn't printed." : "That invoice isn't in your books."}</p>
        <Link href="/sales" className="text-sm underline underline-offset-4">
          Back to Sales
        </Link>
      </div>
    );
  }
  const customer = sales.customers.find((c) => c.id === invoice.customerId);
  const totals = invoiceTotals(invoice);
  const balance = invoiceBalance(sales, invoice);
  const paid = totals.total - balance;
  const terms = TERMS.find((t) => t.id === invoice.terms)?.label ?? "";
  const registered = customer ? registeredFor(rail, "customer", customer.id) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/sales" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium sm:min-h-9">
          <ChevronLeft aria-hidden className="size-4" /> Sales
        </Link>
        <Button className="ml-auto min-h-11 sm:min-h-9" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          Print or save as PDF
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          On a phone, use your phone&apos;s own browser: its print screen can save a PDF or share it. Shield&apos;s browser may not print; for a
          customer on {BRAND.name}, send the invoice to them from Sales instead.
        </p>
      </div>

      <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-lg border bg-white p-6 text-black sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{books.settings.businessName}</h1>
            {rail?.businessName && (
              <p className="text-sm text-neutral-600">
                {rail.businessName}.{BRAND.nameSuffix}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold">Invoice {invoice.number}</p>
            <p className="text-sm text-neutral-600">Dated {invoice.date}</p>
            <p className="text-sm text-neutral-600">
              Due {invoice.dueDate}
              {terms ? ` · ${terms}` : ""}
            </p>
            {invoice.state === "void" && <p className="text-sm font-semibold uppercase">Void</p>}
          </div>
        </header>

        <section>
          <p className="text-xs uppercase tracking-wide text-neutral-500">Bill to</p>
          <p className="font-medium">{customer?.name ?? "Customer"}</p>
          {registered && (
            <p className="text-sm text-neutral-600">
              {registered.name}.{BRAND.nameSuffix}
            </p>
          )}
          {customer?.email && <p className="text-sm text-neutral-600">{customer.email}</p>}
        </section>

        <table className="w-full text-sm">
          <thead className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 text-right font-medium">Price</th>
              <th className="py-2 pl-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {invoice.lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="py-2 pr-2">
                  {l.description || "—"}
                  {l.taxable && invoice.taxRateBp > 0 ? <span className="text-neutral-500"> · taxed</span> : null}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-2 py-2 text-right tabular-nums">{dollars(l.unitPrice)}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{dollars(lineAmount(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
          <dt className="text-neutral-600">Subtotal</dt>
          <dd className="text-right tabular-nums">{dollars(totals.subtotal)}</dd>
          {totals.tax > 0n && (
            <>
              <dt className="text-neutral-600">Tax ({(invoice.taxRateBp / 100).toFixed(2)}%)</dt>
              <dd className="text-right tabular-nums">{dollars(totals.tax)}</dd>
            </>
          )}
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{dollars(totals.total)}</dd>
          {paid > 0n && invoice.state === "sent" && (
            <>
              <dt className="text-neutral-600">Paid</dt>
              <dd className="text-right tabular-nums">−{dollars(paid)}</dd>
              <dt className="font-semibold">Balance due</dt>
              <dd className="text-right font-semibold tabular-nums">{dollars(balance)}</dd>
            </>
          )}
        </dl>

        {invoice.memo && <p className="whitespace-pre-wrap text-sm">{invoice.memo}</p>}
      </article>
    </div>
  );
}
