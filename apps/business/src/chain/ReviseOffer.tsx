"use client";

// ---------------------------------------------------------------------------
// Answering a request for changes with a revised offer (Joshua, 2026-10-16):
// accept their changes as they asked, or counter back with your own. The
// offer on the chain can't be edited, so a revision is the old offer
// withdrawn (`terminate_employer_open`, one Shield approval) and a new one
// sent in its place (`create_offer_open`, a second), with the same letter
// files. Then a note in the thread tells the person which offer replaced
// which, and the team member's pay in these books follows the offer.
//
// Loaded only when tapped. Nothing here logs a key, an address or a term.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { updateWorker } from "@pnw/payroll";
import { INDUSTRY_SUFFIXES } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { ChangeList } from "@/books/NegotiationView";
import { DEFAULT_EXPIRY_DAYS, EXPIRY_DAYS, type ExpiryDays } from "@/books/offer_letter";
import { ProposalEditor, type ProposalDraft, draftOf, proposalFromDraft } from "@/books/ProposalEditor";
import { addLink, linkFor, removeLink, shortAddress } from "@/books/rail";
import { MAX_NOTE_CHARS, type Proposal, addToThread, proposalChanges, proposalOf } from "@/books/thread";
import { ShieldStatus } from "./ShieldStatus";
import { type OfferStage, fetchLatestHeight, sendOffer, withdrawOffer } from "./offer";
import { type PickedFile, pickFile } from "./offer_files";
import { useShield } from "./shield";
import { postToThread } from "./thread";

export type ReviseOfferProps = {
  workerId: string;
  /** What the person asked for; the revision starts from it. */
  proposal: Proposal;
  /** "accept": send their changes as asked; "counter": edit them first. */
  mode: "accept" | "counter";
  onClose: () => void;
};

