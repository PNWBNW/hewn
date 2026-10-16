"use client";

// ---------------------------------------------------------------------------
// A group chat between coworkers (books/groups.ts): its messages with who
// sent each, a box to send one (it goes to each member through your private
// conversation with them), and, for its admin, who's in it. Anyone can leave.
// Needs no Shield. Nothing here logs a key or a message.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Send, Users } from "lucide-react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { coworkersFrom } from "@/books/directory";
import { groupMessageIds, groupsFor } from "@/books/groups";
import { MAX_GROUP, MAX_TEXT_CHARS, markItemsRead } from "@/books/thread";
import { workThread } from "@/books/work";
import { type FanOutResult, fanOut, keepSent } from "../groups";

export type GroupChatProps = { businessKey: string; groupId: string };

const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const failedNote = (r: FanOutResult) => (r.failed.length > 0 ? `Couldn't reach ${r.failed.map((f) => f.name).join(", ")}; they'll miss this one.` : null);

export default function GroupChat({ businessKey, groupId }: GroupChatProps) {
  const { work, updateWork } = useWork();
  const client = useMemo(() => new MailboxClient(), []);
  const identity = work.identities?.[businessKey];
  const group = groupsFor(work, businessKey).find((g) => g.id === groupId);
  const directory = coworkersFrom(workThread(work, businessKey));
  const names = new Map([...directory, ...(group?.members ?? [])].map((m) => [m.publicKey, m.name]));
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group?.members.map((m) => m.publicKey) ?? []));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opening it marks its messages read, in every conversation they came through.
  useEffect(() => {
    if (!group || group.unread === 0) return;
    const ids = groupMessageIds(group);
    void updateWork((w) => ({ ...w, coworkers: Object.fromEntries(Object.entries(w.coworkers ?? {}).map(([k, t]) => [k, { ...t, ...markItemsRead(t, ids) }])) }));
  }, [group, updateWork]);

  if (!identity || !group) return <FormError message="That group isn't on this device." />;

  async function send() {
    if (!identity || !group || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fanOut(client, work, identity, group.members, { type: "group_text", groupId: group.id, text: text.trim() });
      await updateWork((w) => keepSent(w, businessKey, r));
      setNote(failedNote(r));
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveMembers() {
    if (!identity || !group) return;
    setBusy(true);
    setError(null);
    try {
      const pool = new Map([...group.members, ...directory].map((m) => [m.publicKey, m]));
      const members = [...picked].map((k) => pool.get(k)!).filter(Boolean);
      if (!members.some((m) => m.publicKey === identity.publicKey)) members.unshift({ name: identity.name, publicKey: identity.publicKey });
      // Everyone before and after hears about it, so anyone taken out knows.
      const to = [...new Map([...group.members, ...members].map((m) => [m.publicKey, m])).values()];
      const r = await fanOut(client, work, identity, to, { type: "group", groupId: group.id, name: group.name, admin: identity.publicKey, members });
      await updateWork((w) => keepSent(w, businessKey, r));
      setNote(failedNote(r));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!identity || !group) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fanOut(client, work, identity, group.members, { type: "group_leave", groupId: group.id });
      await updateWork((w) => keepSent(w, businessKey, r));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold">
            <Users aria-hidden className="size-4" /> {group.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {group.members.map((m) => (m.publicKey === identity.publicKey ? "You" : m.name)).join(", ")} · only you can read this
          </p>
        </div>
        {group.isAdmin && group.joined && (
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => setEditing((v) => !v)}>
            People
          </Button>
        )}
      </div>

      {editing && (
        <fieldset className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3">
          <legend className="text-sm font-medium">Who&apos;s in it (up to {MAX_GROUP})</legend>
          {[...new Map([...group.members, ...directory].map((m) => [m.publicKey, m])).values()]
            .filter((m) => m.publicKey !== identity.publicKey)
            .map((m) => (
              <label key={m.publicKey} className="flex min-h-11 items-center gap-3 text-sm sm:min-h-8">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={picked.has(m.publicKey)}
                  onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(m.publicKey); else n.delete(m.publicKey); return n; })}
                />
                {m.name}
              </label>
            ))}
          <Button className="mt-2 min-h-11 self-start sm:min-h-9" disabled={busy || picked.size + 1 > MAX_GROUP} onClick={() => void saveMembers()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </fieldset>
      )}

      <ol className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3" aria-label={`Messages in ${group.name}`}>
        {group.messages.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
        {group.messages.map((m) => (
          <li key={m.id} className={cn("flex flex-col gap-0.5", m.mine ? "items-end" : "items-start")}>
            {!m.mine && <span className="text-[11px] font-medium text-muted-foreground">{names.get(m.from) ?? "Someone"}</span>}
            <p className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm", m.mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card")}>{m.text}</p>
            <span className="text-[11px] text-muted-foreground">{stamp(m.sentAt)}</span>
          </li>
        ))}
      </ol>

      {group.joined ? (
        <>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="group-message">
              Message {group.name}
            </label>
            <textarea id="group-message" className={`${inputClass} h-auto min-h-11 flex-1 resize-y py-2`} rows={2} maxLength={MAX_TEXT_CHARS} placeholder={`Message ${group.name}`} value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" className="min-h-11 shrink-0 sm:min-h-10" disabled={busy || !text.trim()} aria-label="Send">
              <Send aria-hidden />
              <span className="hidden sm:inline">{busy ? "Sending…" : "Send"}</span>
            </Button>
          </form>
          <Button variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={busy} onClick={() => void leave()}>
            Leave the group
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">You&apos;re not in this group any more; what&apos;s here stays on your device.</p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <FormError message={error} />
    </div>
  );
}
