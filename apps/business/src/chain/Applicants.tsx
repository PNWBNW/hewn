"use client";

// ---------------------------------------------------------------------------
// A posting's applicants, for the business (docs/JOB_BOARD.md): every
// letter under the posting's application lookup, opened with its hiring
// key; each new one becomes an applicant with a conversation, and each
// conversation's new messages are read. From an applicant: the
// conversation (the application is its first message), a status (one
// letter), an interview (a message with the time and place or link), and
// an offer (the usual offer flow, to their registered name). Loaded
// through a dynamic import from the Jobs page. Nothing here logs a key, an
// account or an application.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { queryNameOwner } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { type Applicant, type JobPosting, addApplicant, applicantWorkerId, postingById, setApplicantStatus } from "@/books/jobs";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { APPLICATION_STATUS_LABEL, type ApplicationStatus, addToThread, skipIncoming, unreadIn } from "@/books/thread";
import { BRAND } from "@/brand";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { applicantLabel, applicantOf, applicationFrom, interviewText, openApplications, statusBody } from "./applicants";
import { applicationItem, applicationLookup } from "./applications";
import { useLetters } from "./letter_reader";
import { LetterBox, letterThread } from "./letters";
import { postToThread, readThread } from "./thread";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const Conversation = dynamic(() => import("./Conversation"), { ssr: false, loading });
const OfferPanel = dynamic(() => import("./OfferPanel"), { ssr: false, loading });

export type ApplicantsProps = { posting: JobPosting; onClose: () => void };

