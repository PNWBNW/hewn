"use client";

// ---------------------------------------------------------------------------
// An announcement channel, the business's side (books/channels.ts): make one,
// post to it, see who has seen each post, and choose who's in it. Adding
// someone sends them the channel's key through their own thread; taking
// someone out moves the channel to a new key that only those who stay get.
// Needs no Shield. Loaded only when a channel is opened or made.
// Nothing here logs a key or a post.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Megaphone, Users } from "lucide-react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { type BusinessChannel, MAX_POST_CHARS, addMembers, addOwnPost, markSeen, newChannel, removeMembers } from "@/books/channels";
import { type Mailbox, emptyMailbox, putChannel, threadFor, updateThread } from "@/books/mailbox";
import { addToThread } from "@/books/thread";
import type { Company } from "@/books/company";
import { type KeyOutResult, type Member, awaitingSeen, postToChannel, readSeen, sendChannelKey } from "./channels";

export type ChannelProps = { channelId: string | null; onCreated?: (id: string) => void; onClose: () => void };

const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Keeps the key messages that went out in each member's thread. */
function keepSent(m: Mailbox, sent: KeyOutResult["sent"]): Mailbox {
  return sent.reduce((acc, s) => updateThread(acc, s.partiesKey, s.workerId, (t) => addToThread(t, s.item)), m);
}

