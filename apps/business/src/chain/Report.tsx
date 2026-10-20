"use client";

// ---------------------------------------------------------------------------
// Reporting one received message (books/report.ts): pick what's wrong, add a
// note, and send it to Hewn as a sealed letter (chain/report.ts, one Shield
// approval). Unless it's about harassment, the sender then gets a notice in
// the conversation (a second approval), so a person whose account was taken
// over finds out. Either way the report can be emailed to Hewn's support
// address or copied, and it's suggested: an email reaches someone even when
// the network or Shield doesn't.
// Lives inside a conversation (Conversation.tsx), which passes its way of
// sending. Nothing here logs a report, a note or an account.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { Button } from "@pnw/ui/button";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import {
  MAX_REPORT_NOTE,
  REPORT_CATEGORIES,
  REPORT_LABEL,
  type Report as ReportData,
  type ReportCategory,
  type ReportPlace,
  notifiesSender,
  reportMailto,
  reportText,
  validateReport,
} from "@/books/report";
import { type Side, type ThreadItem, newMessageId } from "@/books/thread";
import { BRAND } from "@/brand";
import { LetterBox, type LetterWallet } from "./letters";
import { packReport, reportLookup } from "./report";
import { type PostInput, type ThreadKinds, postToThread } from "./thread";

export type ReportProps = {
  item: ThreadItem;
  /** Who sent it, as this app names them, and their account when it's known. */
  name: string;
  account?: string;
  place: ReportPlace;
  /** Shield, when it's connected to this account: the report goes as a letter. Without it, email or copy only. */
  wallet: LetterWallet | null;
  /** The conversation's own way of sending, for the notice to the sender; null when it can't send now. */
  notice: { client: PostInput["client"]; partiesKey: string; side: Side; nextOut: number; kinds?: ThreadKinds } | null;
  feeMode: FeeMode;
  /** Keeps the outcome: the message marked reported, and the notice when one went. */
  onDone: (category: ReportCategory, notice?: ThreadItem) => Promise<void>;
  onClose: () => void;
};

type Step = { kind: "form" } | { kind: "sending"; what: string } | { kind: "done"; report: ReportData; sentToHewn: boolean; told: boolean };

/** The words of a message as a report carries them. */
function wordsOf(item: ThreadItem): string {
  const b = item.body;
  if (b.type === "text" || b.type === "group_text") return b.text;
  if (b.type === "application") return b.message || "(An application with no message)";
  return "";
}

export function Report({ item, name, account, place, wallet, notice, feeMode, onDone, onClose }: ReportProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState("");
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function build(c: ReportCategory): ReportData {
    return validateReport({
      version: 1,
      id: newMessageId(),
      category: c,
      note,
      reportedAt: new Date().toISOString(),
      place,
      about: { name, ...(account ? { account } : {}) },
      message: { id: item.id, sentAt: item.sentAt, text: wordsOf(item) },
    });
  }

  /** Tells the sender, unless it's harassment. Returns the notice as the thread keeps it. */
  async function tell(c: ReportCategory): Promise<ThreadItem | undefined> {
    if (!notice || !notifiesSender(c)) return undefined;
    setStep({ kind: "sending", what: `Approve the notice to ${name} in Shield.` });
    return postToThread({
      client: notice.client,
      partiesKey: notice.partiesKey,
      from: notice.side,
      nextOut: notice.nextOut,
      body: { type: "report_notice", messageId: item.id, category: c },
      feeMode,
      ...(notice.kinds ? { kinds: notice.kinds } : {}),
    });
  }

  async function submit(viaHewn: boolean) {
    if (!category) {
      setError("Pick what's wrong");
      return;
    }
    setError(null);
    let report: ReportData;
    try {
      report = build(category);
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    let sentToHewn = false;
    if (viaHewn && wallet) {
      try {
        setStep({ kind: "sending", what: "Approve the report to Hewn in Shield; it's on the network in about a minute." });
        const box = new LetterBox({ wallet, to: BRAND.reportsAccount });
        await box.put(await reportLookup(report.id), await packReport(report), { feeMode });
        sentToHewn = true;
      } catch (e) {
        // Nothing went: back to the form, where emailing it is still there.
        setError(errorMessage(e));
        setStep({ kind: "form" });
        return;
      }
    }
    // From here the report counts as made: a notice that fails doesn't undo it or send it twice.
    let told: ThreadItem | undefined;
    try {
      told = await tell(category);
    } catch (e) {
      setError(`The notice to ${name} didn't go: ${errorMessage(e)}`);
    }
    try {
      await onDone(category, told);
    } catch (e) {
      setError(errorMessage(e));
    }
    setStep({ kind: "done", report, sentToHewn, told: !!told });
  }

  async function copy(r: ReportData) {
    try {
      await navigator.clipboard.writeText(reportText(r));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy here; use Email instead");
    }
  }

  if (step.kind === "done") {
    const r = step.report;
    return (
      <div className="flex w-full max-w-[90%] flex-col gap-3 rounded-md border bg-card p-3 text-sm">
        <p className="font-medium">{step.sentToHewn ? "Reported to Hewn." : "Marked as reported."}</p>
        <p className="text-muted-foreground">
          {notifiesSender(r.category)
            ? step.told
              ? `${name} got a notice that a message was reported, in case someone else is using their account.`
              : `${name} wasn't told: the notice couldn't be sent.`
            : `${name} isn't told about a harassment report.`}
        </p>
        <p>
          {step.sentToHewn ? "Also email it to Hewn" : "Now send it to Hewn"} at <span className="font-medium">{BRAND.supportEmail}</span>
          {step.sentToHewn ? ": it reaches a person even if the letter is slow, and you keep a copy." : ", or copy it to send another way."}
        </p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-3">
          <Button asChild className="min-h-11 sm:min-h-9">
            <a href={reportMailto(r, BRAND.supportEmail)}>
              <Mail aria-hidden /> Email it
            </a>
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void copy(r)}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy report"}
          </Button>
          <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const busy = step.kind === "sending";
  return (
    <div className="flex w-full max-w-[90%] flex-col gap-3 rounded-md border bg-card p-3 text-sm">
      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <legend className="mb-1 font-medium">What&apos;s wrong with this message?</legend>
        {REPORT_CATEGORIES.map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-2 sm:min-h-8">
            <input type="radio" name={`report-${item.id}`} className="size-4 accent-[var(--hewn-green)]" checked={category === c} onChange={() => setCategory(c)} />
            {REPORT_LABEL[c]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Anything Hewn should know (optional)</span>
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} maxLength={MAX_REPORT_NOTE} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">
        Hewn sees this message, who sent it, your note and your account. Nothing else from the conversation.{" "}
        {category === null
          ? `${name} is told a message was reported, unless it's harassment.`
          : notifiesSender(category)
            ? `${name} gets a notice that a message was reported, in case someone else is using their account.`
            : `${name} isn't told.`}
      </p>
      {busy && <p className="text-sm text-muted-foreground">{step.what}</p>}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        {wallet && (
          <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void submit(true)}>
            {busy ? "Sending…" : "Report to Hewn"}
          </Button>
        )}
        <Button variant={wallet ? "outline" : "default"} className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void submit(false)}>
          {wallet ? "Email it instead" : "Report by email"}
        </Button>
        <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
