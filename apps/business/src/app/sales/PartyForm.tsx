"use client";

import { useState } from "react";
import { DEFAULT_TERMS, TERMS, type TermsId, type Vendor, type VendorInput } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";

/** Add or edit a customer or vendor. Everything here stays in the encrypted vault. */
export function PartyForm({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: "customer" | "vendor";
  initial?: Partial<Vendor>;
  onSave: (input: VendorInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [terms, setTerms] = useState<TermsId>(initial?.terms ?? DEFAULT_TERMS);
  const [tracks1099, setTracks1099] = useState(initial?.tracks1099 ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSave({ name, email, terms, ...(kind === "vendor" ? { tracks1099 } : {}) });
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <Field label={kind === "customer" ? "Customer name" : "Vendor name"}>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Email" hint="Optional.">
        <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Terms" hint={kind === "customer" ? "Sets the due date on new invoices." : "Sets the due date on new bills."}>
        <select className={inputClass} value={terms} onChange={(e) => setTerms(e.target.value as TermsId)}>
          {TERMS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      {kind === "vendor" && (
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={tracks1099}
            onChange={(e) => setTracks1099(e.target.checked)}
            className="size-4 accent-[var(--plumb-green)]"
          />
          Track payments for a 1099 (contractors you pay $600 or more a year)
        </label>
      )}
      <div className="flex flex-col gap-3 sm:col-span-3">
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !name.trim()}>
            {initial?.id ? "Save changes" : kind === "customer" ? "Add customer" : "Add vendor"}
          </Button>
        </div>
      </div>
    </form>
  );
}