export default function Channel({ channelId, onCreated, onClose }: ChannelProps) {
  const { rail, payroll, mailbox, updateCompany } = useOpenBooks();
  const client = useMemo(() => new MailboxClient(), []);
  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  // Who can be in a channel: linked team members (there's a key to reach them with).
  const team = (rail?.links ?? []).filter((l) => l.status === "linked" && l.partiesKey).map((l) => ({ workerId: l.workerId, partiesKey: l.partiesKey!, name: names.get(l.workerId) ?? "A team member" }));
  const keys = new Map(team.map((t) => [t.workerId, t.partiesKey]));
  const channel = channelId ? mailbox?.channels?.find((c) => c.id === channelId) : undefined;
  const memberOf = (workerId: string): Member => ({ workerId, partiesKey: keys.get(workerId)!, thread: threadFor(mailbox, keys.get(workerId)!) });

  const [name, setName] = useState(channel?.name ?? "Everyone");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(channel?.members ?? team.map((t) => t.workerId)));
  const [editing, setEditing] = useState(!channel);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = (change: (c: Company) => Company) => updateCompany(change);
  const failedNote = (r: KeyOutResult) =>
    r.failed.length > 0 ? `Couldn't reach ${r.failed.map((f) => names.get(f.workerId) ?? "someone").join(", ")}; try again later.` : null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const ch = newChannel(name, [...picked].filter((id) => keys.has(id)));
      const out = await sendChannelKey(client, ch, ch.members.map(memberOf));
      await save((c) => ({ ...c, mailbox: putChannel(keepSent(c.mailbox ?? emptyMailbox(), out.sent), ch) }));
      setNote(failedNote(out));
      onCreated?.(ch.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveMembers(ch: BusinessChannel) {
    setBusy(true);
    setError(null);
    try {
      const want = [...picked].filter((id) => keys.has(id));
      const gone = ch.members.filter((m) => !want.includes(m));
      const added = want.filter((m) => !ch.members.includes(m));
      let next = ch;
      let sent: KeyOutResult["sent"] = [];
      const failed: KeyOutResult["failed"] = [];
      if (gone.length > 0) {
        // A new key for everyone who stays; the ones leaving are told, and keep only the old key.
        next = removeMembers(next, gone);
        const left = await sendChannelKey(client, next, gone.filter((g) => keys.has(g)).map(memberOf), true);
        const stay = await sendChannelKey(client, next, next.members.filter((m) => !added.includes(m)).map(memberOf));
        sent = [...sent, ...left.sent, ...stay.sent];
        failed.push(...left.failed, ...stay.failed);
      }
      if (added.length > 0) {
        next = addMembers(next, added);
        const out = await sendChannelKey(client, next, added.map(memberOf));
        sent = [...sent, ...out.sent];
        failed.push(...out.failed);
      }
      const final = next;
      await save((c) => ({ ...c, mailbox: putChannel(keepSent(c.mailbox ?? emptyMailbox(), sent), final) }));
      setNote(failedNote({ sent, failed }));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function post(ch: BusinessChannel) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const item = await postToChannel(client, ch, text.trim());
      await save((c) => {
        const current = c.mailbox?.channels?.find((x) => x.id === ch.id) ?? ch;
        return { ...c, mailbox: putChannel(c.mailbox ?? emptyMailbox(), addOwnPost(current, item)) };
      });
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkSeen(ch: BusinessChannel) {
    setBusy(true);
    setError(null);
    try {
      await readSeen(client, awaitingSeen(ch, keys), async (heard) => {
        await save((c) => {
          const current = c.mailbox?.channels?.find((x) => x.id === ch.id) ?? ch;
          const marked = heard.reduce((acc, h) => markSeen(acc, h.target.epoch, h.target.seq, h.target.workerId, h.receivedAt), current);
          return { ...c, mailbox: putChannel(c.mailbox ?? emptyMailbox(), marked) };
        });
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const memberPicker = (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">Who&apos;s in it</legend>
      {team.length === 0 && <p className="text-xs text-muted-foreground">No linked team members yet. Once someone accepts an offer, they can be added.</p>}
      {team.map((t) => (
        <label key={t.workerId} className="flex min-h-11 items-center gap-3 text-sm sm:min-h-8">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={picked.has(t.workerId)}
            onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(t.workerId); else n.delete(t.workerId); return n; })}
          />
          {t.name}
        </label>
      ))}
    </fieldset>
  );

  if (!channel) {
    return (
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone aria-hidden className="size-4" /> New announcement channel
        </h3>
        <Field label="Name" hint="Everyone, Night crew, Site B…">
          <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        {memberPicker}
        <p className="text-xs text-muted-foreground">The channel gets its own key, sent to each person privately. Only people in it can read its posts.</p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy || !name.trim() || picked.size === 0} onClick={() => void create()}>
            {busy ? "Making it…" : "Make the channel"}
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold">
            <Megaphone aria-hidden className="size-4" /> {channel.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {channel.members.length} {channel.members.length === 1 ? "person" : "people"} · only they can read it
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => void checkSeen(channel)}>
            Who&apos;s seen it
          </Button>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => setEditing((v) => !v)}>
            <Users aria-hidden /> People
          </Button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
          {memberPicker}
          <p className="text-xs text-muted-foreground">Taking someone out gives the channel a new key, so they can&apos;t read what&apos;s posted after.</p>
          <Button className="min-h-11 self-start sm:min-h-9" disabled={busy} onClick={() => void saveMembers(channel)}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {channel.posts.length === 0 && <li className="text-sm text-muted-foreground">Nothing posted yet.</li>}
        {channel.posts.map((p) => {
          const seen = Object.keys(p.seenBy ?? {}).filter((id) => channel.members.includes(id));
          return (
            <li key={p.id} className="flex flex-col gap-1 rounded-md border bg-card p-3">
              <p className="whitespace-pre-wrap text-sm">{p.text}</p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {stamp(p.sentAt)} · Seen by {seen.length} of {channel.members.length}
                </summary>
                <span>{seen.length === 0 ? "No one yet." : seen.map((id) => names.get(id) ?? "A team member").join(", ")}</span>
              </details>
            </li>
          );
        })}
      </ol>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void post(channel);
        }}
      >
        <label className="text-sm font-medium" htmlFor="post">
          Post to {channel.name}
        </label>
        <textarea id="post" className={`${inputClass} h-auto min-h-20 py-2`} rows={3} maxLength={MAX_POST_CHARS} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" className="min-h-11 self-start sm:min-h-9" disabled={busy || !text.trim() || channel.members.length === 0}>
          {busy ? "Posting…" : "Post"}
        </Button>
      </form>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <FormError message={error} />
    </div>
  );
}
