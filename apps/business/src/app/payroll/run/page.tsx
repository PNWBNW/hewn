"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCents } from "@pnw/ledger";
import {
  type Paycheck,
  computePaycheck,
  employerTaxes,
  grossFor,
  postPayRun,
  withheld,
  yearToDate,
} from "@pnw/payroll";
import { Button, buttonVariants } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";

function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

type Row = { include: boolean; hours: string };

export default function RunPayrollPage() {
  const { books, payroll, updateCompany } = useOpenBooks();
  const router = useRouter();
  const team = payroll.workers.filter((w) => w.active);
  const today = todayIso();
  const [payDate, setPayDate] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(daysBefore(today, 13));
  const [bank, setBank] = useState(books.accounts.find((a) => a.type === "bank" && a.active)?.id ?? "");
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(team.map((w) => [w.id, { include: true, hours: "" }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live preview, one paycheck at a time so each row can show its own problem.
  const preview = useMemo(
    () =>
      team.map((w) => {
        const row = rows[w.id] ?? { include: false, hours: "" };
        if (!row.include) return { worker: w, row, paycheck: null, problem: null };
        try {
          const hours = w.payType === "hourly" ? (row.hours.trim() ? Number(row.hours) : undefined) : undefined;
          if (w.payType === "hourly" && (hours === undefined || Number.isNaN(hours))) {
            return { worker: w, row, paycheck: null, problem: "Enter hours" };
          }
          const paycheck = computePaycheck(w, grossFor(w, hours), yearToDate(payroll, w.id, payDate), hours);
          return { worker: w, row, paycheck, problem: null };
        } catch (e) {
          return { worker: w, row, paycheck: null, problem: errorMessage(e) };
        }
      }),
    [team, rows, payroll, payDate],
  );

  const included = preview.filter((p) => p.row.include);
  const checks = included.map((p) => p.paycheck).filter((p): p is Paycheck => p !== null);
  const total = (f: (p: Paycheck) => bigint) => checks.reduce((a, p) => a + f(p), 0n);
  const ready = included.length > 0 && included.every((p) => p.paycheck) && !!bank;

  async function post() {
    setBusy(true);
    setError(null);
    try {
      await updateCompany((c) => {
        const r = postPayRun(c.books, c.payroll, {
          payDate,
          periodStart,
          periodEnd,
          bankAccountId: bank,
          lines: included.map(({ worker, row }) => ({
            workerId: worker.id,
            ...(worker.payType === "hourly" ? { hours: Number(row.hours) } : {}),
          })),
        });
        return { ...c, books: r.books, payroll: r.payroll };
      });
      router.push("/payroll");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (team.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Run payroll" summary="Add someone to your team first." />
        <Link href="/payroll" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 self-start")}>
          Back to payroll
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Run payroll" summary="Check each paycheck, then post. Every paycheck becomes one balanced entry in your books." />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void post();
        }}
      >
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-4">
          <Field label="Pay date">
            <input type="date" className={inputClass} value={payDate} onChange={(e) => setPayDate(e.target.value)} required />
          </Field>
          <Field label="Period starts">
            <input type="date" className={inputClass} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
          </Field>
          <Field label="Period ends">
            <input type="date" className={inputClass} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
          </Field>
          <Field label="Paid from">
            <AccountSelect
              books={books}
              value={bank}
              onChange={setBank}
              filter={(a) => a.type === "bank" && a.active}
              className={inputClass}
              placeholder="Choose a bank account"
            />
          </Field>
        </div>

        <ul className="flex flex-col gap-3">
          {preview.map(({ worker, row, paycheck, problem }) => (
            <li key={worker.id} className={cn("rounded-lg border bg-card p-4", !row.include && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-11 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => setRows((r) => ({ ...r, [worker.id]: { ...row, include: e.target.checked } }))}
                    className="size-4 accent-[var(--plumb-green)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{worker.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {worker.payType === "hourly" ? `${formatCents(worker.rate)}/hr` : `${formatCents(worker.rate)}/yr salary`}
                    </span>
                  </span>
                </label>
                {worker.payType === "hourly" && row.include && (
                  <input
                    className={cn(inputClass, "w-28 text-right")}
                    inputMode="decimal"
                    placeholder="Hours"
                    aria-label={`${worker.name} hours`}
                    value={row.hours}
                    onChange={(e) => setRows((r) => ({ ...r, [worker.id]: { ...row, hours: e.target.value } }))}
                  />
                )}
              </div>
              {row.include && problem && <p className="mt-2 text-xs text-destructive">{problem}</p>}
              {paycheck && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-sm sm:grid-cols-5">
                  <Figure label="Gross" cents={paycheck.gross} />
                  <Figure label="Federal" cents={paycheck.federalIncomeTax} />
                  <Figure label="SS + Medicare" cents={paycheck.socialSecurity + paycheck.medicare + paycheck.additionalMedicare} />
                  <Figure label="Net pay" cents={paycheck.net} strong />
                  <Figure label="Employer taxes" cents={employerTaxes(paycheck)} muted />
                </dl>
              )}
            </li>
          ))}
        </ul>

        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-card/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-lg sm:border">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Figure label="Total gross" cents={total((p) => p.gross)} />
            <Figure label="Withheld" cents={total(withheld)} />
            <Figure label="Net to the team" cents={total((p) => p.net)} strong />
            <Figure label="Total cost to you" cents={total((p) => p.gross + employerTaxes(p))} />
          </dl>
          <FormError message={error} />
          <div className="flex gap-3">
            <Link href="/payroll" className={cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 sm:flex-none")}>
              Cancel
            </Link>
            <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={!ready || busy}>
              {busy ? "Posting…" : `Post payroll for ${included.length}`}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Figure({ label, cents, strong, muted }: { label: string; cents: bigint; strong?: boolean; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold", muted && "text-muted-foreground")}>
        <Money cents={cents} />
      </dd>
    </div>
  );
}
