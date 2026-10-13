"use client";

// Projects (jobs): the list with each one's income, costs and profit for a
// date range, a form to add or edit one, and a project's own profit and
// loss on demand. Tag invoice lines, bill lines and paychecks with a project
// and the figures add themselves up here.

import { useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { type Project, addProject, marginBp, profitAndLossForTag, profitByTag, updateProject } from "@pnw/ledger";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money } from "@/books/display";
import { formatDate } from "../reports/dates";
import { RangeFields, useRange } from "../reports/RangeFields";
import { formatMargin, profitAndLossLines } from "../reports/lines";
import { Statement } from "../reports/Statement";

export function ProjectsTab({ adding, setAdding }: { adding: boolean; setAdding: (v: boolean) => void }) {
  const { books, sales, dimensions, updateCompany } = useOpenBooks();
  const range = useRange(books.settings.fiscalYearStartMonth, "all");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customers = new Map(sales.customers.map((c) => [c.id, c.name]));

  const summary = useMemo(
    () => (range.valid ? profitByTag(books, "project", range.range, dimensions.projects.map((p) => p.id)) : null),
    [books, dimensions, range.range, range.valid],
  );
  const byId = new Map((summary?.rows ?? []).map((r) => [r.tagId, r]));
  const projects = dimensions.projects.filter((p) => showClosed || p.status === "active");
  const closedCount = dimensions.projects.filter((p) => p.status === "closed").length;

  async function setStatus(p: Project, status: Project["status"]) {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, dimensions: updateProject(c.dimensions, p.id, { status }) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {adding && (
        <ProjectForm
          onCancel={() => setAdding(false)}
          onSave={async (input) => {
            await updateCompany((c) => ({ ...c, dimensions: addProject(c.dimensions, input).dims }));
            setAdding(false);
          }}
        />
      )}
      {!adding && (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add project
        </Button>
      )}

      {dimensions.projects.length > 0 && (
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
          <RangeFields state={range} allowAll />
        </div>
      )}
      {!range.valid && <FormError message="Choose a start date on or before the end date." />}
      <FormError message={error} />

      {summary && dimensions.projects.length > 0 && (
        <section aria-label="All projects" className="rounded-lg border bg-card p-4">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">All projects</h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Figure label="Income" cents={summary.total.income} />
            <Figure label="Costs" cents={summary.total.costOfGoodsSold + summary.total.expenses} />
            <Figure label="Profit" cents={summary.total.profit} strong />
            <div>
              <dt className="text-xs text-muted-foreground">Margin</dt>
              <dd className="tabular-nums">{formatMargin(summary.total.marginBp)}</dd>
            </div>
          </dl>
        </section>
      )}

      {dimensions.projects.length === 0 && !adding && (
        <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          No projects yet. Add one, then pick it on invoice lines, bill lines and paychecks: its profit adds itself up here.
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {projects.map((p) => {
          const r = byId.get(p.id);
          return (
            <li key={p.id} className="rounded-lg border bg-card">
              {editing === p.id ? (
                <div className="p-2">
                  <ProjectForm
                    initial={p}
                    onCancel={() => setEditing(null)}
                    onSave={async (input) => {
                      await updateCompany((c) => ({
                        ...c,
                        dimensions: updateProject(c.dimensions, p.id, { name: input.name, customerId: input.customerId ?? null }),
                      }));
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                    <h3 className={cn("text-sm font-medium", p.status === "closed" && "text-muted-foreground")}>{p.name}</h3>
                    {p.customerId && <span className="text-xs text-muted-foreground">{customers.get(p.customerId) ?? p.customerId}</span>}
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs",
                        p.status === "active" ? "border-primary/30 bg-accent text-accent-foreground" : "text-muted-foreground",
                      )}
                    >
                      {p.status === "active" ? "Active" : "Closed"}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 px-4 py-3 text-sm sm:grid-cols-4">
                    <Figure label="Income" cents={r?.income ?? 0n} />
                    <Figure label="Costs" cents={(r?.costOfGoodsSold ?? 0n) + (r?.expenses ?? 0n)} />
                    <Figure label="Profit" cents={r?.profit ?? 0n} strong />
                    <div>
                      <dt className="text-xs text-muted-foreground">Margin</dt>
                      <dd className="tabular-nums">{formatMargin(r?.marginBp ?? null)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      aria-expanded={open === p.id}
                      onClick={() => setOpen((o) => (o === p.id ? null : p.id))}
                    >
                      Profit and loss
                      <ChevronDown aria-hidden className={cn("transition-transform", open === p.id && "rotate-180")} />
                    </Button>
                    <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setEditing(p.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto min-h-11 text-muted-foreground sm:min-h-8"
                      onClick={() => setStatus(p, p.status === "active" ? "closed" : "active")}
                    >
                      {p.status === "active" ? "Close project" : "Reopen"}
                    </Button>
                  </div>
                  {open === p.id && range.valid && (
                    <div className="border-t p-3">
                      <ProjectStatement project={p} range={range.range} label={range.choice === "all" ? "All dates" : null} />
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {closedCount > 0 && (
        <Button variant="ghost" size="sm" className="min-h-11 self-start text-muted-foreground sm:min-h-8" onClick={() => setShowClosed((s) => !s)}>
          {showClosed ? "Hide closed projects" : `Show closed projects (${closedCount})`}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Costs are job costs and expenses tagged to the project, including wages and employer payroll taxes from tagged paychecks.
        Project names and which customer they&apos;re for stay in your encrypted books on this device.
      </p>
    </div>
  );
}

function ProjectStatement({ project, range, label }: { project: Project; range: { from: string; to: string }; label: string | null }) {
  const { books } = useOpenBooks();
  const pl = profitAndLossForTag(books, "project", project.id, range);
  const income = pl.income.total[0]! + pl.otherIncome.total[0]!;
  return (
    <Statement
      businessName={books.settings.businessName}
      report={{
        title: `Profit and loss: ${project.name}`,
        subtitle: label ?? `${formatDate(range.from)} – ${formatDate(range.to)}`,
        columns: ["Amount"],
        lines: profitAndLossLines(pl),
        note: `Margin ${formatMargin(marginBp(pl.netIncome[0]!, income))}. Only lines tagged with this project are counted.`,
      }}
    />
  );
}

function Figure({ label, cents, strong }: { label: string; cents: bigint; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>
        <Money cents={cents} />
      </dd>
    </div>
  );
}

function ProjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Project;
  onSave: (input: { name: string; customerId?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { sales } = useOpenBooks();
  const [name, setName] = useState(initial?.name ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const customers = sales.customers.filter((c) => c.active || c.id === initial?.customerId);
  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSave({ name, ...(customerId ? { customerId } : {}) });
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <Field label="Project name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Customer" hint="Optional: who the job is for.">
        <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">No customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy}>
            {initial ? "Save changes" : "Add project"}
          </Button>
        </div>
      </div>
    </form>
  );
}
