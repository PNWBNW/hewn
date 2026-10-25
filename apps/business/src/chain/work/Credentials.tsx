"use client";

// ---------------------------------------------------------------------------
// The person's credentials (docs/HEWN_ART.md, "A worker's land and its
// landmarks"): what businesses vouched for, read from this account's records
// in Shield, each with the document that came for it as a sealed page under
// the agreement's key. An offered one is accepted or declined here (one
// Shield approval); every one found goes to the vault with its status, which
// is what the landmarks on the land draw from. Loaded through a dynamic
// import from the Profile page. Nothing here logs a key, a lookup, a
// document or an error.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { CREDENTIAL_KIND_LABEL, CREDENTIAL_STATUS_LABEL, type Credential, type CredentialDocument, type CredentialStatus, credentialSpan } from "@/books/credential";
import { shortAddress } from "@/books/rail";
import { credentialFor, upsertCredential } from "@/books/work";
import { BRAND } from "@/brand";
import { ACCEPT_CREDENTIAL, type CredentialRecord, DECLINE_CREDENTIAL, awaitCredentialStatus, credentialFromRecord, credentialLookup, moveInputs, openCredentialDocument, queryCredentialStatus, readCredentialRecords } from "../credentials";
import { LetterBox, letterReader } from "../letters";
import { executeAndWait } from "./execute";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";

export type CredentialsPanelProps = { onClose: () => void };

export default function CredentialsPanel({ onClose }: CredentialsPanelProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={onClose}>{(address) => <Flow address={address} onClose={onClose} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

type Row = {
  record: CredentialRecord;
  status: CredentialStatus;
  /** The document that came for it, or why it isn't here. */
  document: CredentialDocument | null;
  problem?: string;
  employer: string;
};

function Flow({ address, onClose }: CredentialsPanelProps & { address: string }) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const letters = useRef(new LetterBox({ wallet }));
  const started = useRef(false);

  const employerOf = (issuer: string): string => work.agreements.find((a) => a.employerAddress === issuer && a.employerName)?.employerName ?? "";
  const employerLabel = (issuer: string): string => {
    const name = employerOf(issuer);
    return name ? `${name}.${BRAND.nameSuffix}` : shortAddress(issuer);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const records = await readCredentialRecords(wallet.requestRecords, address);
        const found: Row[] = [];
        for (const record of records) {
          const known = credentialFor(work, record.commitment);
          const status = (await queryCredentialStatus(record.commitment).catch(() => null)) ?? known?.status ?? "offered";
          let document: CredentialDocument | null = known?.document ?? null;
          let problem: string | undefined;
          if (!document) {
            // The document came as a sealed page from the issuer, under one of the agreements with them.
            const reader = letterReader(letters.current, record.issuer);
            for (const a of work.agreements.filter((x) => x.employerAddress === record.issuer)) {
              try {
                const bytes = await reader.get(credentialLookup(a.partiesKey, record.scope));
                if (!bytes) continue;
                document = await openCredentialDocument(a.partiesKey, record.scope, bytes);
                break;
              } catch {
                problem = "The document that came for it couldn't be read.";
              }
            }
            if (!document && !problem) problem = "Its document hasn't arrived yet. Ask them to send it again.";
          }
          if (document) {
            const kept = credentialFromRecord(record, document, status);
            if (!known || known.status !== status) await updateWork((w) => upsertCredential(w, kept));
          }
          found.push({ record, status, document, ...(problem ? { problem } : {}), employer: employerLabel(record.issuer) });
        }
        // Ones the vault knows whose record is gone (declined here, or spent): keep their status fresh too.
        for (const c of work.credentials ?? []) {
          if (found.some((r) => r.record.commitment === c.commitment) || c.status === "declined") continue;
          const status = await queryCredentialStatus(c.commitment).catch(() => null);
          if (status && status !== c.status) await updateWork((w) => upsertCredential(w, { ...c, status }));
        }
        setRows(found);
      } catch (e) {
        setError(errorMessage(e));
        setRows([]);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function answer(row: Row, accept: boolean) {
    setError(null);
    setNote(null);
    setBusy(row.record.commitment);
    try {
      const call = accept ? ACCEPT_CREDENTIAL : DECLINE_CREDENTIAL;
      await executeAndWait(wallet, { ...call, inputs: moveInputs(row.record) });
      const want: CredentialStatus = accept ? "active" : "declined";
      await awaitCredentialStatus(row.record.commitment, { until: (s) => s === want });
      if (row.document) {
        const kept: Credential = credentialFromRecord(row.record, row.document, want);
        await updateWork((w) => upsertCredential(w, kept));
      }
      setRows((rs) => (rs ?? []).map((r) => (r.record.commitment === row.record.commitment ? { ...r, status: want } : r)));
      setNote(accept ? "Accepted. It stands on your land now, in Settings." : "Declined. It leaves no mark.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) return <p className="text-sm text-muted-foreground">Checking for credentials…</p>;

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No credentials yet. A business you work for can issue one from its team list.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card text-sm">
          {rows.map((row) => (
            <li key={row.record.commitment} className="flex flex-col gap-2 px-3 py-3">
              <div>
                <div className="font-medium">{row.document ? row.document.title : CREDENTIAL_KIND_LABEL[row.record.kind]}</div>
                <div className="text-xs text-muted-foreground">
                  {row.employer} · {CREDENTIAL_KIND_LABEL[row.record.kind]}
                  {row.document && ` · ${credentialSpan(row.document)}`} · {CREDENTIAL_STATUS_LABEL[row.status]}
                </div>
                {row.document?.details && <p className="mt-1 whitespace-pre-wrap text-xs">{row.document.details}</p>}
                {row.problem && <p className="mt-1 text-xs text-destructive">{row.problem}</p>}
              </div>
              {row.status === "offered" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="min-h-11 sm:min-h-8" disabled={busy !== null || !row.document} onClick={() => void answer(row, true)}>
                    {busy === row.record.commitment ? "Approve in Shield…" : "Accept"}
                  </Button>
                  <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={busy !== null} onClick={() => void answer(row, false)}>
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="text-sm" role="status">
          {note}
        </p>
      )}
      <FormError message={error} />
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy !== null} onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
