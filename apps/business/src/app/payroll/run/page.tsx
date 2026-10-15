"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCents } from "@pnw/ledger";
import {
  type PaycheckDraft,
  checkDoublePay,
  computePaycheck,
  employerTaxes,
  ensureRailAccount,
  grossFor,
  postPayRun,
  withheld,
  yearToDate,
} from "@pnw/payroll";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { TagFields } from "@/books/tags";
import { PageHeader } from "@/shell/SectionView";

function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** One optional project per paycheck: its wages and employer taxes count as that job's labour. */
type Row = { include: boolean; hours: string; project?: string };

/** The "Paid from" choice that isn't a bank account: the business's own rail balance. */
const RAIL = "rail";
const LINK_FIRST = "Link on the rail first: Settings → Import team";

export default function RunPayrollPage() {
  const { books, payroll, dimensions, rail, updateCompany } = useOpenBooks();
  const router = useRouter();
  const team = payroll.workers.filter((w) => w.active);
  const linked = useMemo(() => new Set(rail?.links.map((l) => l.workerId) ?? []), [rail]);
  const today = todayIso();
  const [payDate, setPayDate] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(daysBefore(today, 13));
  // With an account on the rail, paying from it is the first choice; otherwise the first bank account.
  const [bank, setBank] = useState(rail ? RAIL : (books.accounts.find((a) => a.type === "bank" && a.active)?.id ?? ""));
  const onRail = rail !== null && bank === RAIL;
  const [reference, setReference] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(team.map((w) => [w.id, { include: true, hours: "" }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSameDay, setConfirmSameDay] = useState<string[] | null>(null);

  // Live preview, one paycheck at a time so each row can show its own problem.
  const preview = useMemo(
    () =>
      team.map((w) => {
        const row = rows[w.id] ?? { include: false, hours: "" };
        // Paying on the rail needs an account for everyone included; a row without one stays out.
        if (onRail && !linked.has(w.id)) return { worker: w, row: { ...row, include: false }, paycheck: null, problem: LINK_FIRST };
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
    [team, rows, payroll, payDate, onRail, linked],
  );

  const included = preview.filter((p) => p.row.include);
  const checks = included.map((p) => p.paycheck).filter((p): p is PaycheckDraft => p !== null);
  const total = (f: (p: PaycheckDraft) => bigint) => checks.reduce((a, p) => a + f(p), 0n);
  const ready = included.length > 0 && included.every((p) => p.paycheck) && !!bank;
  const names = new Map(team.map((w) => [w.id, w.name]));
  const lines = () =>
    included.map(({ worker, row }) => ({
      workerId: worker.id,
      ...(worker.payType === "hourly" ? { hours: Number(row.hours) } : {}),
      ...(row.project ? { tags: { project: row.project } } : {}),
    }));

  /** Before posting: refuse an exact repeat of a payment on this date; ask about any other same-day pay. */
  function submit() {
    setError(null);
    const check = checkDoublePay(payroll, { payDate, lines: lines() });
    const who = (xs: { workerId: string }[]) => [...new Set(xs.map((x) => names.get(x.workerId) ?? x.workerId))];
    if (check.blocked.length > 0) {
      setError(`Already paid on ${payDate} for the same amount: ${who(check.blocked).join(", ")}. Change the amount or the pay date to pay again.`);
      return;
    }
    if (check.sameDay.length > 0) {
      setConfirmSameDay(who(check.sameDay));
      return;
    }
    void post();
  }

  async function post() {
    setBusy(true);
    setError(null);
    setConfirmSameDay(null);
    try {
      let runId = "";
      await updateCompany((c) => {
        // On the rail: net pay comes from the "Shield account" bank account and settles per person as each
        // payment lands. Otherwise the money moves through the bank and the run is settled as it posts.
        const from = onRail ? ensureRailAccount(c.books) : { books: c.books, accountId: bank };
        const r = postPayRun(from.books, c.payroll, {
          payDate,
          periodStart,
          periodEnd,
          bankAccountId: from.accountId,
          mode: onRail ? "rail" : "external",
          ...(!onRail && reference.trim() ? { reference: reference.trim() } : {}),
          lines: lines(),
        });
        runId = r.run.id;
        return { ...c, books: r.books, payroll: r.payroll };
      });
      // A rail run goes straight to the pay panel; the rest is done.
      router.push(onRail ? `/payroll?pay=${runId}` : "/payroll");
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
          if (ready && !busy) submit();
        }}
      >
        <div className={cn("grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3", onRail ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
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
              leading={rail ? [{ value: RAIL, label: "Shield account (private rail)" }] : []}
            />
          </Field>
          {!onRail && (
            <Field label="Payment reference" hint="Optional. Shown on each paystub.">
              <input
                className={inputClass}
                placeholder="e.g. bank batch number"
                maxLength={80}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          )}
        </div>

        <ul className="flex flex-col gap-3">
          {preview.map(({ worker, row, paycheck, problem }) => (
            <li key={worker.id} className={cn("rounded-lg border bg-card p-4", !row.include && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-11 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={row.include}
                    disabled={problem === LINK_FIRST}
                    onChange={(e) => setRows((r) => ({ ...r, [worker.id]: { ...row, include: e.target.checked } }))}
                    className="size-4 accent-[var(--hewn-green)]"
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
              {row.include && (
                <TagFields
                  dims={dimensions}
                  kinds={["project"]}
                  value={row.project ? { project: row.project } : {}}
                  onChange={(t) => setRows((r) => ({ ...r, [worker.id]: { ...row, project: t.project } }))}
                  labelPrefix={worker.name}
                  className="mt-3 sm:grid-cols-2"
                />
              )}
              {(row.include || problem === LINK_FIRST) && problem && <p className="mt-2 text-xs text-destructive">{problem}</p>}
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
              {busy ? "Posting…" : onRail ? `Post and pay ${included.length}` : `Post payroll for ${included.length}`}
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={confirmSameDay !== null} onOpenChange={(open) => !open && setConfirmSameDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Already paid on {payDate}</DialogTitle>
            <DialogDescription>
              {confirmSameDay?.join(", ")} {confirmSameDay?.length === 1 ? "has" : "have"} another paycheck dated {payDate}. Post this one as well?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirmSameDay(null)}>
              Go back
            </Button>
            <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void post()}>
              Post anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
