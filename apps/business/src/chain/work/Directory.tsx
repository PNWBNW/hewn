"use client";

// ---------------------------------------------------------------------------
// The coworker directory at one business, the person's side (books/directory.ts):
// opt in (a key pair for this business is made on this device, and the name
// and public key go to the business, which passes them on to the others who
// opted in), opt out, and the list of coworkers to message. Needs no Shield.
// Nothing here logs a key or a name.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { coworkerTag, coworkersFrom } from "@/books/directory";
import { addToThread, unreadIn } from "@/books/thread";
import { setIdentity, updateWorkThread, workThread } from "@/books/work";
import { newIdentity } from "../coworkers";
import { postToThread } from "../thread";

export type DirectoryProps = { businessKey: string; businessName: string; agreementRef: string };

export default function Directory({ businessKey, businessName, agreementRef }: DirectoryProps) {
  const { work, updateWork } = useWork();
  const identity = work.identities?.[businessKey];
  const [name, setName] = useState(identity?.name || work.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coworkers = coworkersFrom(workThread(work, businessKey)).filter((c) => c.publicKey !== identity?.publicKey);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const shown = name.trim();
      const id = identity ?? (await newIdentity(shown));
      const item = await postToThread({ client: new MailboxClient(), partiesKey: businessKey, from: "worker", nextOut: workThread(work, businessKey)?.nextOut ?? 0, body: { type: "directory_join", name: shown, publicKey: id.publicKey } });
      await updateWork((w) => updateWorkThread(setIdentity(w, businessKey, { ...id, name: shown, listed: true }), businessKey, (t) => addToThread(t, item)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      const item = await postToThread({ client: new MailboxClient(), partiesKey: businessKey, from: "worker", nextOut: workThread(work, businessKey)?.nextOut ?? 0, body: { type: "directory_leave" } });
      await updateWork((w) => updateWorkThread(setIdentity(w, businessKey, { ...identity, listed: false }), businessKey, (t) => addToThread(t, item)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!identity?.listed) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Let coworkers at {businessName} find you and message you privately. Only people who also opt in see you, and only by the name you pick. Even{" "}
          {businessName} can&apos;t read what you send each other.
        </p>
        <Field label="The name coworkers see">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <FormError message={error} />
        <Button className="min-h-11 self-start sm:min-h-9" disabled={busy || !name.trim()} onClick={() => void join()}>
          {busy ? "Joining…" : "Let coworkers find me"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Coworkers who opted in see you as <span className="font-medium">{identity.name}</span>. The list updates when {businessName} next checks their messages.
      </p>
      {coworkers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one else here yet.</p>
      ) : (
        <ul className="divide-y">
          {coworkers.map((c) => {
            const unread = unreadIn(work.coworkers?.[c.publicKey]);
            return (
              <li key={c.publicKey}>
                <Link href={`/work/messages?coworker=${coworkerTag(c.publicKey)}&at=${agreementRef}`} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  {work.coworkers?.[c.publicKey]?.verifiedAt && <span className="text-xs text-muted-foreground">Checked</span>}
                  {unread > 0 && (
                    <span className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground" aria-label={`${unread} unread`}>
                      {unread}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <FormError message={error} />
      <Button variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={busy} onClick={() => void leave()}>
        {busy ? "Leaving…" : "Stop letting coworkers find me"}
      </Button>
    </div>
  );
}
