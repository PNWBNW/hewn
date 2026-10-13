"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { type LineInput, accountMap, formatCents, parseCents, postEntry } from "@pnw/ledger";
import { Button, buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";

type Row = { key: number; accountId: string; debit: string; credit: string; memo: string; name: string };

let nextKey = 1;
const blankRow = (): Row => ({ key: nextKey++, accountId: "", debit: "", credit: "", memo: "", name: "" });

/** Typed amount → cents, or null while it's empty or not a valid amount yet. */
function cents(text: string): bigint | null {
  if (!text.trim()) return null;
  try {
    const v = parseCents(text);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export default function NewJournalEntryPage() {
  const { books, update } = useOpenBooks();
  const router = useRouter();
  const accounts = accountMap(books);
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const debits = rows.reduce((s, r) => s + (cents(r.debit) ?? 0n), 0n);
  const credits = rows.reduce((s, r) => s + (cents(r.credit) ?? 0n), 0n);
  const difference = debits - credits;
  const filled = rows.filter((r) => r.accountId && (cents(r.debit) || cents(r.credit)));
  const badAmount = rows.some((r) => (r.debit.trim() && !cents(r.debit)) || (r.credit.trim() && !cents(r.credit)));
  const ready = filled.length >= 2 && difference === 0n && debits > 0n && !badAmount;

  async function save() {
    setError(null);
    setBusy(true);
    const lines: LineInput[] = filled.map((r) => {
      const acct = accounts.get(r.accountId);
      const kind = acct?.type === "accounts_receivable" ? "customer" : acct?.type === "accounts_payable" ? "vendor" : undefined;
      return {
        accountId: r.accountId,
        ...(cents(r.debit) ? { debit: cents(r.debit)! } : { credit: cents(r.credit)! }),
        ...(r.memo.trim() ? { memo: r.memo.trim() } : {}),
        ...(kind && r.name.trim() ? { name: { kind, id: r.name.trim() } } : {}),
      };
    });
    try {
      await update((b) => postEntry(b, { date, ...(memo.trim() ? { memo: memo.trim() } : {}), lines }).books);
      router.push("/transactions");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New journal entry" summary="Debits on the left, credits on the right. They have to match." />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void save();
        }}
      >
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Memo" hint="Optional. What this entry is for.">
            <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <div className="hidden grid-cols-[1fr_8rem_8rem_2.75rem] gap-3 px-4 text-xs font-medium text-muted-foreground sm:grid">
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            <span />
          </div>
          {rows.map((row, i) => {
            const acct = accounts.get(row.accountId);
            const needsName = acct?.type === "accounts_receivable" ? "Customer" : acct?.type === "accounts_payable" ? "Vendor" : null;
            return (
              <fieldset key={row.key} className="rounded-lg border bg-card p-4">
                <legend className="sr-only">Line {i + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_2.75rem]">
                  <AccountSelect
                    books={books}
                    value={row.accountId}
                    onChange={(accountId) => set(row.key, { accountId })}
                    filter={(a) => a.active}
                    className={inputClass}
                  />
                  <div className="grid grid-cols-2 gap-3 sm:contents">
                    <input
                      className={cn(inputClass, "text-right")}
                      inputMode="decimal"
                      placeholder="Debit"
                      aria-label={`Line ${i + 1} debit`}
                      value={row.debit}
                      onChange={(e) => set(row.key, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })}
                    />
                    <input
                      className={cn(inputClass, "text-right")}
                      inputMode="decimal"
                      placeholder="Credit"
                      aria-label={`Line ${i + 1} credit`}
                      value={row.credit}
                      onChange={(e) => set(row.key, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="hidden size-11 sm:inline-flex sm:size-10"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={rows.length <= 2}
                    onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_16.75rem]">
                  <input
                    className={inputClass}
                    placeholder="Line description (optional)"
                    aria-label={`Line ${i + 1} description`}
                    value={row.memo}
                    onChange={(e) => set(row.key, { memo: e.target.value })}
                  />
                  {needsName && (
                    <input
                      className={inputClass}
                      placeholder={`${needsName} name (required)`}
                      aria-label={`Line ${i + 1} ${needsName.toLowerCase()}`}
                      value={row.name}
                      onChange={(e) => set(row.key, { name: e.target.value })}
                    />
                  )}
                </div>
                {rows.length > 2 && (
                  <button
                    type="button"
                    className="mt-3 text-xs text-muted-foreground underline underline-offset-4 sm:hidden"
                    onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  >
                    Remove this line
                  </button>
                )}
              </fieldset>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 self-start sm:min-h-9"
            onClick={() => setRows((rs) => [...rs, blankRow()])}
          >
            <Plus aria-hidden />
            Add a line
          </Button>
        </div>

        <div
          className={cn(
            "sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-card/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-lg sm:border",
          )}
        >
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Debits</dt>
              <dd className="font-medium tabular-nums">{formatCents(debits)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Credits</dt>
              <dd className="font-medium tabular-nums">{formatCents(credits)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Difference</dt>
              <dd className={cn("font-medium tabular-nums", difference !== 0n ? "text-money-negative" : "text-money-positive")}>
                {formatCents(difference < 0n ? -difference : difference)}
                {difference === 0n && debits > 0n ? " ✓" : ""}
              </dd>
            </div>
          </dl>
          {badAmount && <p className="text-xs text-destructive">Amounts need to be like 1250 or 1,250.00, at most two decimals.</p>}
          <FormError message={error} />
          <div className="flex gap-3">
            <Link href="/transactions" className={cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 sm:flex-none")}>
              Cancel
            </Link>
            <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={!ready || busy}>
              {busy ? "Saving…" : "Save entry"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
