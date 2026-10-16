"use client";

// ---------------------------------------------------------------------------
// Checking for offers: the person's agreement records from Shield, the
// employer's registered name from the registry (best effort), the terms from
// the mailbox (slot 0), verified against the record's terms_doc_hash, and
// Accept, which signs `accept_job_offer` in Shield. Every agreement found is
// written to the vault so the Offers page lists it without Shield; terms are
// kept only once they verify, and the pin is dropped once the acceptance is
// on the chain. An offer letter's files are collected with the terms, each
// checked against the fingerprint inside them and saved in the vault; Accept
// waits until every file is in and the person says they've read it all.
// Nothing here logs a record, a key or an address.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { AttachmentRef } from "@pnw/sales";
import { MailboxClient } from "@pnw/mailbox";
import { checkAgreementStatus } from "@pnw/records/agreement_reader";
import { queryNamePlaintext } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { type AgreementStatus, type Terms, type WorkAgreement, agreementFor, updateWorkThread, upsertAgreement, workThread } from "@/books/work";
import { ChangeList, QuotedNote } from "@/books/NegotiationView";
import { addToThread, answerFor, openCounter, proposalChanges, proposalOf, revisedFrom, revisionOf, skipIncoming } from "@/books/thread";
import { BRAND } from "@/brand";
import { LetterSections, OfferFileList } from "@/books/OfferLetterView";
import { employmentLabel, hoursLine } from "@/books/terms_words";
import { expiryLabel, hasLetter, isExpired } from "@/books/offer_letter";
import { fetchOfferFile, offerFileLookups } from "../offer_files";
import { offerReceiptSlot, sendReceipt } from "../receipts";
import { readThread } from "../thread";
import { ACCEPT, type AgreementRecord, acceptInputs, readAgreementRecords } from "./agreements";
import { executeAndWait } from "./execute";
import { TERMS_MISMATCH, type TermsFetch, fetchTerms, termsMatchRecord } from "./terms";
import { LetterBox, letterThread, lettersThenMailbox } from "../letters";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";

export type OffersPanelProps = { onClose: () => void };

