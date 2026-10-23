"use client";

// ---------------------------------------------------------------------------
// A backup request or answer in a conversation (books/conversation_backup.ts):
// where it stands, and what this side can do about it. Asked by the other
// side: Allow (with this side's passphrase, which seals its copy) or Decline.
// Allowed by the other side: back up this side's copy. Done: a quiet line
// where it happened. Nothing here logs a passphrase.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Archive } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { FormError, inputClass } from "@/books/AuthCard";
import { type BackupRequest, backupStep } from "@/books/conversation_backup";
import type { ThreadItem } from "@/books/thread";

export type BackupActions = {
  allow: (requestId: string, passphrase: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
  copy: (requestId: string, passphrase: string) => Promise<void>;
};

export function BackupCard({ item, request, title, actions, busy }: { item: ThreadItem; request: BackupRequest | undefined; title: string; actions: BackupActions | null; busy: boolean }) {
  const [passphrase, setPassphrase] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!request) return null;
  const step = backupStep(request);
  const quiet = (text: string) => (
    <p className="flex max-w-[90%] items-center gap-1 rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground">
      <Archive aria-hidden className="size-3 shrink-0" /> {text}
    </p>
  );

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setPassphrase("");
      setOpening(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through");
    }
  }

  const passphraseForm = (label: string, go: (p: string) => Promise<void>, note: string) => (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => go(passphrase));
      }}
    >
      <label className="text-xs font-medium" htmlFor={`backup-${request.requestId}`}>
        Your passphrase: it seals your copy, so only you can open it
      </label>
      <input id={`backup-${request.requestId}`} type="password" autoComplete="current-password" className={inputClass} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      <p className="text-xs text-muted-foreground">{note}</p>
      <Button type="submit" className="min-h-11 self-start sm:min-h-9" disabled={busy || !passphrase}>
        {busy ? "Approve it in Shield…" : label}
      </Button>
      <FormError message={error} />
    </form>
  );

  // The request itself.
  if (item.body.type === "backup_request") {
    if (step === "waiting") return quiet(`You asked ${title} to back up this conversation, up to here. Waiting for their answer.`);
    if (step !== "answer") return quiet(request.mine ? `You asked ${title} to back up this conversation.` : `${title} asked to back up this conversation.`);
    return (
      <div className="flex max-w-[90%] flex-col gap-2 rounded-xl border border-primary/40 bg-card px-3 py-2 text-sm">
        <span className="flex items-center gap-1 font-medium">
          <Archive aria-hidden className="size-4" /> {title} asks to back up this conversation, up to here
        </span>
        <p className="text-xs text-muted-foreground">
          If you allow it, each of you keeps your own copy on the network, sealed to your account and your passphrase. Nothing after this point is in it: the
          conversation carries on under fresh keys.
        </p>
        {actions && !opening && (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setOpening(true)}>
              Allow…
            </Button>
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void run(() => actions.decline(request.requestId))}>
              Decline
            </Button>
          </div>
        )}
        {actions && opening && passphraseForm("Allow and back up", (p) => actions.allow(request.requestId, p), "Shield asks twice: once for your copy, once for your answer.")}
        {!opening && <FormError message={error} />}
      </div>
    );
  }

  // The answer.
  if (step === "declined") return quiet(request.answer?.mine ? "You declined. Nothing was backed up." : `${title} declined. Nothing was backed up.`);
  if (step === "done") return quiet("Backed up to here, both agreed");
  if (step === "copy") {
    return (
      <div className="flex max-w-[90%] flex-col gap-2 rounded-xl border border-primary/40 bg-card px-3 py-2 text-sm">
        <span className="flex items-center gap-1 font-medium">
          <Archive aria-hidden className="size-4" /> {title} allowed the backup
        </span>
        {actions ? passphraseForm("Back up my copy", (p) => actions.copy(request.requestId, p), "One approval in Shield. Your copy covers the conversation up to here.") : null}
      </div>
    );
  }
  return null;
}
