"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { formatCents, parseCents, systemAccount, balanceOf } from "@pnw/ledger";
import {
  FILING_STATUSES,
  PAY_FREQUENCIES,
  type PayRun,
  type Worker,
  addWorker,
  employerTaxes,
  liabilitiesByQuarter,
  recordTaxPayment,
  updateWorker,
} from "@pnw/payroll";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { tagNameMap } from "@/books/tags";
import { PageHeader } from "@/shell/SectionView";
import { Paystub } from "./Paystub";
import { WorkerForm } from "./WorkerForm";

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

const TABS = ["runs", "team", "owed"];

export default function PayrollPage() {
  return (
    <Suspense>
      <PayrollScreen />
    </Suspense>
  );
}

function PayrollScreen() {
  const { payroll } = useOpenBooks();
  const asked = useSearchParams().get("tab");
  const activeTeam = payroll.workers.filter((w) => w.active);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payroll"
        summary="Pay your team, and track what's withheld until it's sent to the IRS."
        action={
          activeTeam.length > 0 ? (
            <Link href="/payroll/run" className={cn(buttonVariants(), "min-h-11 sm:min-h-9")}>
              <Plus aria-hidden />
              Run payroll
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Add someone to your team to run payroll.</span>
          )
        }
      />
      <Tabs defaultValue={asked && TABS.includes(asked) ? asked : payroll.runs.length ? "runs" : "team"} className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="runs" className="min-h-9">Pay runs</TabsTrigger>
            <TabsTrigger value="team" className="min-h-9">Team</TabsTrigger>
            <TabsTrigger value="owed" className="min-h-9 whitespace-nowrap">Withholding owed</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="runs">
          <PayRuns />
        </TabsContent>
        <TabsContent value="team">
          <Team />
        </TabsContent>
        <TabsContent value="owed">
          <WithholdingOwed />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Pay runs --------------------------------------------------------------

function PayRuns() {
  const { payroll } = useOpenBooks();
  const runs = [...payroll.runs].sort((a, b) => b.payDate.localeCompare(a.payDate));
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No pay runs yet. Each run posts one balanced entry per person: wages, withholding, employer taxes and net pay.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </div>
  );
}