export default function ReviseOffer(props: ReviseOfferProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <ReviseFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

type Stage = "withdrawing" | "files" | OfferStage | "noting";

const STAGE_COPY: Record<Stage, string> = {
  withdrawing: "Approve withdrawing the current offer in Shield (1 of 2)…",
  files: "Putting the files in their mailbox…",
  sealing: "Sealing the revised terms…",
  mailbox: "Putting the revised terms in their mailbox…",
  approving: "Approve the revised offer in Shield (2 of 2)…",
  sent: "Sent. Waiting for the network…",
  accepted: "Saving…",
  noting: "Telling them it's a revision…",
};

const addDays = (date: string, days: number) => {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? date : new Date(t + days * 86_400_000).toISOString().slice(0, 10);
};

function ReviseFlow({ workerId, proposal, mode: initialMode, onClose }: ReviseOfferProps) {
  const { books, payroll, rail, mailbox, updateCompany, readAttachment, discardAttachment } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const client = useMemo(() => new MailboxClient(), []);
  const link = rail ? linkFor(rail, workerId) : undefined;
  const worker = payroll.workers.find((w) => w.id === workerId);
  const current = useMemo(() => (link?.terms ? proposalOf(link.terms) : null), [link?.terms]);
  const [mode, setMode] = useState(initialMode);
  const [draft, setDraft] = useState<ProposalDraft>(() => draftOf(proposal));
  const [reviewDate, setReviewDate] = useState(link?.offerInputs?.reviewDate ?? addDays(proposal.startDate, 90));
  const [endDate, setEndDate] = useState(link?.offerInputs?.endDate ?? "");
  const [industryCode, setIndustryCode] = useState(link?.offerInputs?.industryCode ?? 1);
  const [expiresInDays, setExpiresInDays] = useState<ExpiryDays>(DEFAULT_EXPIRY_DAYS);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!rail || !link || link.status !== "offered" || !link.terms || !current || !worker) return <FormError message="There's no waiting offer to revise." />;
  if (done) {
    return (
      <>
        <p className="text-sm">{done}</p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Done
        </Button>
      </>
    );
  }
  const address = state.kind === "connected" ? state.address : null;
  if (!address) return <ShieldStatus state={state} connect={connect} onClose={onClose} />;
  if (address !== rail.address) {
    return (
      <>
        <p className="text-sm">
          Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books ({shortAddress(rail.address)}). Switch accounts
          in Shield, then try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }

  const parsed = mode === "accept" ? { proposal } : proposalFromDraft(draft);
  const revised = "proposal" in parsed ? parsed.proposal : null;
  const changes = revised ? proposalChanges(current, revised) : [];
  const files = link.terms.version === 2 ? link.terms.files : [];
  const filesKept = files.length === 0 || (link.offerFiles?.length ?? 0) === files.length;

  async function send() {
    if (!revised || !rail?.businessNameHash || !link?.terms || !worker || !address) return;
    setError(null);
    const old = link;
    const shield = {
      executeTransaction: async (opts: Parameters<typeof wallet.executeTransaction>[0]) => {
        const r = await wallet.executeTransaction(opts);
        if (!r?.transactionId) throw new Error("Shield didn't take it");
        return r;
      },
      transactionStatus: (id: string) => wallet.transactionStatus(id),
    };
    // The letter's files go with the revision: the same bytes, from these books.
    const picked: PickedFile[] = [];
    try {
      if (filesKept) {
        for (const ref of old.offerFiles ?? []) {
          const bytes = new Uint8Array(await (await readAttachment(ref)).arrayBuffer());
          picked.push(await pickFile(ref.name, ref.type, bytes));
        }
      }
    } catch (e) {
      setError(`The offer's files couldn't be read from these books: ${errorMessage(e)}`);
      return;
    }

    // 1. The current offer comes off the chain.
    setStage("withdrawing");
    try {
      await withdrawOffer({ link: old, employerNameHash: rail.businessNameHash, wallet: shield, client });
      await updateCompany((c) => (c.rail ? { ...c, rail: removeLink(c.rail, workerId) } : c));
    } catch (e) {
      setError(errorMessage(e));
      setStage(null);
      return;
    }

    // 2. The revised one goes out in its place.
    try {
      const currentHeight = await fetchLatestHeight();
      const sent = await sendOffer({
        employerAddress: address,
        employerNameHash: rail.businessNameHash,
        businessName: rail.businessName ?? books.settings.businessName,
        worker: { id: workerId, payType: revised.payType, rate: BigInt(revised.rate), frequency: revised.frequency },
        workerAddress: old.address,
        workerNameHash: old.nameHash,
        industryCode,
        termsText: revised.termsText,
        letter: revised.letter,
        files: picked,
        expiresInDays,
        // The same secret key as before, so the conversation carries on (a key from before keys were random is replaced).
        ...(old.partiesKey ? { partiesKey: old.partiesKey } : {}),
        startDate: revised.startDate,
        reviewDate,
        endDate,
        currentHeight,
        client,
        wallet: shield,
        onProgress: setStage,
      });
      const fresh = {
        ...sent.link,
        terms: sent.terms,
        offerInputs: { industryCode, reviewDate, endDate },
        ...(picked.length > 0 && old.offerFiles ? { offerFiles: old.offerFiles } : {}),
      };
      await updateCompany((c) => ({
        ...c,
        rail: c.rail ? addLink(c.rail, fresh) : c.rail,
        // The books pay what the offer says.
        payroll: updateWorker(c.payroll, workerId, { payType: revised.payType, rate: BigInt(revised.rate), frequency: revised.frequency }),
      }));

      // 3. The thread says which offer replaced which.
      setStage("noting");
      try {
        const partiesKey = sent.link.partiesKey!;
        const item = await postToThread({
          client,
          partiesKey,
          from: "business",
          nextOut: threadFor(mailbox, partiesKey)?.nextOut ?? 0,
          body: { type: "revised", agreementId: old.agreementId, newAgreementId: sent.link.agreementId, note },
        });
        await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, workerId, (t) => addToThread(t, item)) }));
        setDone(`Revised offer sent to ${worker.name}. It's in their mailbox; once they accept, they're linked.`);
      } catch {
        setDone(`Revised offer sent to ${worker.name}. The note saying it replaces the old one didn't go out, but the offer itself is there for them to accept.`);
      }
    } catch (e) {
      // The old offer is gone; without the new one the person is simply typed again.
      for (const ref of old.offerFiles ?? []) await discardAttachment(ref.attachmentId).catch(() => {});
      setError(`The current offer was withdrawn, but the revised one didn't go out: ${errorMessage(e)} Send a new offer from Team.`);
    } finally {
      setStage(null);
    }
  }

  const busy = stage !== null;
  return (
    <>
      <h4 className="text-sm font-semibold">{mode === "accept" ? `Accept ${worker.name}'s changes` : `Counter back to ${worker.name}`}</h4>
      {mode === "counter" && <ProposalEditor value={draft} onChange={setDraft} />}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">The revised offer, against the current one:</p>
        <ChangeList changes={changes} wantsLabel="Revised" />
      </div>
      {mode === "accept" && (
        <Button variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={busy} onClick={() => setMode("counter")}>
          Edit before sending
        </Button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Review date">
          <input type="date" className={inputClass} value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
        </Field>
        <Field label="End date" hint="Leave empty for open-ended.">
          <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Offer open for">
          <select className={inputClass} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value) as ExpiryDays)}>
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </Field>
        <Field label="Industry">
          <select className={inputClass} value={industryCode} onChange={(e) => setIndustryCode(Number(e.target.value))}>
            {Object.entries(INDUSTRY_SUFFIXES).map(([code, { label }]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="A note to them (optional)">
        <textarea className={`${inputClass} h-auto min-h-20 py-2`} rows={3} maxLength={MAX_NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {!filesKept && <p className="text-xs text-muted-foreground">The current offer&apos;s files aren&apos;t saved in these books, so the revised offer goes without them.</p>}
      <p className="text-xs text-muted-foreground">
        Shield asks twice: first to withdraw the current offer, then to send the revised one. Their pay in Payroll changes to match. The business pays both
        network fees.
      </p>
      {stage && <p className="text-sm text-muted-foreground">{STAGE_COPY[stage]}</p>}
      <FormError message={error ?? shieldError ?? ("problem" in parsed ? parsed.problem : null)} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || !revised || !rail.businessNameHash} onClick={() => void send()}>
          {busy ? "Working…" : "Send revised offer"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}
