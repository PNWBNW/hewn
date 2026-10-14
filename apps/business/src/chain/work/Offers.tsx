"use client";

// ---------------------------------------------------------------------------
// Checking for offers: the person's agreement records from Shield, the
// employer's registered name from the registry (best effort), the terms from
// the mailbox (slot 0), verified against the record's terms_doc_hash, and
// Accept, which signs `accept_job_offer` in Shield. Every agreement found is
// written to the vault so the Offers page lists it without Shield; terms are
// kept only once they verify, and the pin is dropped once the acceptance is
// on the chain. Nothing here logs a record, a key or an address.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { checkAgreementStatus } from "@pnw/records/agreement_reader";
import { queryNamePlaintext } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { type AgreementStatus, type Terms, type WorkAgreement, agreementFor, upsertAgreement } from "@/books/work";
import { BRAND } from "@/brand";
import { ACCEPT, type AgreementRecord, acceptInputs, readAgreementRecords } from "./agreements";
import { executeAndWait } from "./execute";
import { TERMS_MISMATCH, type TermsFetch, fetchTerms, termsMatchRecord } from "./terms";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";

export type OffersPanelProps = { onClose: () => void };

export default function OffersPanel({ onClose }: OffersPanelProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={onClose}>{(address) => <OffersFlow address={address} onClose={onClose} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

type Row = {
  record: AgreementRecord;
  status: AgreementStatus;
  employerName?: string;
  terms: TermsFetch;
  /** The terms hash to what the record commits to. */
  verified: boolean;
};

const STATUS_OF: Record<string, AgreementStatus> = { active: "active", paused: "paused", terminated: "terminated" };

/** The vault's copy of one found agreement: status, name and (verified) terms. */
function toAgreement(row: Row, previous: WorkAgreement | undefined, acceptedAt?: string): WorkAgreement {
  const a: WorkAgreement = {
    agreementId: row.record.agreementId,
    partiesKey: row.record.partiesKey,
    employerAddress: row.record.employerAddress,
    employerNameHash: row.record.employerNameHash,
    status: row.status,
  };
  if (row.employerName) a.employerName = row.employerName;
  if (row.verified && row.terms.terms) a.terms = row.terms.terms;
  if (acceptedAt) a.acceptedAt = acceptedAt;
  else if (previous?.acceptedAt) a.acceptedAt = previous.acceptedAt;
  return a;
}

function OffersFlow({ address, onClose }: { address: string; onClose: () => void }) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // agreement id being accepted
  const [note, setNote] = useState<string | null>(null);
  const client = useRef(new MailboxClient());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const records = await readAgreementRecords(wallet.requestRecords, address);
        const found: Row[] = [];
        for (const record of records) {
          const previous = agreementFor(work, record.agreementId);
          let status: AgreementStatus = record.kind === "pending" ? "pending" : "active";
          if (record.kind === "final") status = STATUS_OF[(await checkAgreementStatus(record.agreementId).catch(() => null)) ?? "active"] ?? "active";
          const employerName = previous?.employerName ?? ((await queryNamePlaintext(record.employerNameHash).catch(() => null)) || undefined);
          // Terms already in the vault are used as long as they still hash to the record; otherwise the mailbox.
          const kept: Terms | undefined = previous?.terms && termsMatchRecord(previous.terms, record.termsDocHash) ? previous.terms : undefined;
          const terms: TermsFetch = kept ? { terms: kept, lookup: "" } : await fetchTerms(record.partiesKey, client.current);
          const verified = !!terms.terms && termsMatchRecord(terms.terms, record.termsDocHash);
          const row: Row = { record, status, terms, verified };
          if (employerName) row.employerName = employerName;
          found.push(row);
        }
        // Everything found goes to the vault, so the list stands without Shield.
        await updateWork((w) => found.reduce((acc, row) => upsertAgreement(acc, toAgreement(row, agreementFor(acc, row.record.agreementId))), w));
        setRows(found);
      } catch (e) {
        setError(errorMessage(e));
        setRows([]);
      }
    })();
  }, [address, wallet.requestRecords, work, updateWork]);

  async function accept(row: Row) {
    setBusy(row.record.agreementId);
    setError(null);
    setNote("Approve the acceptance in Shield, then wait for the network. This can take a minute or two.");
    try {
      const seconds = Math.floor(Date.now() / 1000);
      await executeAndWait(wallet, { ...ACCEPT, inputs: acceptInputs(row.record, seconds) });
      const accepted: Row = { ...row, status: "active", record: { ...row.record, kind: "final" } };
      await updateWork((w) => upsertAgreement(w, toAgreement(accepted, agreementFor(w, row.record.agreementId), new Date(seconds * 1000).toISOString())));
      if (row.terms.lookup) await client.current.drop(row.terms.lookup).catch(() => {}); // the vault has the terms now
      setRows((all) => (all ?? []).map((r) => (r.record.agreementId === row.record.agreementId ? accepted : r)));
      setNote("Accepted. You can clock in from Home.");
    } catch (e) {
      setError(errorMessage(e));
      setNote(null);
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) {
    return <p className="text-sm text-muted-foreground">{error ? "Couldn't read your agreements." : "Reading your agreements…"}</p>;
  }

  return (
    <>
      <p className="text-sm">
        {rows.length === 0 ? "No offers or agreements in this account yet." : `${rows.length} ${rows.length === 1 ? "agreement" : "agreements"} found.`}
      </p>
      {rows.length > 0 && (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((row) => (
            <OfferRow key={row.record.agreementId} row={row} busy={busy === row.record.agreementId} disabled={busy !== null} onAccept={() => void accept(row)} />
          ))}
        </ul>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <FormError message={error} />
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy !== null} onClick={onClose}>
        {busy ? "Keep open" : "Done"}
      </Button>
    </>
  );
}