/** "Paid", or how far along a run paid on the rail is. */
function paymentStatus(run: PayRun): string {
  const settled = run.paychecks.filter((p) => p.settlement.status === "settled").length;
  const failed = run.paychecks.filter((p) => p.settlement.status === "failed").length;
  if (settled === run.paychecks.length) return "Paid";
  const parts = [`Settling… ${settled} of ${run.paychecks.length}`];
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** The one reference every paycheck in the run shares (a bank batch number), if there is one. */
function sharedReference(run: PayRun): string | undefined {
  const refs = new Set(run.paychecks.map((p) => p.settlement.reference ?? ""));
  return refs.size === 1 ? [...refs][0] || undefined : undefined;
}

function RunCard({ run }: { run: PayRun }) {
  const { payroll, dimensions } = useOpenBooks();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  const projects = tagNameMap(dimensions);
  const gross = sum(run.paychecks.map((p) => p.gross));
  const net = sum(run.paychecks.map((p) => p.net));
  const status = paymentStatus(run);
  const reference = sharedReference(run);
  const shown = viewing ? run.paychecks.find((p) => p.workerId === viewing) : undefined;
  return (
    <article className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium tabular-nums">{run.payDate}</span>
        <span className="text-xs text-muted-foreground">
          {run.periodStart} to {run.periodEnd} · {run.paychecks.length} {run.paychecks.length === 1 ? "person" : "people"}
        </span>
        <span className="text-xs">
          <span className={cn(status === "Paid" ? "text-muted-foreground" : "font-medium")}>{status}</span>
          {reference && <span className="text-muted-foreground"> · Ref. {reference}</span>}
        </span>
        <span className="ml-auto flex items-center gap-4 text-sm">
          <span>
            <span className="text-xs text-muted-foreground">Gross </span>
            <Money cents={gross} />
          </span>
          <span className="hidden sm:inline">
            <span className="text-xs text-muted-foreground">Net </span>
            <Money cents={net} />
          </span>
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t px-4 py-3">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-medium">Name</th>
                <th className="py-1 text-right font-medium">Gross</th>
                <th className="py-1 text-right font-medium">Federal</th>
                <th className="py-1 text-right font-medium">SS + Medicare</th>
                <th className="py-1 text-right font-medium">Net</th>
                <th className="py-1 text-right font-medium">Employer taxes</th>
                <th className="py-1 text-right font-medium">Paystub</th>
              </tr>
            </thead>
            <tbody>
              {run.paychecks.map((p) => (
                <tr key={p.workerId}>
                  <td className="py-1">
                    {names.get(p.workerId) ?? p.workerId}
                    {p.hours !== undefined && <span className="ml-1 text-xs text-muted-foreground">{p.hours} h</span>}
                    {p.tags?.project && <span className="block text-xs text-muted-foreground">{projects.get(p.tags.project) ?? p.tags.project}</span>}
                    {p.settlement.status !== "settled" && (
                      <span className="block text-xs text-muted-foreground">{p.settlement.status === "failed" ? "Payment failed" : "Settling…"}</span>
                    )}
                  </td>
                  <td className="py-1 text-right"><Money cents={p.gross} /></td>
                  <td className="py-1 text-right"><Money cents={p.federalIncomeTax} /></td>
                  <td className="py-1 text-right"><Money cents={p.socialSecurity + p.medicare + p.additionalMedicare} /></td>
                  <td className="py-1 text-right font-medium"><Money cents={p.net} /></td>
                  <td className="py-1 text-right text-muted-foreground"><Money cents={employerTaxes(p)} /></td>
                  <td className="py-1 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      aria-pressed={viewing === p.workerId}
                      onClick={() => setViewing((v) => (v === p.workerId ? null : p.workerId))}
                    >
                      View paystub
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Posted as {run.entryIds.length} journal {run.entryIds.length === 1 ? "entry" : "entries"} in Transactions.
          </p>
        </div>
      )}
      {/* Below the scrolling table, not inside it, so it never lands off-screen on a phone. */}
      {open && shown && (
        <div className="border-t p-3">
          <Paystub run={run} paycheck={shown} onClose={() => setViewing(null)} />
        </div>
      )}
    </article>
  );
}

// ---- Team ------------------------------------------------------------------

function payLabel(w: Worker): string {
  const freq = PAY_FREQUENCIES.find((f) => f.id === w.frequency)?.label.toLowerCase();
  return w.payType === "hourly" ? `${formatCents(w.rate)}/hr · paid ${freq}` : `${formatCents(w.rate)}/yr · paid ${freq}`;
}

function Team() {
  const { payroll, updateCompany } = useOpenBooks();
  const [editing, setEditing] = useState<string | "new" | null>(payroll.workers.length === 0 ? "new" : null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {editing !== "new" && (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          Add someone
        </Button>
      )}
      {editing === "new" && (
        <WorkerForm
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await updateCompany((c) => ({ ...c, payroll: addWorker(c.payroll, input).payroll }));
            setEditing(null);
          }}
        />
      )}
      <FormError message={error} />
      {payroll.workers.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {payroll.workers.map((w) =>
            editing === w.id ? (
              <li key={w.id} className="p-2">
                <WorkerForm
                  initial={w}
                  onCancel={() => setEditing(null)}
                  onSave={async (input) => {
                    await updateCompany((c) => ({ ...c, payroll: updateWorker(c.payroll, w.id, input) }));
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium", !w.active && "text-muted-foreground line-through")}>{w.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {payLabel(w)} · {FILING_STATUSES.find((f) => f.id === w.w4.filingStatus)?.label}
                    {!w.active && " · Inactive"}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setEditing(w.id)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-muted-foreground sm:min-h-8"
                  onClick={async () => {
                    setError(null);
                    try {
                      await updateCompany((c) => ({ ...c, payroll: updateWorker(c.payroll, w.id, { active: !w.active }) }));
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  {w.active ? "Deactivate" : "Reactivate"}
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Names, pay rates and W-4 details are stored only in your encrypted books on this device.
      </p>
    </div>
  );
}

// ---- Withholding owed ------------------------------------------------------

function WithholdingOwed() {
  const { books, payroll, update } = useOpenBooks();
  const quarters = useMemo(() => liabilitiesByQuarter(payroll), [payroll]);
  const owed = -balanceOf(books, systemAccount(books, "payroll_liabilities").id);
  const firstBank = books.accounts.find((a) => a.type === "bank" && a.active)?.id ?? "";
  const [paying, setPaying] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState(firstBank);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Owed to the IRS now</div>
          <div className="mt-1 text-2xl font-semibold">
            <Money cents={owed} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Federal income tax withheld, plus both halves of Social Security and Medicare.</p>
        </div>
        {owed > 0n && !paying && (
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              setAmount(formatCents(owed).replace(/,/g, ""));
              setPaying(true);
            }}
          >
            Record a tax payment
          </Button>
        )}
      </div>

      {paying && (
        <form
          className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const cents = parseCents(amount);
              await update((b) => recordTaxPayment(b, { date, amount: cents, bankAccountId: bank }).books);
              setPaying(false);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <Field label="Paid on">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Amount">
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="From">
            <AccountSelect books={books} value={bank} onChange={setBank} filter={(a) => a.type === "bank" && a.active} className={inputClass} />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-3">
            <FormError message={error} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => setPaying(false)}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 flex-1 sm:flex-none">
                Record payment
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Quarter</th>
              <th className="px-4 py-2 text-right font-medium">Federal withheld</th>
              <th className="px-4 py-2 text-right font-medium">Employee SS + Medicare</th>
              <th className="px-4 py-2 text-right font-medium">Employer SS + Medicare</th>
              <th className="px-4 py-2 text-right font-medium">Total (Form 941)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {quarters.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nothing withheld yet. Taxes appear here by quarter as you run payroll.
                </td>
              </tr>
            )}
            {quarters.map((q) => (
              <tr key={q.quarter}>
                <td className="px-4 py-2">{q.quarter.replace("-", " ")}</td>
                <td className="px-4 py-2 text-right"><Money cents={q.federalIncomeTax} /></td>
                <td className="px-4 py-2 text-right"><Money cents={q.employeeFica} /></td>
                <td className="px-4 py-2 text-right"><Money cents={q.employerFica} /></td>
                <td className="px-4 py-2 text-right font-medium"><Money cents={q.total} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        You file and pay the IRS yourself (EFTPS); recording the payment here clears it from what&apos;s owed.
      </p>
    </div>
  );
}

