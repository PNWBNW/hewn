"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  type AccountType,
  type Books,
  type Entry,
  ACCOUNT_TYPES,
  accountMap,
  addAccount,
  baseOf,
  deactivateAccount,
  netByAccount,
  normalSide,
  reverseEntry,
  reversalOf,
} from "@pnw/ledger";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import {
  AccountSelect,
  BASE_LABELS,
  BASE_ORDER,
  Money,
  accountLabel,
  orderedAccounts,
  todayIso,
  typeLabel,
} from "@/books/display";
import { PageHeader } from "@/shell/SectionView";

const SOURCE_LABELS: Record<Entry["source"]["kind"], string> = {
  manual: "Journal entry",
  opening_balance: "Opening balance",
  invoice: "Invoice",
  payment: "Payment",
  deposit: "Deposit",
  bill: "Bill",
  bill_payment: "Bill payment",
  expense: "Expense",
  payroll: "Payroll",
  reversal: "Reversal",
};

export default function TransactionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        summary="Every entry in your books, with the accounts it touched."
        action={
          <Link href="/transactions/new" className={cn(buttonVariants(), "min-h-11 sm:min-h-9")}>
            <Plus aria-hidden />
            New journal entry
          </Link>
        }
      />
      <Tabs defaultValue="register" className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="register" className="min-h-9">All entries</TabsTrigger>
            <TabsTrigger value="accounts" className="min-h-9">Chart of accounts</TabsTrigger>
            <TabsTrigger value="bank" className="min-h-9">Bank activity</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="register">
          <Journal />
        </TabsContent>
        <TabsContent value="accounts">
          <ChartOfAccounts />
        </TabsContent>
        <TabsContent value="bank">
          <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
            Import a bank statement (CSV or OFX) and each line will be matched to an entry in your books.
            <span className="mt-1 block text-xs">Arrives in phase 7</span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Journal ---------------------------------------------------------------

