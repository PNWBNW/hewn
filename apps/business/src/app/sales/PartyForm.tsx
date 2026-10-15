"use client";

import { useState } from "react";
import { DEFAULT_TERMS, TERMS, type TermsId, type Vendor, type VendorInput } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { LinkBadge } from "@/books/LinkBadge";
import type { Company } from "@/books/company";
import { RegistryField } from "@/books/RegistryField";
import { type LinkStatus, type PartyKind, type Registered, partyLinkFor, registeredFor, setRegistered } from "@/books/rail";

/** Where a customer or vendor stands with the rail, for the form. The address field needs an account linked in Settings. */
export type PartyLinkView = { status: LinkStatus; registered?: Registered; railLinked: boolean };

export const partyLinkView = (rail: Company["rail"] | null, kind: PartyKind, id: string | undefined): PartyLinkView => {
  const link = rail && id ? partyLinkFor(rail, kind, id) : undefined;
  const registered = id ? registeredFor(rail, kind, id) : undefined;
  return { status: link?.status ?? "typed", ...(registered ? { registered } : {}), railLinked: !!rail };
};

/** The company with who the party is on the registry recorded; untouched when nothing was found or no account is linked. */
export function withRegistered(c: Company, kind: PartyKind, id: string, who: Registered | undefined): Company {
  if (!who || !c.rail) return c;
  return { ...c, rail: setRegistered(c.rail, kind, id, who) };
}

export const PARTY_RAIL_NOTE = "Documents and payments on the rail need an agreement approved by both sides; coming for vendors and customers soon.";

/**
 * Add or edit a customer or vendor. Everything here stays in the encrypted
 * vault. A new one is added only by finding their registered name; one
 * added before that rule can be found and linked here too.
 */
export function PartyForm({
  kind,
  initial,
  link,
  onSave,
  onCancel,
}: {
  kind: PartyKind;
  initial?: Partial<Vendor>;
  link?: PartyLinkView;
  onSave: (input: VendorInput, registered: Registered | undefined) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [terms, setTerms] = useState<TermsId>(initial?.terms ?? DEFAULT_TERMS);
  const [tracks1099, setTracks1099] = useState(initial?.tracks1099 ?? false);
  const [registered, setRegisteredWho] = useState<Registered | undefined>(link?.registered);
  const adding = !initial?.id;
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
          if (adding && !registered) throw new Error(`Find the ${kind} on the registry first`);
          await onSave({ name, email, terms, ...(kind === "vendor" ? { tracks1099 } : {}) }, registered);
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      {link && !adding && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-3">
          <LinkBadge status={link.status} />
          {link.status === "typed" ? (registered ? "On the registry. " : "Not linked to a registered name yet. ") + PARTY_RAIL_NOTE : PARTY_RAIL_NOTE}
        </div>
      )}
      <div className="sm:col-span-3">
        <RegistryField
          allow={["business", "worker"]}
          value={registered}
          onChange={(who) => {
            setRegisteredWho(who);
            if (who && !name.trim()) setName(who.name);
          }}
          label={adding ? `Find the ${kind} on the registry` : "Their registered name"}
          hint={`Their registered name, like acme.hewn, or their account starting aleo1. ${adding ? `A ${kind} is added only by their registered name.` : ""}`}
          locked={link?.status !== undefined && link.status !== "typed"}
        />
      </div>
      <Field label={kind === "customer" ? "Customer name" : "Vendor name"}>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
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
            className="size-4 accent-[var(--hewn-green)]"
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
          <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !name.trim() || (adding && !registered)}>
            {initial?.id ? "Save changes" : kind === "customer" ? "Add customer" : "Add vendor"}
          </Button>
        </div>
      </div>
    </form>
  );
}
