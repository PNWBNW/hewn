"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_TERMS, TERMS, type TermsId, type Vendor, type VendorInput } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { LinkBadge } from "@/books/LinkBadge";
import type { Company } from "@/books/company";
import { type LinkStatus, type PartyKind, partyLinkFor, setPartyAddress } from "@/books/rail";

/** Where a customer or vendor stands with the rail, for the form. The address field needs an account linked in Settings. */
export type PartyLinkView = { status: LinkStatus; address?: string; nameHash?: string; railLinked: boolean };

// Fetched only when the form is open with an account linked: nobody else downloads the lookup.
const NameLookup = dynamic(() => import("@/chain/NameLookup"), { ssr: false, loading: () => <p className="text-xs text-muted-foreground">Loading…</p> });

export const partyLinkView = (rail: Company["rail"] | null, kind: PartyKind, id: string | undefined): PartyLinkView => {
  const link = rail && id ? partyLinkFor(rail, kind, id) : undefined;
  return {
    status: link?.status ?? "typed",
    ...(link?.address ? { address: link.address } : {}),
    ...(link?.nameHash ? { nameHash: link.nameHash } : {}),
    railLinked: !!rail,
  };
};

/** The company with the party's rail address set (or cleared), and the hash of the name it was found by; untouched when no account is linked. */
export function withPartyAddress(c: Company, kind: PartyKind, id: string, address: string | undefined, nameHash?: string | null): Company {
  const rail = setPartyAddress(c.rail, kind, id, address, nameHash);
  return rail ? { ...c, rail } : c;
}

export const PARTY_RAIL_NOTE = "Documents and payments on the rail need an agreement approved by both sides; coming for vendors and customers soon.";

/**
 * Add or edit a customer or vendor. Everything here stays in the encrypted
 * vault. With an account linked in Settings, the party can carry its own
 * account on the rail (`link`), which the books keep beside the record.
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
  onSave: (input: VendorInput, railAddress: string | undefined, nameHash: string | null | undefined) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [terms, setTerms] = useState<TermsId>(initial?.terms ?? DEFAULT_TERMS);
  const [tracks1099, setTracks1099] = useState(initial?.tracks1099 ?? false);
  const [railAddress, setRailAddress] = useState(link?.address ?? "");
  // The registered name the account was found by: a hash to keep, `null` once the account is edited by hand, `undefined` when untouched.
  const [foundHash, setFoundHash] = useState<string | null | undefined>(undefined);
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
          await onSave(
            { name, email, terms, ...(kind === "vendor" ? { tracks1099 } : {}) },
            link?.railLinked ? railAddress.trim() || undefined : undefined,
            foundHash,
          );
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      {link && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-3">
          <LinkBadge status={link.status} />
          {link.status === "typed" ? "A name you entered; the books work, nothing else." : PARTY_RAIL_NOTE}
        </div>
      )}
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
      {link?.railLinked && (
        <div className="flex flex-col gap-4 sm:col-span-3">
          {link.status === "typed" && (
            <NameLookup
              allow={["worker", "business"]}
              label="Find on the registry"
              hint="Optional. Their registered name, like acme.hewn. It fills in their account below."
              onChange={(entry) => {
                if (!entry) return;
                setRailAddress(entry.address);
                setFoundHash(entry.nameHash);
              }}
            />
          )}
          <Field label="Rail address" hint={`Optional. Their account on the rail, starting aleo1. ${PARTY_RAIL_NOTE}`}>
            <input
              className={`${inputClass} font-mono text-xs sm:text-sm`}
              value={railAddress}
              onChange={(e) => {
                setRailAddress(e.target.value);
                setFoundHash(null);
              }}
              placeholder="aleo1…"
              autoComplete="off"
              spellCheck={false}
              disabled={link.status !== "typed"}
            />
          </Field>
        </div>
      )}
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
          <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !name.trim()}>
            {initial?.id ? "Save changes" : kind === "customer" ? "Add customer" : "Add vendor"}
          </Button>
        </div>
      </div>
    </form>
  );
}
