"use client";

// The invoice and estimate editor. Both have the same lines (income account,
// quantity, rate, taxable, optional project/class/location) and tax; an
// invoice has terms and a due date and posts when sent, an estimate has an
// expiry date and never posts.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { type Tags, baseOf } from "@pnw/ledger";
import {
  DEFAULT_ESTIMATE_DAYS,
  type Estimate,
  type Invoice,
  type InvoiceLine,
  TERMS,
  type TermsId,
  addDays,
  createEstimate,
  createInvoice,
  dueDateFor,
  formatRateBp,
  invoiceTotals,
  lineAmount,
  markEstimate,
  parseRateBp,
  sendInvoice,
  updateDraftInvoice,
  updateEstimate,
} from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { itemsOf } from "@/books/connections";
import { invoiceableAgreements } from "@/books/service";
import { projectForAgreement } from "@/books/agreement_projects";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { TagFields, pickedTags } from "@/books/tags";
import { PageHeader } from "@/shell/SectionView";
import { parseMoney, plainCents, tryMoney } from "./parts";

export type DocumentKind = "invoice" | "estimate";

type Row = { key: number; description: string; accountId: string; quantity: string; rate: string; taxable: boolean; tags: Tags };

const BACK = { href: "/sales", label: "Back to sales" };

/** For live totals while the user is typing: a half-typed value counts as the fallback. */
function quiet<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/** Reads `?edit=<id>` and opens that draft (or pending estimate), or a blank form. */
export function DocumentEditor({ kind }: { kind: DocumentKind }) {
  const editId = useSearchParams().get("edit");
  const { sales } = useOpenBooks();
  const existing =
    editId === null
      ? undefined
      : kind === "invoice"
        ? sales.invoices.find((i) => i.id === editId && i.state === "draft")
        : sales.estimates.find((e) => e.id === editId && (e.state === "draft" || e.state === "sent"));
  if (editId && !existing) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={kind === "invoice" ? "Edit invoice" : "Edit estimate"}
          summary={
            kind === "invoice"
              ? "Only drafts can be edited. A sent invoice is voided and issued again instead."
              : "Only draft and sent estimates can be edited."
          }
        />
        <Link href={BACK.href} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 self-start")}>
          {BACK.label}
        </Link>
      </div>
    );
  }
  return <DocumentForm key={existing?.id ?? "new"} kind={kind} existing={existing} />;
}