export default function Applicants(props: ApplicantsProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <Flow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

type Open = { kind: "talk" | "status" | "interview" | "offer"; partiesKey: string };

function Flow({ posting: given, onClose }: ApplicantsProps) {
  const { jobs, mailbox, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, letters, wallet, mismatch, settled } = useLetters();
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const started = useRef(false);
  // The posting as the vault has it now (applicants and statuses change under us).
  const posting = postingById(jobs ?? undefined, given.id) ?? given;
  const applicants = posting.applicants ?? [];
  const hiring = posting.hiring;

  const check = useCallback(async () => {
    if (!letters || !hiring) return;
    setChecking(true);
    setStatus(null);
    try {
      letters.refresh();
      // 1. New applications: every letter under the posting's lookup, less the keys already known.
      const known = new Set((postingById(jobs ?? undefined, given.id)?.applicants ?? []).map((a) => a.partiesKey));
      const { found, unreadable } = await openApplications(await letters.getAll(await applicationLookup(given.id)), hiring, given.id, known);
      let added = 0;
      let unnamed = 0;
      let impostors = 0;
      for (const f of found) {
        const address = await queryNameOwner(f.message.body.nameHash);
        const from = applicationFrom(f, address);
        if (from === "unnamed") {
          unnamed++;
          continue; // no account on the registry for that name: nothing to reply to; it stays unread until there is
        }
        if (from === "not theirs" || !address) {
          impostors++;
          continue; // sent by someone other than the name's owner: never kept
        }
        const applicant = applicantOf(f, address);
        const item = applicationItem(f.message, false, new Date().toISOString());
        await updateCompany((c) => ({
          ...c,
          jobs: addApplicant(c.jobs ?? { version: 1, postings: [] }, given.id, applicant),
          mailbox: updateThread(c.mailbox ?? emptyMailbox(), applicant.partiesKey, applicantWorkerId(applicant.partiesKey), (t) => addToThread(t, item)),
        }));
        added++;
      }
      // 2. Each applicant's new messages (their side from slot 1; the application was slot 0).
      const latest = (await updateCompany((c) => c)).jobs;
      let failed: string | null = null;
      for (const a of postingById(latest ?? undefined, given.id)?.applicants ?? []) {
        const r = await readThread({
          client: letterThread(wallet, a.address, { letters }).reader,
          partiesKey: a.partiesKey,
          reader: "business",
          thread: threadFor((await updateCompany((c) => c)).mailbox, a.partiesKey),
          store: async (item) => {
            await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), a.partiesKey, applicantWorkerId(a.partiesKey), (t) => addToThread(t, item)) }));
          },
          skip: async (seq) => {
            await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), a.partiesKey, applicantWorkerId(a.partiesKey), (t) => skipIncoming(t, seq)) }));
          },
        });
        if (r.failed) failed = r.failed;
      }
      const parts: string[] = [];
      if (added > 0) parts.push(`${added} new ${added === 1 ? "applicant" : "applicants"}`);
      if (unnamed > 0) parts.push(`${unnamed} ${unnamed === 1 ? "application" : "applications"} from a name with no account yet`);
      if (impostors > 0) parts.push(`${impostors} ${impostors === 1 ? "application" : "applications"} not sent by the name's owner, left out`);
      if (unreadable > 0) parts.push(`${unreadable} ${unreadable === 1 ? "letter" : "letters"} that couldn't be opened`);
      if (failed) parts.push(`couldn't finish reading messages: ${failed}`);
      setStatus(parts.length > 0 ? parts.join("; ") + "." : "Nothing new.");
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, [letters, hiring, jobs, given.id, updateCompany, wallet]);

  // Once Shield has settled, read; then on Check.
  useEffect(() => {
    if (started.current || !settled || !letters) return;
    started.current = true;
    void check();
  }, [settled, letters, check]);

  if (!hiring) return <FormError message="This posting was made before hiring keys, so applications to it can't be read. Post it again to take applications." />;
  if (mismatch) return <p className="text-sm">Shield is on a different account than these books. Switch accounts in Shield, then try again.</p>;
  if (!letters) {
    return (
      <>
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }

  const current = open ? applicants.find((a) => a.partiesKey === open.partiesKey) : undefined;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">Applicants for “{posting.title}”</h3>
          <p className="text-xs text-muted-foreground">
            {applicants.length === 0 ? "No one yet." : `${applicants.length} ${applicants.length === 1 ? "person" : "people"}.`} Each application is a private conversation.
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-8" disabled={checking} onClick={() => void check()}>
          <RefreshCw aria-hidden className={cn(checking && "animate-spin")} /> {checking ? "Checking…" : "Check"}
        </Button>
      </div>
      {status && (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}
      {applicants.length > 0 && (
        <ul className="divide-y rounded-md border bg-card">
          {applicants.map((a) => {
            const thread = threadFor(mailbox, a.partiesKey);
            const unread = unreadIn(thread);
            const isOpen = open?.partiesKey === a.partiesKey;
            return (
              <li key={a.partiesKey} className="flex flex-col gap-3 p-3">
                <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(isOpen ? null : { kind: "talk", partiesKey: a.partiesKey })} aria-expanded={isOpen}>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>
                      {applicantLabel(a)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Applied {day(a.appliedAt)} · {APPLICATION_STATUS_LABEL[a.status ?? "applied"]}
                    </span>
                  </span>
                  {unread > 0 && (
                    <span className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground" aria-label={`${unread} unread`}>
                      {unread}
                    </span>
                  )}
                  {isOpen ? <ChevronUp aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                </button>
                {isOpen && open && (
                  <div className="flex flex-wrap gap-2">
                    {(["talk", "status", "interview", "offer"] as const).map((kind) => (
                      <Button key={kind} variant={open.kind === kind ? "default" : "outline"} size="sm" className="min-h-11 sm:min-h-8" onClick={() => setOpen({ kind, partiesKey: a.partiesKey })}>
                        {{ talk: "Conversation", status: "Set a status", interview: "Set up an interview", offer: "Send an offer" }[kind]}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {current && open?.kind === "status" && <StatusFlow posting={posting} applicant={current} onDone={() => setOpen({ kind: "talk", partiesKey: current.partiesKey })} />}
      {current && open?.kind === "interview" && <InterviewFlow posting={posting} applicant={current} onDone={() => setOpen({ kind: "talk", partiesKey: current.partiesKey })} />}
      {current && open?.kind === "offer" && (
        <OfferPanel hire={{ address: current.address, nameHash: current.nameHash, name: current.name }} onClose={() => setOpen({ kind: "talk", partiesKey: current.partiesKey })} />
      )}
      {current && open?.kind === "talk" && <ApplicantConversation applicant={current} />}
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
        Close
      </Button>
    </>
  );
}

function ApplicantConversation({ applicant }: { applicant: Applicant }) {
  const { mailbox, updateCompany } = useOpenBooks();
  const update = useCallback(
    async (change: Parameters<typeof updateThread>[3]) => {
      await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), applicant.partiesKey, applicantWorkerId(applicant.partiesKey), change) }));
    },
    [applicant.partiesKey, updateCompany],
  );
  return (
    <Conversation
      key={applicant.partiesKey}
      side="business"
      partiesKey={applicant.partiesKey}
      title={applicantLabel(applicant)}
      thread={threadFor(mailbox, applicant.partiesKey)}
      update={update}
      offersHref="/jobs?tab=offers"
      peer={applicant.address}
    />
  );
}

/** One status letter to the applicant, kept on the posting. */
function useSendToApplicant(posting: JobPosting, applicant: Applicant) {
  const { mailbox, updateCompany } = useOpenBooks();
  const { wallet } = useLetters();
  return async (body: Parameters<typeof postToThread>[0]["body"], feeMode: FeeMode, status?: ApplicationStatus) => {
    const item = await postToThread({
      client: new LetterBox({ wallet, to: applicant.address }),
      feeMode,
      partiesKey: applicant.partiesKey,
      from: "business",
      nextOut: threadFor(mailbox, applicant.partiesKey)?.nextOut ?? 0,
      body,
    });
    const now = new Date().toISOString();
    await updateCompany((c) => ({
      ...c,
      mailbox: updateThread(c.mailbox ?? emptyMailbox(), applicant.partiesKey, applicantWorkerId(applicant.partiesKey), (t) => addToThread(t, item)),
      ...(status && c.jobs ? { jobs: setApplicantStatus(c.jobs, posting.id, applicant.partiesKey, status, now) } : {}),
    }));
  };
}

const STATUS_CHOICES: ApplicationStatus[] = ["seen", "interviewing", "offer_sent", "hired", "not_selected", "closed"];

function StatusFlow({ posting, applicant, onDone }: { posting: JobPosting; applicant: Applicant; onDone: () => void }) {
  const send = useSendToApplicant(posting, applicant);
  const [choice, setChoice] = useState<ApplicationStatus>(applicant.status ?? "seen");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await send(statusBody(posting.id, choice), feeMode, choice);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3">
      <p className="text-sm font-medium">Tell {applicant.name} where things stand</p>
      <p className="text-xs text-muted-foreground">They see it under Applications. One letter, one approval.</p>
      <select className={inputClass} value={choice} onChange={(e) => setChoice(e.target.value as ApplicationStatus)} disabled={busy}>
        {STATUS_CHOICES.map((s) => (
          <option key={s} value={s}>
            {APPLICATION_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield…</p> : <FeeChoice value={feeMode} onChange={setFeeMode} compact />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void go()}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function InterviewFlow({ posting, applicant, onDone }: { posting: JobPosting; applicant: Applicant; onDone: () => void }) {
  const send = useSendToApplicant(posting, applicant);
  const [when, setWhen] = useState("");
  const [where, setWhere] = useState("");
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      // The interview as a message, then the status: two letters, two approvals.
      await send({ type: "text", text: interviewText(when, where, note) }, feeMode);
      await send(statusBody(posting.id, "interviewing"), feeMode, "interviewing");
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3">
      <p className="text-sm font-medium">Set up an interview with {applicant.name}</p>
      <p className="text-xs text-muted-foreground">
        Goes as a message, and marks them Interviewing. For a video call, put the meeting link (Teams, Meet, whatever you use) under where.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="When">
          <input className={inputClass} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Where, or a meeting link">
          <input className={inputClass} value={where} onChange={(e) => setWhere(e.target.value)} disabled={busy} />
        </Field>
      </div>
      <Field label="Anything else (optional)">
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      </Field>
      {busy ? <p className="text-sm text-muted-foreground">Approve each letter in Shield (two)…</p> : <FeeChoice value={feeMode} onChange={setFeeMode} compact />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || !when.trim()} onClick={() => void go()}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
