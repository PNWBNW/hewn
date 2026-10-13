"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { TERMS, type TermsId, dueDateFor, enterBill, isBillAccount } from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";
import { parseMoney, tryMoney } from "../../../sales/parts";

type Row = { key: number; description: string; accountId: string; amount: string };

export default function NewBillPage() {
  const { books, sales, updateCompany } = useOpenBooks();
  const router = useRouter();
  const vendors = sales.vendors.filter((v) => v.active);
  const nextKey = useRef(0);
  const blank = (): Row => ({ key: nextKey.current++, description: "", accountId: "", amount: "" });

  const [vendorId, setVendorId] = useState(vendors.length === 1 ? vendors[0]!.id : "");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayIso());
  const [terms, setTerms] = useState<TermsId>(vendors.find((v) => v.id === vendorId)?.terms ?? "net_30");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blank()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const autoDue = (() => {
    try {
      return dueDateFor(date, terms);
    } catch {
      return "";
    }
  })();
  const due = dueDate || autoDue;
  const total = rows.reduce((t, r) => t + tryMoney(r.amount), 0n);
  const setRow = (key: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const lines = rows.map((r, i) => ({ description: r.description, accountId: r.accountId, amount: parseMoney(r.amount, `Line ${i + 1}`) }));
      await updateCompany((c) => {
        const r = enterBill(c.books, c.sales, {
          vendorId,
          date,
          dueDate: due,
          terms,
          lines,
          ...(number.trim() ? { number } : {}),
          ...(memo.trim() ? { memo } : {}),
        });
        return { ...c, books: r.books, sales: r.sales };
      });
      router.push("/expenses");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (vendors.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New bill" summary="Add a vendor first, then enter their bill." />
        <Link href="/expenses" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 self-start")}>
          Back to expenses
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New bill" summary="Entering a bill records the expense and what you owe. Pay it later from Expenses." />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Vendor">
            <select
              className={inputClass}
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                const t = vendors.find((v) => v.id === e.target.value)?.terms;
                if (t) setTerms(t);
              }}
              required
            >
              <option value="">Choose a vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bill no." hint="Optional: the vendor's number.">
            <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field label="Bill date">
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
          <div className="hidden gap-3 px-4 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_14rem_8rem_2.75rem]">
            <span>Description</span>
            <span>Account</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_14rem_8rem_2.75rem] sm:items-center sm:py-2">
              <input
                className={cn(inputClass, "col-span-2 sm:col-span-1")}
                placeholder="Description"
                aria-label={`Line ${i + 1} description`}
                value={r.description}
                onChange={(e) => setRow(r.key, { description: e.target.value })}
              />
              <AccountSelect
                books={books}
                value={r.accountId}
                onChange={(id) => setRow(r.key, { accountId: id })}
                filter={(a) => a.active && isBillAccount(a)}
                className={cn(inputClass, "col-span-2 sm:col-span-1")}
                placeholder="Expense account"
                ariaLabel={`Line ${i + 1} account`}
              />
              <input
                className={cn(inputClass, "text-right")}
                inputMode="decimal"
                placeholder="Amount"
                aria-label={`Line ${i + 1} amount`}
                value={r.amount}
                onChange={(e) => setRow(r.key, { amount: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 text-muted-foreground sm:min-h-9"
                aria-label={`Remove line ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setRows((rs) => [...rs, blank()])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </section>

        <div className="rounded-lg border bg-card p-4">
          <Field label="Memo" hint="Optional.">
            <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </div>

        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-card/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-lg sm:border">
          <div className="text-sm">
            <span className="text-xs text-muted-foreground">Total </span>
            <Money cents={total} className="font-semibold" />
          </div>
          <FormError message={error} />
          <div className="flex gap-3">
            <Link href="/expenses" className={cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 sm:flex-none")}>
              Cancel
            </Link>
            <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !vendorId || total <= 0n}>
              {busy ? "Saving…" : "Save bill"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