function Journal() {
  const { books, update } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const accounts = useMemo(() => accountMap(books), [books]);
  const entries = useMemo(() => [...books.entries].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq), [books]);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No entries yet. Invoices, bills and payroll will land here automatically; for now, record opening
          balances or other activity with a journal entry.
        </p>
        <Link href="/transactions/new" className={cn(buttonVariants({ variant: "outline" }), "mt-4 min-h-11")}>
          New journal entry
        </Link>
      </div>
    );
  }

  async function voidEntry(entry: Entry) {
    setError(null);
    if (!window.confirm(`Void entry #${entry.seq}? A reversing entry will be added; the original stays in your history.`)) return;
    try {
      await update((b) => reverseEntry(b, entry.id).books);
    } catch (e) {
      // Original's month is closed: offer to post the reversal today instead.
      if (e instanceof Error && "code" in e && e.code === "PERIOD_CLOSED") {
        if (window.confirm(`Entry #${entry.seq}'s month is closed. Post the reversal dated today instead?`)) {
          try {
            await update((b) => reverseEntry(b, entry.id, { date: todayIso() }).books);
          } catch (e2) {
            setError(errorMessage(e2));
          }
        }
        return;
      }
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      {entries.map((entry) => {
        const reversed = reversalOf(books, entry.id);
        const total = entry.lines.reduce((s, l) => s + l.debit, 0n);
        return (
          <article key={entry.id} className={cn("rounded-lg border bg-card", reversed && "opacity-70")}>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
              <span className="text-sm font-medium tabular-nums">{entry.date}</span>
              <span className="text-xs text-muted-foreground">#{entry.seq}</span>
              <span className="text-xs text-muted-foreground">{SOURCE_LABELS[entry.source.kind]}</span>
              {entry.reverses && <Badge>Voids #{books.entries.find((e) => e.id === entry.reverses)?.seq}</Badge>}
              {entry.replaces && <Badge>Replaces #{books.entries.find((e) => e.id === entry.replaces)?.seq}</Badge>}
              {reversed && <Badge tone="muted">Voided by #{reversed.seq}</Badge>}
              <span className="ml-auto text-sm font-medium">
                <Money cents={total} />
              </span>
            </header>
            {entry.memo && <p className="px-4 pt-3 text-sm">{entry.memo}</p>}
            <div className="overflow-x-auto px-4 py-3">
              <table className="w-full text-sm">
                <thead className="sr-only">
                  <tr>
                    <th>Account</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((line, i) => {
                    const acct = accounts.get(line.accountId);
                    return (
                      <tr key={i} className="align-top">
                        <td className={cn("py-1 pr-2 break-words", line.credit > 0n && "pl-4")}>
                          {acct ? accountLabel(acct) : line.accountId}
                          {(line.name || line.memo) && (
                            <span className="block text-xs text-muted-foreground">
                              {[line.name?.id, line.memo].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </td>
                        <td className="w-24 py-1 text-right whitespace-nowrap sm:w-32">
                          <Money cents={line.debit} blankZero />
                        </td>
                        <td className="w-24 py-1 pl-2 text-right whitespace-nowrap sm:w-32">
                          <Money cents={line.credit} blankZero />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!entry.reverses && !reversed && (
              <footer className="flex justify-end border-t px-4 py-2">
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => voidEntry(entry)}>
                  Void
                </Button>
              </footer>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "muted" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs",
        tone === "muted" ? "text-muted-foreground" : "border-primary/30 bg-accent text-accent-foreground",
      )}
    >
      {children}
    </span>
  );
}

// ---- Chart of accounts -----------------------------------------------------

function ChartOfAccounts() {
  const { books, update } = useOpenBooks();
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = orderedAccounts(books, (a) => showInactive || a.active);
  const net = useMemo(() => netByAccount(books), [books]);
  const balance = (a: (typeof rows)[number]["account"]) => {
    const n = net.get(a.id) ?? 0n;
    return normalSide(baseOf(a)) === "debit" ? n : -n;
  };

  async function deactivate(id: string) {
    setError(null);
    try {
      await update((b) => deactivateAccount(b, id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setAdding((v) => !v)}>
          <Plus aria-hidden />
          Add account
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>
      {adding && <AddAccountForm books={books} onDone={() => setAdding(false)} />}
      <FormError message={error} />
      {BASE_ORDER.map((base) => {
        const group = rows.filter(({ account }) => baseOf(account) === base);
        if (group.length === 0) return null;
        return (
          <section key={base} className="overflow-hidden rounded-lg border bg-card">
            <h2 className="border-b bg-muted px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {BASE_LABELS[base]}
            </h2>
            <ul className="divide-y">
              {group.map(({ account, depth }) => (
                <li key={account.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={cn("min-w-0 flex-1", depth === 1 && "pl-4", depth === 2 && "pl-8", depth >= 3 && "pl-12")}>
                    <div className={cn("truncate text-sm", !account.active && "text-muted-foreground line-through")}>
                      {accountLabel(account)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {typeLabel(account)}
                      {account.system && " · Built in"}
                      {!account.active && " · Inactive"}
                    </div>
                  </div>
                  <Money cents={balance(account)} className="text-sm" />
                  {!account.system && account.active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 text-muted-foreground sm:min-h-8"
                      onClick={() => deactivate(account.id)}
                      aria-label={`Make ${account.name} inactive`}
                    >
                      Deactivate
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES) as [AccountType, (typeof ACCOUNT_TYPES)[AccountType]][];

function AddAccountForm({ books, onDone }: { books: Books; onDone: () => void }) {
  const { update } = useOpenBooks();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [type, setType] = useState<AccountType>("expense");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = ACCOUNT_TYPES[type].base;

  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await update(
            (b) =>
              addAccount(b, {
                name,
                type,
                ...(number.trim() ? { number: number.trim() } : {}),
                ...(parentId ? { parentId } : {}),
              }).books,
          );
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field label="Account name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Type">
        <select
          className={inputClass}
          value={type}
          onChange={(e) => {
            setType(e.target.value as AccountType);
            setParentId("");
          }}
        >
          {BASE_ORDER.map((b) => (
            <optgroup key={b} label={BASE_LABELS[b]}>
              {TYPE_OPTIONS.filter(([, t]) => t.base === b).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Number" hint="Optional.">
        <input className={inputClass} value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" />
      </Field>
      <Field label="Sub-account of" hint="Optional. Same section only.">
        <AccountSelect
          books={books}
          value={parentId}
          onChange={setParentId}
          filter={(a) => a.active && baseOf(a) === base}
          className={inputClass}
          placeholder="None (top level)"
        />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={!name.trim()}>
            Add account
          </Button>
        </div>
      </div>
    </form>
  );
}
