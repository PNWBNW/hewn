"use client";

import { useState } from "react";
import { type Cents, formatCents, parseCents } from "@pnw/ledger";
import { FILING_STATUSES, PAY_FREQUENCIES, type PayFrequency, type W4, type Worker, type WorkerInput } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";

const plain = (c: Cents) => formatCents(c).replace(/,/g, "");

function money(text: string, label: string, allowZero = true): Cents {
  const t = text.trim() || "0";
  let v: Cents;
  try {
    v = parseCents(t);
  } catch {
    throw new Error(`${label}: enter an amount like 1250 or 1,250.00`);
  }
  if (v < 0n || (!allowZero && v === 0n)) throw new Error(`${label} must be ${allowZero ? "zero or more" : "more than zero"}`);
  return v;
}

/** Add or edit a team member. Everything here stays in the encrypted vault. */
export function WorkerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Worker;
  onSave: (input: WorkerInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [payType, setPayType] = useState<Worker["payType"]>(initial?.payType ?? "hourly");
  const [rate, setRate] = useState(initial ? plain(initial.rate) : "");
  const [frequency, setFrequency] = useState<PayFrequency>(initial?.frequency ?? "biweekly");
  const [filingStatus, setFilingStatus] = useState<W4["filingStatus"]>(initial?.w4.filingStatus ?? "single");
  const [dependents, setDependents] = useState(initial ? plain(initial.w4.dependentCredit) : "0");
  const [otherIncome, setOtherIncome] = useState(initial ? plain(initial.w4.otherIncome) : "0");
  const [deductions, setDeductions] = useState(initial ? plain(initial.w4.extraDeductions) : "0");
  const [extra, setExtra] = useState(initial ? plain(initial.w4.extraWithholding) : "0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSave({
            name,
            payType,
            rate: money(rate, payType === "hourly" ? "Hourly rate" : "Annual salary", false),
            frequency,
            w4: {
              filingStatus,
              dependentCredit: money(dependents, "Dependents credit"),
              otherIncome: money(otherIncome, "Other income"),
              extraDeductions: money(deductions, "Deductions"),
              extraWithholding: money(extra, "Extra withholding"),
            },
          });
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Paid">
        <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as PayFrequency)}>
          {PAY_FREQUENCIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pay type">
        <select className={inputClass} value={payType} onChange={(e) => setPayType(e.target.value as Worker["payType"])}>
          <option value="hourly">Hourly</option>
          <option value="salary">Salary</option>
        </select>
      </Field>
      <Field label={payType === "hourly" ? "Hourly rate" : "Annual salary"}>
        <input className={inputClass} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </Field>

      <fieldset className="grid gap-4 rounded-md border border-dashed p-3 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium text-muted-foreground">From their W-4</legend>
        <Field label="Filing status (Step 1)">
          <select className={inputClass} value={filingStatus} onChange={(e) => setFilingStatus(e.target.value as W4["filingStatus"])}>
            {FILING_STATUSES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dependents credit (Step 3)" hint="Yearly total from the form.">
          <input className={inputClass} inputMode="decimal" value={dependents} onChange={(e) => setDependents(e.target.value)} />
        </Field>
        <Field label="Other income (Step 4a)" hint="Yearly.">
          <input className={inputClass} inputMode="decimal" value={otherIncome} onChange={(e) => setOtherIncome(e.target.value)} />
        </Field>
        <Field label="Deductions (Step 4b)" hint="Yearly.">
          <input className={inputClass} inputMode="decimal" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
        </Field>
        <Field label="Extra withholding (Step 4c)" hint="Per paycheck.">
          <input className={inputClass} inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </Field>
      </fieldset>

      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !name.trim() || !rate.trim()}>
            {initial ? "Save changes" : "Add to team"}
          </Button>
        </div>
      </div>
    </form>
  );
}
