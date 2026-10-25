"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, CircleCheck, Circle } from "lucide-react";
import { type Books, ACCOUNT_TYPES, type AccountType, netByAccount, netIncome } from "@pnw/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, todayIso } from "@/books/display";
import { waitingCount } from "@/books/review";
import { SetAsides } from "@/books/SetAsides";
import { BackupReminder } from "@/books/BackupReminder";
import { PageHeader } from "@/shell/SectionView";

// What the linked account holds, read from the network; loaded only once an account is linked.
const AccountBalances = dynamic(() => import("@/chain/AccountBalances"), { ssr: false });
const ChainBackup = dynamic(() => import("@/chain/ChainBackup"), { ssr: false });

/** Sum of balances for accounts of the given types, positive on their normal side. */
function totalOf(books: Books, types: AccountType[]): bigint {
  const net = netByAccount(books);
  let total = 0n;
  for (const a of books.accounts) {
    if (!types.includes(a.type)) continue;
    const n = net.get(a.id) ?? 0n;
    total += ACCOUNT_TYPES[a.type].base === "asset" ? n : -n;
  }
  return total;
}

export default function DashboardPage() {
  const { books, payroll, sales, rail, review } = useOpenBooks();
  const waiting = waitingCount(review);
  const today = todayIso();
  const hasEntries = books.entries.length > 0;
  const hasCustomAccounts = books.accounts.some((a) => !a.system);

  const figures = [
    { label: "Cash in the bank", hint: "Bank accounts", cents: totalOf(books, ["bank"]) },
    { label: "Owed to you", hint: "Accounts receivable", cents: totalOf(books, ["accounts_receivable"]) },
    {
      label: "You owe",
      hint: "Bills, cards, withholding and other short-term debts",
      cents: totalOf(books, ["accounts_payable", "credit_card", "other_current_liability"]),
    },
    { label: "Profit this month", hint: "Income minus expenses", cents: netIncome(books, `${today.slice(0, 7)}-01`, today) },
  ];

  const setup = [
    { step: "Name your business and pick a fiscal year", href: "/", done: true },
    { step: "Choose a starter chart of accounts", href: "/transactions", done: hasCustomAccounts },
    rail
      ? { step: "Start your books from your Shield balance", href: "/#balances", done: hasEntries || !!rail.start }
      : { step: "Enter opening balances", href: "/transactions/new", done: hasEntries },
    { step: "Add your team and run a first payroll", href: "/payroll", done: payroll.runs.length > 0 },
    { step: "Send your first invoice", href: "/sales", done: sales.invoices.some((i) => i.entryId) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Dashboard" summary="Where your business stands today." />

      <BackupReminder account={rail ? <ChainBackup /> : undefined} />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {figures.map((f) => (
          <Card key={f.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{f.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                <Money cents={f.cents} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {waiting > 0 && (
        <Link
          href="/transactions?tab=review"
          className="flex min-h-12 items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 text-sm font-medium hover:bg-primary/10"
        >
          <span className="flex-1">
            {waiting} {waiting === 1 ? "transaction" : "transactions"} to review
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        </Link>
      )}

      {rail && (
        <section id="balances" aria-label="Account balances" className="scroll-mt-20">
          <AccountBalances address={rail.address} />
        </section>
      )}

      {rail?.start && (
        <section aria-label="Set-asides">
          <SetAsides />
        </section>
      )}

      <section aria-labelledby="setup-heading">
        <Card>
          <CardHeader>
            <CardTitle id="setup-heading" className="text-base">
              Set up your books
            </CardTitle>
            <p className="text-sm text-muted-foreground">A few steps and your figures above start filling in.</p>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {setup.map((s) => {
                const Icon = s.done ? CircleCheck : Circle;
                return (
                  <li key={s.step}>
                    <Link href={s.href} className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-primary">
                      <Icon aria-hidden className={cn("size-4 shrink-0", s.done ? "text-money-positive" : "text-muted-foreground")} />
                      <span className={cn("flex-1", s.done && "text-muted-foreground line-through")}>{s.step}</span>
                      <span className="sr-only">{s.done ? "Done" : "Not done"}</span>
                      <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
