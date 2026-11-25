"use client";

// ---------------------------------------------------------------------------
// Applying to a posting from the board (docs/JOB_BOARD.md): the person's
// registered name, a message and their resume as text, sealed to the
// business with a key only the two of them can make (applications.ts) and
// sent as one letter (one Shield approval). A resume builder fills the text
// for someone who hasn't one. The application is kept in the vault as the
// first message of a conversation with that business. Nothing here logs a
// key, an address or what was written.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { queryNameOwner } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { type Resume, type ResumeEntry, emptyEntry, emptyResume, resumeText } from "@/books/resume";
import { MAX_APPLICATION_CHARS, MAX_RESUME_CHARS, addToThread, newMessageId, validateMessage } from "@/books/thread";
import { addApplication, updateWorkThread } from "@/books/work";
import { BRAND } from "@/brand";
import { FeeChoice } from "../FeeChoice";
import { applicantKey, applicationItem, applicationLookup, packApplication } from "../applications";
import type { BoardEntry } from "../board";
import { LetterBox } from "../letters";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";
import { MailboxError } from "@pnw/mailbox";

export type ApplyProps = { entry: BoardEntry; onClose: () => void; onApplied?: () => void };

export default function Apply(props: ApplyProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={props.onClose}>{() => <ApplyFlow {...props} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

function ApplyFlow({ entry, onClose, onApplied }: ApplyProps) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [message, setMessage] = useState("");
  const [resume, setResume] = useState("");
  const [building, setBuilding] = useState(false);
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = work.profile;
  const title = entry.body?.title ?? "this posting";
  const business = entry.businessName ? `${entry.businessName}.${BRAND.nameSuffix}` : "the business";

  if (!profile) return <FormError message="Register your name first (Profile), so the business knows who is applying." />;
  if (!entry.body?.hiringKey) return <FormError message="This posting can't take applications from here." />;
  const hiringKey = entry.body.hiringKey;

  async function send() {
    if (!profile) return;
    setError(null);
    try {
      setProgress("Finding the business…");
      const employerAddress = await queryNameOwner(entry.employerNameHash);
      if (!employerAddress) throw new Error("The business's account couldn't be found on the registry; try again in a moment");
      setProgress("Sealing your application…");
      const { partiesKey, oneTimePublicKey } = await applicantKey(hiringKey, entry.id);
      const sentAt = new Date().toISOString();
      const msg = validateMessage(
        { version: 1, id: newMessageId(), from: "worker", sentAt, body: { type: "application", postingId: entry.id, name: profile.name, nameHash: profile.nameHash, message, resume } },
        "worker",
      );
      const parcel = await packApplication(partiesKey, oneTimePublicKey, msg);
      setProgress("Approve it in Shield…");
      try {
        await new LetterBox({ wallet, to: employerAddress }).put(await applicationLookup(entry.id), parcel, { feeMode });
      } catch (e) {
        if (e instanceof MailboxError && e.code === "CONFLICT") throw new Error("You already applied to this posting from this account.");
        throw e;
      }
      await updateWork((w) =>
        updateWorkThread(
          addApplication(w, {
            postingId: entry.id,
            employerNameHash: entry.employerNameHash,
            ...(entry.businessName ? { employerName: entry.businessName } : {}),
            employerAddress,
            title,
            partiesKey,
            sentAt,
          }),
          partiesKey,
          (t) => addToThread(t, applicationItem(msg, true)),
        ),
      );
      onApplied?.();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Apply for {title}</h3>
        <p className="text-xs text-muted-foreground">
          Goes to {business} as <span className="font-medium">{profile.name}.{BRAND.nameSuffix}</span>, sealed so only they can read it. One letter, one approval in
          Shield; nothing about it is public.
        </p>
      </div>
      <Field label="A message to them (optional)" hint={`${message.length.toLocaleString("en-US")} of ${MAX_APPLICATION_CHARS.toLocaleString("en-US")} characters.`}>
        <textarea className={`${inputClass} h-auto min-h-24 py-2`} rows={4} maxLength={MAX_APPLICATION_CHARS} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} />
      </Field>
      <Field label="Your resume" hint={`As text. ${resume.length.toLocaleString("en-US")} of ${MAX_RESUME_CHARS.toLocaleString("en-US")} characters. Paste one in, or build one below.`}>
        <textarea className={`${inputClass} h-auto min-h-48 py-2 font-mono text-xs`} rows={12} maxLength={MAX_RESUME_CHARS} value={resume} onChange={(e) => setResume(e.target.value)} disabled={busy} />
      </Field>
      {building ? (
        <ResumeBuilder
          name={work.displayName}
          onDone={(text) => {
            setResume(text);
            setBuilding(false);
          }}
          onCancel={() => setBuilding(false)}
        />
      ) : (
        <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={busy} onClick={() => setBuilding(true)}>
          {resume.trim() ? "Rebuild from a few questions" : "No resume? Build one from a few questions"}
        </Button>
      )}
      {busy ? <p className="text-sm text-muted-foreground">{progress}</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || building || !resume.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : "Send the application"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/** A few questions that become resume text; the person edits the text afterwards. */
function ResumeBuilder({ name, onDone, onCancel }: { name: string; onDone: (text: string) => void; onCancel: () => void }) {
  const [r, setR] = useState<Resume>(() => emptyResume(name));
  const set = (patch: Partial<Resume>) => setR({ ...r, ...patch });
  const setEntry = (list: "experience" | "education", i: number, patch: Partial<ResumeEntry>) => set({ [list]: r[list].map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const add = (list: "experience" | "education") => set({ [list]: [...r[list], emptyEntry()] });
  const remove = (list: "experience" | "education", i: number) => set({ [list]: r[list].filter((_, j) => j !== i) });
  const text = resumeText(r);

  const entries = (list: "experience" | "education", whatLabel: string, placeLabel: string) => (
    <div className="flex flex-col gap-3">
      {r[list].map((e, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={inputClass} placeholder={whatLabel} value={e.what} onChange={(ev) => setEntry(list, i, { what: ev.target.value })} />
            <input className={inputClass} placeholder={placeLabel} value={e.place} onChange={(ev) => setEntry(list, i, { place: ev.target.value })} />
            <input className={inputClass} placeholder="When (2022 to now)" value={e.when} onChange={(ev) => setEntry(list, i, { when: ev.target.value })} />
          </div>
          <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} placeholder="What you did there" value={e.notes} onChange={(ev) => setEntry(list, i, { notes: ev.target.value })} />
          <Button variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => remove(list, i)}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => add(list)}>
        Add {list === "experience" ? "a job" : "schooling or a qualification"}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3">
      <p className="text-sm font-medium">Build a resume</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name">
          <input className={inputClass} value={r.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="One line about you" hint="“Line cook, 6 years” or “Reliable, quick to learn”.">
          <input className={inputClass} value={r.headline} onChange={(e) => set({ headline: e.target.value })} />
        </Field>
      </div>
      <Field label="How to reach you" hint="Only what you want them to have: a phone, an email, a city. Messages here work without any of it.">
        <input className={inputClass} value={r.contact} onChange={(e) => set({ contact: e.target.value })} />
      </Field>
      <Field label="A few lines about what you're looking for">
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={3} value={r.summary} onChange={(e) => set({ summary: e.target.value })} />
      </Field>
      <p className="text-xs font-medium">Work you've done</p>
      {entries("experience", "Job title", "Employer")}
      <p className="text-xs font-medium">School, training, certificates</p>
      {entries("education", "What", "Where")}
      <Field label="Skills" hint="A list is fine: knives, POS, forklift certified, Spanish.">
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} value={r.skills} onChange={(e) => set({ skills: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={!text.trim()} onClick={() => onDone(text)}>
          Use this resume
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