const CounterOffer = dynamic(() => import("./CounterOffer"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

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
  /** The offer letter's files saved in the vault, one per file in the terms (empty when there are none). */
  files: AttachmentRef[];
  /** Why the files aren't all here yet, if they aren't. */
  filesProblem?: string;
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
  if (row.files.length > 0) a.files = row.files;
  if (row.verified && row.terms.terms) a.terms = row.terms.terms;
  if (acceptedAt) a.acceptedAt = acceptedAt;
  else if (previous?.acceptedAt) a.acceptedAt = previous.acceptedAt;
  return a;
}

function OffersFlow({ address, onClose }: { address: string; onClose: () => void }) {
  const { work, updateWork, addAttachment, readAttachment } = useWork();
  const { wallet } = useWorkShield();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // agreement id being accepted
  const [note, setNote] = useState<string | null>(null);
  const client = useRef(new MailboxClient());
  // Offers' terms come as sealed pages on the network; older offers' from the mailbox.
  const letters = useRef(new LetterBox({ wallet }));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const records = await readAgreementRecords(wallet.requestRecords, address);
        // Each employer's side of the conversation first, so a revised offer knows what it replaced.
        for (const [partiesKey, employer] of new Map(records.map((r) => [r.partiesKey, r.employerAddress]))) {
          await readThread({
            client: letterThread(wallet, employer, { letters: letters.current, mailbox: client.current }).reader,
            partiesKey,
            reader: "worker",
            thread: workThread(work, partiesKey),
            store: async (item) => {
              await updateWork((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item)));
            },
            skip: async (seq) => {
              await updateWork((w) => updateWorkThread(w, partiesKey, (t) => skipIncoming(t, seq)));
            },
          });
        }
        const found: Row[] = [];
        for (const record of records) {
          const previous = agreementFor(work, record.agreementId);
          let status: AgreementStatus = record.kind === "pending" ? "pending" : "active";
          const onChain = await checkAgreementStatus(record.agreementId).catch(() => null);
          if (record.kind === "final") status = STATUS_OF[onChain ?? "active"] ?? "active";
          else if (onChain === "terminated") status = "terminated"; // withdrawn before it was accepted
          const employerName = previous?.employerName ?? ((await queryNamePlaintext(record.employerNameHash).catch(() => null)) || undefined);
          // Terms already in the vault are used as long as they still hash to the record; otherwise the mailbox.
          const kept: Terms | undefined = previous?.terms && termsMatchRecord(previous.terms, record.termsDocHash) ? previous.terms : undefined;
          const terms: TermsFetch = kept ? { terms: kept, lookup: "" } : await fetchTerms(record.partiesKey, record.agreementId, lettersThenMailbox(letters.current, client.current));
          const verified = !!terms.terms && termsMatchRecord(terms.terms, record.termsDocHash);
          const row: Row = { record, status, terms, verified, files: [] };
          const t = terms.terms;
          if (status === "pending" && verified && t?.version === 2 && isExpired(t.expiresAt)) {
            // Expired without an answer: it can't be accepted, so its documents come out of the mailbox.
            if (terms.lookup) await client.current.drop(terms.lookup).catch(() => {});
            for (const lookup of t.files.length > 0 ? offerFileLookups(record.partiesKey, t.agreementId, t.files) : []) await client.current.drop(lookup).catch(() => {});
            found.push(row);
            continue;
          }
          if (status === "pending" && verified && t?.version === 2 && !kept) {
            // First time this device sees the offer: the business learns it arrived.
            const slot = offerReceiptSlot(t.agreementId);
            await sendReceipt(client.current, record.partiesKey, slot.kind, slot.seq);
          }
          // The letter's files: kept copies first, the mailbox for the rest, each checked against the terms.
          if (verified && terms.terms?.version === 2 && terms.terms.files.length > 0) {
            const offered = terms.terms.files;
            const kept = new Map((previous?.files ?? []).map((f) => [f.sha256, f]));
            try {
              for (const [i, f] of offered.entries()) {
                const have = kept.get(f.sha256);
                if (have) {
                  row.files.push(have);
                  continue;
                }
                const { bytes } = await fetchOfferFile(client.current, record.partiesKey, terms.terms.agreementId, offered, i);
                row.files.push(await addAttachment(new File([bytes], f.name, { type: f.type })));
              }
            } catch (e) {
              row.filesProblem = errorMessage(e);
            }
          }
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
    const t = row.terms.terms;
    if (t?.version === 2 && isExpired(t.expiresAt)) {
      setError("This offer has expired. Ask them to send a new one.");
      return;
    }
    setBusy(row.record.agreementId);
    setError(null);
    setNote("Approve the acceptance in Shield, then wait for the network. This can take a minute or two.");
    try {
      const seconds = Math.floor(Date.now() / 1000);
      await executeAndWait(wallet, { ...ACCEPT, inputs: acceptInputs(row.record, seconds) });
      const accepted: Row = { ...row, status: "active", record: { ...row.record, kind: "final" } };
      await updateWork((w) => upsertAgreement(w, toAgreement(accepted, agreementFor(w, row.record.agreementId), new Date(seconds * 1000).toISOString())));
      if (row.terms.lookup) await client.current.drop(row.terms.lookup).catch(() => {}); // the vault has the terms now
      const t = row.terms.terms;
      if (t?.version === 2 && t.files.length > 0) {
        // The vault has every file too: the pieces can go.
        for (const lookup of offerFileLookups(row.record.partiesKey, t.agreementId, t.files)) await client.current.drop(lookup).catch(() => {});
      }
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
            <OfferRow
              key={row.record.agreementId}
              row={row}
              busy={busy === row.record.agreementId}
              disabled={busy !== null}
              onAccept={() => void accept(row)}
              read={readAttachment}
            />
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

function OfferRow({
  row,
  busy,
  disabled,
  onAccept,
  read,
}: {
  row: Row;
  busy: boolean;
  disabled: boolean;
  onAccept: () => void;
  read: (ref: AttachmentRef) => Promise<Blob>;
}) {
  const { record, status, terms, verified } = row;
  const { work } = useWork();
  const [readIt, setReadIt] = useState(false);
  const [countering, setCountering] = useState(false);
  const thread = workThread(work, record.partiesKey);
  const counter = openCounter(thread, record.agreementId);
  const answer = answerFor(thread, record.agreementId);
  const replaced = revisedFrom(thread, record.agreementId);
  const revisedTo = thread?.items.some((i) => i.body.type === "revised" && i.body.agreementId === record.agreementId);
  const previous = replaced ? agreementFor(work, replaced)?.terms : undefined;
  const revisedNote = revisionOf(thread, record.agreementId)?.body.note ?? "";
  const letter = terms.terms?.version === 2 ? terms.terms : null;
  const offeredFiles = letter?.files ?? [];
  const filesIn = offeredFiles.length === row.files.length;
  const needsReading = !!letter && (hasLetter(letter.letter) || offeredFiles.length > 0);
  const expired = status === "pending" && !!letter && isExpired(letter.expiresAt);
  const ready = verified && filesIn && !row.filesProblem && (!needsReading || readIt) && !expired;
  const employer = row.employerName ? `${row.employerName}.${BRAND.nameSuffix}` : shortAddress(record.employerAddress);
  const t = terms.terms;
  return (
    <li className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{employer}</span>
        <span className={status === "pending" ? "text-xs text-primary" : "text-xs text-muted-foreground"}>
          {status === "terminated" && record.kind === "pending" ? (revisedTo ? "Replaced by a revised offer" : "Withdrawn") : STATUS_LABEL[status]}
        </span>
      </div>
      {t && verified ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Business</dt>
          <dd>{t.businessName}</dd>
          <dt className="text-muted-foreground">Pay</dt>
          <dd>{t.payType === "hourly" ? `${dollars(t.rate)} per hour` : `${dollars(t.rate)} per year`}</dd>
          <dt className="text-muted-foreground">Paid</dt>
          <dd>{FREQUENCY[t.frequency]}</dd>
          {t.version === 2 && t.employmentType && (
            <>
              <dt className="text-muted-foreground">Employment</dt>
              <dd>{employmentLabel(t.employmentType)}</dd>
            </>
          )}
          {t.version === 2 && t.hoursPerWeek && (
            <>
              <dt className="text-muted-foreground">Hours</dt>
              <dd>{hoursLine(t.hoursPerWeek)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Starts</dt>
          <dd>{t.startDate}</dd>
          <dt className="text-muted-foreground">Terms</dt>
          <dd className="whitespace-pre-wrap">{t.termsText}</dd>
        </dl>
      ) : null}
      {t && verified && letter ? (
        <>
          <LetterSections letter={letter.letter} />
          <OfferFileList
            files={offeredFiles}
            {...(filesIn && !row.filesProblem ? { read: (i: number) => read(row.files[i]!) } : {})}
            missing={row.filesProblem ?? "The files haven't arrived yet."}
          />
        </>
      ) : t && verified ? null : t ? (
        <p className="text-xs text-destructive">{TERMS_MISMATCH}. Ask the employer to send the offer again.</p>
      ) : (
        <p className="text-xs text-muted-foreground">{terms.terms === null ? terms.message : ""}</p>
      )}
      {replaced && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 p-2">
          <p className="text-xs font-medium">Revised offer: it replaces the one you asked to change.</p>
          {previous && t && verified && <ChangeList changes={proposalChanges(proposalOf(previous), proposalOf(t))} wantsLabel="Now" />}
          <QuotedNote who={employer} text={revisedNote} />
        </div>
      )}
      {status === "pending" && answer?.body.type === "stands" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs">They kept this offer as it is.</p>
          <QuotedNote who={employer} text={answer.body.note} />
        </div>
      )}
      {status === "pending" && counter && <p className="text-xs text-muted-foreground">You asked for changes on {counter.sentAt.slice(0, 10)}. Waiting for their answer.</p>}
      {status === "pending" && letter && (
        <p className={expired ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {expired
            ? `This offer expired on ${letter.expiresAt.slice(0, 10)} without an answer. Ask them to send a new one if you're still interested.`
            : `${expiryLabel(letter.expiresAt)}: accept before then.`}
        </p>
      )}
      {status === "pending" && !expired && (
        <div className="flex flex-wrap items-center gap-3">
          {verified && filesIn && !row.filesProblem && needsReading && (
            <label className="flex min-h-11 w-full items-center gap-3 text-sm sm:min-h-8">
              <input type="checkbox" className="size-5 accent-primary" checked={readIt} onChange={(e) => setReadIt(e.target.checked)} />
              I&apos;ve read the offer letter{offeredFiles.length > 0 ? " and the attached files" : ""}.
            </label>
          )}
          <Button className="min-h-11 sm:min-h-9" disabled={disabled || !ready} onClick={onAccept}>
            {busy ? "Accepting…" : "Accept"}
          </Button>
          {verified && t && !countering && (
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={disabled} onClick={() => setCountering(true)}>
              {counter ? "Ask for different changes" : "Ask for changes"}
            </Button>
          )}
          {!verified && <span className="text-xs text-muted-foreground">You can accept once the terms arrive and match.</span>}
          {verified && (!filesIn || row.filesProblem) && <span className="text-xs text-muted-foreground">You can accept once every file has arrived.</span>}
        </div>
      )}
      {countering && t && (
        <CounterOffer
          agreementId={record.agreementId}
          partiesKey={record.partiesKey}
          terms={t}
          employer={employer}
          employerAddress={record.employerAddress}
          onClose={() => setCountering(false)}
        />
      )}
    </li>
  );
}
