"use client";

// ---------------------------------------------------------------------------
// The coworker directory at one business, the person's side (books/directory.ts):
// opt in (a key pair for this business is made on this device, and the name
// and public key go to the business, which passes them on, with this
// account, to the others who opted in), opt out, and the list of coworkers to
// message. Everything sent here is a letter through Shield.
// Nothing here logs a key or a name.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { type DirectoryEntry, coworkerTag, coworkersFrom } from "@/books/directory";
import { groupsFor, newGroupId } from "@/books/groups";
import { MAX_GROUP, addToThread, unreadIn } from "@/books/thread";
import { type Work, setIdentity, updateWorkThread, workThread } from "@/books/work";
import { newIdentity } from "../coworkers";
import { fanOut, keepSent } from "../groups";
import { LetterBox } from "../letters";
import { postToThread } from "../thread";
import { LettersGate, useCoworkerLetters } from "./coworker_letters";

export type DirectoryProps = { businessKey: string; businessName: string; agreementRef: string };

export default function Directory(props: DirectoryProps) {
  return (
    <AleoWalletProviderWrapper>
      <DirectoryView {...props} />
    </AleoWalletProviderWrapper>
  );
}

/** The business's account, from the agreement this conversation's key belongs to. */
const employerOf = (work: Work, businessKey: string) => work.agreements.find((a) => a.partiesKey === businessKey)?.employerAddress;

function DirectoryView({ businessKey, businessName, agreementRef }: DirectoryProps) {
  const { work, updateWork } = useWork();
  const shield = useCoworkerLetters(businessKey);
  const employer = employerOf(work, businessKey);
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
      if (!employer) throw new Error("No agreement with this business");
      const client = new LetterBox({ wallet: shield.wallet, to: employer });
      const item = await postToThread({ client, partiesKey: businessKey, from: "worker", nextOut: workThread(work, businessKey)?.nextOut ?? 0, body: { type: "directory_join", name: shown, publicKey: id.publicKey } });
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
      if (!employer) throw new Error("No agreement with this business");
      const client = new LetterBox({ wallet: shield.wallet, to: employer });
      const item = await postToThread({ client, partiesKey: businessKey, from: "worker", nextOut: workThread(work, businessKey)?.nextOut ?? 0, body: { type: "directory_leave" } });
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
          Let coworkers at {businessName} find you and message you privately. Only people who also opt in see you: by the name you pick, and your account
          (messages are letters on the network, sent to it). Even {businessName} can&apos;t read what you send each other.
        </p>
        <Field label="The name coworkers see">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <FormError message={error} />
        <LettersGate shield={shield} />
        <Button className="min-h-11 self-start sm:min-h-9" disabled={busy || !shield.ready || !name.trim()} onClick={() => void join()}>
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
            const unread = unreadIn(work.coworkers?.[c.publicKey], (i) => i.body.type === "text");
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
      <Groups businessKey={businessKey} agreementRef={agreementRef} coworkers={coworkers} shield={shield} />
      <FormError message={error} />
      <LettersGate shield={shield} />
      <Button variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={busy || !shield.ready} onClick={() => void leave()}>
        {busy ? "Leaving…" : "Stop letting coworkers find me"}
      </Button>
    </div>
  );
}

/** The group chats at this business, and making a new one. */
function Groups({
  businessKey,
  agreementRef,
  coworkers,
  shield,
}: {
  businessKey: string;
  agreementRef: string;
  coworkers: DirectoryEntry[];
  shield: ReturnType<typeof useCoworkerLetters>;
}) {
  const { work, updateWork } = useWork();
  const identity = work.identities?.[businessKey];
  const groups = groupsFor(work, businessKey);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      const members = [{ name: identity.name, publicKey: identity.publicKey }, ...coworkers.filter((c) => picked.has(c.publicKey))];
      const r = await fanOut(shield.clientFor, work, identity, members, { type: "group", groupId: newGroupId(), name: name.trim(), admin: identity.publicKey, members });
      await updateWork((w) => keepSent(w, businessKey, r));
      if (r.failed.length > 0) setError(`Couldn't reach ${r.failed.map((f) => f.name).join(", ")}; add them again later.`);
      setMaking(false);
      setName("");
      setPicked(new Set());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Group chats</h3>
        {!making && coworkers.length > 0 && (
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setMaking(true)}>
            New group
          </Button>
        )}
      </div>
      {making && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <Field label="Group name">
            <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Who&apos;s in it (up to {MAX_GROUP} with you)</legend>
            {coworkers.map((c) => (
              <label key={c.publicKey} className="flex min-h-11 items-center gap-3 text-sm sm:min-h-8">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={picked.has(c.publicKey)}
                  onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.publicKey); else n.delete(c.publicKey); return n; })}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Each message goes to each person privately, as a letter (Shield asks once per person); the business can&apos;t read the group.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11 sm:min-h-9" disabled={busy || !shield.ready || !name.trim() || picked.size === 0 || picked.size + 1 > MAX_GROUP} onClick={() => void create()}>
              {busy ? "Making it…" : "Make the group"}
            </Button>
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setMaking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {groups.length === 0 && !making && <p className="text-xs text-muted-foreground">No group chats yet.</p>}
      {groups.length > 0 && (
        <ul className="divide-y">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/work/messages?group=${g.id}&at=${agreementRef}`} className="flex min-h-12 items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className={g.unread > 0 ? "block truncate text-sm font-semibold" : "block truncate text-sm font-medium"}>{g.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{g.joined ? (g.messages.at(-1)?.text ?? `${g.members.length} people`) : "You left this group"}</span>
                </span>
                {g.unread > 0 && (
                  <span className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground" aria-label={`${g.unread} unread`}>
                    {g.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
    </div>
  );
}
