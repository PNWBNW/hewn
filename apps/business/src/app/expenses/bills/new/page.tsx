"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { Tags } from "@pnw/ledger";
import { type AttachmentRef, TERMS, type TermsId, dueDateFor, enterBill, isBillAccount } from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { TagFields, pickedTags } from "@/books/tags";
import { PageHeader } from "@/shell/SectionView";
import { parseMoney, tryMoney } from "../../../sales/parts";
import { AttachButton, ReceiptList } from "../../Receipts";

type Row = { key: number; description: string; accountId: string; amount: string; tags: Tags };

export default function NewBillPage() {
  const { books, sales, dimensions, updateCompany, discardAttachment } = useOpenBooks();
  const router = useRouter();
  const vendors = sales.vendors.filter((v) => v.active);
  const nextKey = useRef(0);
  const blank = (): Row => ({ key: nextKey.current++, description: "", accountId: "", amount: "", tags: {} });

  const [vendorId, setVendorId] = useState(vendors.length === 1 ? vendors[0]!.id : "");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayIso());
  const [terms, setTerms] = useState<TermsId>(vendors.find((v) => v.id === vendorId)?.terms ?? "net_30");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blank()]);
  const [files, setFiles] = useState<AttachmentRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Files are sealed as soon as they're picked; if the bill is never saved, drop them again.
  const pending = useRef<AttachmentRef[]>([]);
  pending.current = files;
  const saved = useRef(false);
  useEffect(
    () => () => {
      if (!saved.current) for (const f of pending.current) void discardAttachment(f.attachmentId);
    },
    [discardAttachment],
  );

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
      const lines = rows.map((r, i) => {
        const tags = pickedTags(r.tags);
        return { description: r.description, accountId: r.accountId, amount: parseMoney(r.amount, `Line ${i + 1}`), ...(tags ? { tags } : {}) };
      });
      await updateCompany((c) => {
        const r = enterBill(c.books, c.sales, {
          vendorId,
          date,
          dueDate: due,
          terms,
          lines,
          ...(number.trim() ? { number } : {}),
          ...(memo.trim() ? { memo } : {}),
          ...(files.length ? { attachments: files } : {}),
        });
        return { ...c, books: r.books, sales: r.sales };
      });
      saved.current = true;
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
            <div key={r.key} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:py-2">
              <div className="grid grid-cols-[1fr_auto] gap-3 sm:grid-cols-[1fr_14rem_8rem_2.75rem] sm:items-center">
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
              <TagFields dims={dimensions} value={r.tags} onChange={(tags) => setRow(r.key, { tags })} labelPrefix={`Line ${i + 1}`} />
            </div>
          ))}
          <Button type="button" variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setRows((rs) => [...rs, blank()])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </section>

        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
          <Field label="Memo" hint="Optional.">
            <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Receipt</span>
            <ReceiptList
              refs={files}
              onRemove={(f) => {
                setFiles((fs) => fs.filter((x) => x.attachmentId !== f.attachmentId));
                void discardAttachment(f.attachmentId);
              }}
            />
            <AttachButton onAttached={(ref) => setFiles((fs) => [...fs, ref])} label={files.length ? "Attach another" : "Attach receipt"} />
            <span className="text-xs text-muted-foreground">A photo or PDF, up to 10 MB. Encrypted on this device with your books.</span>
          </div>
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