function DocumentForm({ kind, existing }: { kind: DocumentKind; existing?: Invoice | Estimate }) {
  const { books, sales, dimensions, clients, agreementProjects, updateCompany } = useOpenBooks();
  const router = useRouter();
  const invoice = kind === "invoice" ? (existing as Invoice | undefined) : undefined;
  const estimate = kind === "estimate" ? (existing as Estimate | undefined) : undefined;
  const customers = sales.customers.filter((c) => c.active || c.id === existing?.customerId);
  const defaultIncome = books.accounts.find((a) => a.active && baseOf(a) === "income")?.id ?? "";
  const nextKey = useRef(0);
  const blank = (): Row => ({ key: nextKey.current++, description: "", accountId: defaultIncome, quantity: "1", rate: "", taxable: false, tags: {} });

  const [customerId, setCustomerId] = useState(existing?.customerId ?? (customers.length === 1 ? customers[0]!.id : ""));
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [terms, setTerms] = useState<TermsId>(invoice?.terms ?? sales.customers.find((c) => c.id === customerId)?.terms ?? "net_30");
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [expiryDate, setExpiryDate] = useState(estimate?.expiryDate ?? "");
  const [taxRate, setTaxRate] = useState(existing ? formatRateBp(existing.taxRateBp) : "0");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [agreementId, setAgreementId] = useState(invoice?.agreementId ?? "");
  // The jobs agreed with this customer on the app, for an invoice to name (optional).
  const jobs = kind === "invoice" && customerId ? invoiceableAgreements(itemsOf(Object.values(clients ?? {}).find((c) => c.customerId === customerId))) : [];
  const [rows, setRows] = useState<Row[]>(() =>
    existing
      ? existing.lines.map((l) => ({
          key: nextKey.current++,
          description: l.description,
          accountId: l.accountId,
          quantity: l.quantity,
          rate: plainCents(l.unitPrice),
          taxable: !!l.taxable,
          tags: l.tags ?? {},
        }))
      : [blank()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The due (or expiry) date follows the date until the user sets it by hand.
  const due = dueDate || quiet(() => dueDateFor(date, terms), "");
  const expiry = expiryDate || quiet(() => addDays(date, DEFAULT_ESTIMATE_DAYS), "");

  const safeAmount = (r: Row) => quiet(() => lineAmount({ quantity: r.quantity, unitPrice: tryMoney(r.rate) }), 0n);
  const totals = invoiceTotals({
    taxRateBp: quiet(() => parseRateBp(taxRate), 0),
    lines: rows.map((r) => ({ description: "", accountId: "", quantity: "1", unitPrice: safeAmount(r), taxable: r.taxable })),
  });

  const setRow = (key: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function lines(): InvoiceLine[] {
    return rows.map((r, i) => {
      const tags = pickedTags(r.tags);
      return {
        description: r.description,
        accountId: r.accountId,
        quantity: r.quantity,
        unitPrice: parseMoney(r.rate, `Line ${i + 1} rate`),
        ...(r.taxable ? { taxable: true } : {}),
        ...(tags ? { tags } : {}),
      };
    });
  }

  async function save(andSend: boolean) {
    setError(null);
    setBusy(true);
    try {
      const common = { customerId, date, taxRateBp: parseRateBp(taxRate), lines: lines(), ...(memo.trim() ? { memo } : {}) };
      if (kind === "invoice") {
        const data = { ...common, dueDate: due, terms, ...(agreementId && jobs.some((j) => j.terms.id === agreementId) ? { agreementId } : {}) };
        await updateCompany((c) => {
          let id = invoice?.id;
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
      } else {
        const data = { ...common, expiryDate: expiry };
        await updateCompany((c) => {
          let id = estimate?.id;
          let next = c.sales;
          if (id) next = updateEstimate(c.books, next, id, data);
          else {
            const r = createEstimate(c.books, next, data);
            next = r.sales;
            id = r.estimate.id;
          }
          const state = next.estimates.find((e) => e.id === id)?.state;
          if (andSend && state !== "sent") next = markEstimate(next, id, "sent");
          return { ...c, sales: next };
        });
      }
      router.push(kind === "invoice" ? "/sales" : "/sales?tab=estimates");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const noun = kind === "invoice" ? "invoice" : "estimate";
  if (customers.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={`New ${noun}`} summary={`Add a customer first, then come back to ${kind === "invoice" ? "bill" : "quote"} them.`} />
        <Link href={BACK.href} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 self-start")}>
          {BACK.label}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={existing ? `Edit ${existing.number}` : `New ${noun}`}
        summary={
          kind === "invoice"
            ? "Saved as a draft, nothing posts. Sending it records the sale in your books and starts the clock on payment."
            : "A quote for work not yet done. Estimates never touch your books; convert an accepted one into an invoice."
        }
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
                setAgreementId("");
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
          {jobs.length > 0 && (
            <Field label="For agreement" hint="Optional: the job this invoice is for.">
              <select
                className={inputClass}
                value={agreementId}
                onChange={(e) => {
                  setAgreementId(e.target.value);
                  // The job's project goes on every line that has none yet, so its income follows the job.
                  const project = e.target.value ? projectForAgreement({ agreementProjects: agreementProjects ?? undefined, dimensions }, e.target.value) : undefined;
                  if (project) setRows((rs) => rs.map((r) => (r.tags.project ? r : { ...r, tags: { ...r.tags, project } })));
                }}
              >
                <option value="">No agreement</option>
                {jobs.map((j) => (
                  <option key={j.terms.id} value={j.terms.id}>
                    {j.terms.title}
                    {j.status === "complete" ? " (complete)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={kind === "invoice" ? "Invoice date" : "Estimate date"}>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          {kind === "invoice" ? (
            <>
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
            </>
          ) : (
            <Field label="Expires" hint={`Defaults to ${DEFAULT_ESTIMATE_DAYS} days after the date.`}>
              <input type="date" className={inputClass} value={expiry} onChange={(e) => setExpiryDate(e.target.value)} required />
            </Field>
          )}
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
            <div key={r.key} className="flex flex-col gap-3 rounded-lg border bg-card p-4 lg:py-2">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_13rem_5rem_7rem_4.5rem_7rem_2.75rem] lg:items-center">
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
                    aria-label={`Line ${i + 1} taxable`}
                    onChange={(e) => setRow(r.key, { taxable: e.target.checked })}
                    className="size-4 accent-[var(--hewn-green)]"
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
              <TagFields dims={dimensions} value={r.tags} onChange={(tags) => setRow(r.key, { tags })} labelPrefix={`Line ${i + 1}`} />
            </div>
          ))}
          <Button type="button" variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setRows((rs) => [...rs, blank()])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </section>

        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <Field label="Memo" hint={`Optional. Kept in your books with the ${noun}.`}>
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
            <Link href={kind === "invoice" ? "/sales" : "/sales?tab=estimates"} className={cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 sm:flex-none")}>
              Cancel
            </Link>
            {estimate?.state !== "sent" && (
              <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" disabled={busy || !customerId} onClick={() => save(false)}>
                Save as draft
              </Button>
            )}
            <Button type="submit" className="h-11 basis-full sm:basis-auto" disabled={busy || !customerId || totals.total <= 0n}>
              {busy ? "Saving…" : kind === "invoice" ? "Save and send" : estimate?.state === "sent" ? "Save changes" : "Save and mark sent"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