const STATUS_LABEL: Record<AgreementStatus, string> = { pending: "Waiting for you", active: "Active", paused: "Paused", terminated: "Ended" };
const FREQUENCY: Record<Terms["frequency"], string> = { weekly: "weekly", biweekly: "every two weeks", semimonthly: "twice a month", monthly: "monthly" };

const dollars = (cents: string) => `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function OfferRow({ row, busy, disabled, onAccept }: { row: Row; busy: boolean; disabled: boolean; onAccept: () => void }) {
  const { record, status, terms, verified } = row;
  const employer = row.employerName ? `${row.employerName}.${BRAND.nameSuffix}` : shortAddress(record.employerAddress);
  const t = terms.terms;
  return (
    <li className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{employer}</span>
        <span className={status === "pending" ? "text-xs text-primary" : "text-xs text-muted-foreground"}>{STATUS_LABEL[status]}</span>
      </div>
      {t && verified ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Business</dt>
          <dd>{t.businessName}</dd>
          <dt className="text-muted-foreground">Pay</dt>
          <dd>{t.payType === "hourly" ? `${dollars(t.rate)} per hour` : `${dollars(t.rate)} per year`}</dd>
          <dt className="text-muted-foreground">Paid</dt>
          <dd>{FREQUENCY[t.frequency]}</dd>
          <dt className="text-muted-foreground">Starts</dt>
          <dd>{t.startDate}</dd>
          <dt className="text-muted-foreground">Terms</dt>
          <dd className="whitespace-pre-wrap">{t.termsText}</dd>
        </dl>
      ) : t ? (
        <p className="text-xs text-destructive">{TERMS_MISMATCH}. Ask the employer to send the offer again.</p>
      ) : (
        <p className="text-xs text-muted-foreground">{terms.terms === null ? terms.message : ""}</p>
      )}
      {status === "pending" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={disabled || !verified} onClick={onAccept}>
            {busy ? "Accepting…" : "Accept"}
          </Button>
          {!verified && <span className="text-xs text-muted-foreground">You can accept once the terms arrive and match.</span>}
        </div>
      )}
    </li>
  );
}
