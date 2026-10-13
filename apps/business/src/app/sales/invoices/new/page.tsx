"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { baseOf } from "@pnw/ledger";
import {
  type Invoice,
  type InvoiceInput,
  TERMS,
  type TermsId,
  createInvoice,
  dueDateFor,
  formatRateBp,
  invoiceTotals,
  lineAmount,
  parseRateBp,
  sendInvoice,
  updateDraftInvoice,
} from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";
import { parseMoney, plainCents, tryMoney } from "../../parts";

type Row = { key: number; description: string; accountId: string; quantity: string; rate: string; taxable: boolean };

export default function NewInvoicePage() {
  return (
    <Suspense>
      <InvoiceEditor />
    </Suspense>
  );
}

function InvoiceEditor() {
  const editId = useSearchParams().get("edit");
  const { sales } = useOpenBooks();
  const draft = editId ? sales.invoices.find((i) => i.id === editId && i.state === "draft") : undefined;
  if (editId && !draft) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit invoice" summary="Only drafts can be edited. A sent invoice is voided and issued again instead." />
        <Link href="/sales" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 self-start")}>
          Back to sales
        </Link>
      </div>
    );
  }
  return <InvoiceForm key={draft?.id ?? "new"} draft={draft} />;
}

function InvoiceForm({ draft }: { draft?: Invoice }) {
  const { books, sales, updateCompany } = useOpenBooks();
  const router = useRouter();
  const customers = sales.customers.filter((c) => c.active || c.id === draft?.customerId);
  const defaultIncome = books.accounts.find((a) => a.active && baseOf(a) === "income")?.id ?? "";
  const nextKey = useRef(0);
  const blank = (): Row => ({ key: nextKey.current++, description: "", accountId: defaultIncome, quantity: "1", rate: "", taxable: false });

  const [customerId, setCustomerId] = useState(draft?.customerId ?? (customers.length === 1 ? customers[0]!.id : ""));
  const [date, setDate] = useState(draft?.date ?? todayIso());
  const [terms, setTerms] = useState<TermsId>(draft?.terms ?? sales.customers.find((c) => c.id === customerId)?.terms ?? "net_30");
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? "");
  const [taxRate, setTaxRate] = useState(draft ? formatRateBp(draft.taxRateBp) : "0");
  const [memo, setMemo] = useState(draft?.memo ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    draft
      ? draft.lines.map((l) => ({
          key: nextKey.current++,
          description: l.description,
          accountId: l.accountId,
          quantity: l.quantity,
          rate: plainCents(l.unitPrice),
          taxable: !!l.taxable,
        }))
      : [blank()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The due date follows the date and terms until the user sets it by hand.
  const autoDue = (() => {
    try {
      return dueDateFor(date, terms);
    } catch {
      return "";
    }
  })();
  const due = dueDate || autoDue;

  const safeAmount = (r: Row) => {
    try {
      return lineAmount({ quantity: r.quantity, unitPrice: tryMoney(r.rate) });
    } catch {
      return 0n;
    }
  };
  const bp = (() => {
    try {
      return parseRateBp(taxRate);
    } catch {
      return 0;
    }
  })();
  const totals = invoiceTotals({
    taxRateBp: bp,
    lines: rows.map((r) => ({ description: "", accountId: "", quantity: "1", unitPrice: safeAmount(r), taxable: r.taxable })),
  });

  const setRow = (key: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function input(): InvoiceInput {
    return {
      customerId,
      date,
      dueDate: due,
      terms,
      taxRateBp: parseRateBp(taxRate),
      ...(memo.trim() ? { memo } : {}),
      lines: rows.map((r, i) => ({
        description: r.description,
        accountId: r.accountId,
        quantity: r.quantity,
        unitPrice: parseMoney(r.rate, `Line ${i + 1} rate`),
        ...(r.taxable ? { taxable: true } : {}),
      })),
    };
  }

  async function save(andSend: boolean) {
    setError(null);
    setBusy(true);
    try {
      const data = input();
      await updateCompany((c) => {
        let id = draft?.id;
        let next = c.sales;
        if (id) next = updateDraftInvoice(c.books, next, id, data);
        else {
          const r = createInvoice(c.books, next, data);
          next = r.sales;
          id = r.invoice.id;
        }
        if (!andSend) return { ...c, sales: next };
        const sent = sendInvoice(c.books, next, id);
        return { ...c, books: sent.books, sales: sent.sales };
      });
      router.push("/sales");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (customers.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New invoice" summary="Add a customer first, then come back to bill them." />
        <Link href="/sales" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 self-start")}>
          Back to sales
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={draft ? `Edit ${draft.number}` : "New invoice"}
        summary="Saved as a draft, nothing posts. Sending it records the sale in your books and starts the clock on payment."
      />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer">
            <select
              className={inputClass}
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                const t = sales.customers.find((c) => c.id === e.target.value)?.terms;
                if (t) setTerms(t);
              }}
              required
            >
              <option value="">Choose a customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invoice date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Terms">
            <select
              className={inputClass}
              value={terms}
              onChange={(e) => {
                setTerms(e.target.value as TermsId);
                setDueDate("");
              }}
            >
              {TERMS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className={inputClass} value={due} onChange={(e) => setDueDate(e.target.value)} required />
          </Field>
        </div>

        <section aria-label="Lines" className="flex flex-col gap-3">
          <div className="hidden gap-3 px-4 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[1fr_13rem_5rem_7rem_4.5rem_7rem_2.75rem]">
            <span>Description</span>
            <span>Income account</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Rate</span>
            <span className="text-center">Taxable</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 lg:grid-cols-[1fr_13rem_5rem_7rem_4.5rem_7rem_2.75rem] lg:items-center lg:py-2"
            >
              <input
                className={cn(inputClass, "col-span-2 lg:col-span-1")}
                placeholder="Description"
                aria-label={`Line ${i + 1} description`}
                value={r.description}
                onChange={(e) => setRow(r.key, { description: e.target.value })}
              />
              <AccountSelect
                books={books}
                value={r.accountId}
                onChange={(id) => setRow(r.key, { accountId: id })}
                filter={(a) => a.active && baseOf(a) === "income"}
                className={cn(inputClass, "col-span-2 lg:col-span-1")}
                placeholder="Income account"
                ariaLabel={`Line ${i + 1} income account`}
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground lg:hidden">Quantity</span>
                <input
                  className={cn(inputClass, "text-right")}
                  inputMode="decimal"
                  aria-label={`Line ${i + 1} quantity`}
                  placeholder="Qty"
                  value={r.quantity}
                  onChange={(e) => setRow(r.key, { quantity: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground lg:hidden">Rate</span>
                <input
                  className={cn(inputClass, "text-right")}
                  inputMode="decimal"
                  aria-label={`Line ${i + 1} rate`}
                  placeholder="Rate"
                  value={r.rate}
                  onChange={(e) => setRow(r.key, { rate: e.target.value })}
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm lg:justify-center">
                <input
                  type="checkbox"
                  checked={r.taxable}
                  onChange={(e) => setRow(r.key, { taxable: e.target.checked })}
                  className="size-4 accent-[var(--plumb-green)]"
                />
                <span className="lg:sr-only">Taxable</span>
              </label>
              <div className="flex min-h-11 items-center justify-end text-sm font-medium">
                <Money cents={safeAmount(r)} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-2 min-h-11 justify-self-end text-muted-foreground lg:col-span-1 lg:min-h-9"
                aria-label={`Remove line ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 aria-hidden />
                <span className="lg:sr-only">Remove</span>
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setRows((rs) => [...rs, blank()])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </section>

        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <Field label="Memo" hint="Optional. Kept in your books with the invoice.">
            <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
          <Field label="Sales tax rate (%)" hint="Applied to taxable lines.">
            <input className={inputClass} inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
        </div>

        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-card/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-lg sm:border">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Subtotal</dt>
              <dd><Money cents={totals.subtotal} /></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tax</dt>
              <dd><Money cents={totals.tax} /></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="font-semibold"><Money cents={totals.total} /></dd>
            </div>
          </dl>
          <FormError message={error} />
          <div className="flex flex-wrap gap-3">
            <Link href="/sales" className={cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 sm:flex-none")}>
              Cancel
            </Link>
            <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" disabled={busy || !customerId} onClick={() => save(false)}>
              Save as draft
            </Button>
            <Button type="submit" className="h-11 basis-full sm:basis-auto" disabled={busy || !customerId || totals.total <= 0n}>
              {busy ? "Saving…" : "Save and send"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
