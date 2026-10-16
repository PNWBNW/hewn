"use client";

// ---------------------------------------------------------------------------
// One conversation between a business and one person (Joshua, 2026-10-16):
// plain messages and the offer negotiation, in one thread (books/thread.ts),
// the same screen on both sides. Opening it reads the other side's new
// messages (sending a receipt for each), looks for receipts for mine, and
// marks theirs as read. Sending seals one message to the two of you and puts
// it in your next slot. Needs no Shield: the parties key is in the vault.
// Nothing here logs a key, a lookup or a message.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, RefreshCw, Send } from "lucide-react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { QuotedNote } from "@/books/NegotiationView";
import {
  MAX_TEXT_CHARS,
  type Side,
  type Thread,
  type ThreadBody,
  type ThreadItem,
  addToThread,
  isOfferStep,
  markDelivered,
  markThreadRead,
  preview,
  skipIncoming,
} from "@/books/thread";
import { readReceipts } from "./receipts";
import { type ThreadKinds, awaitingReceipts, postToThread, readThread } from "./thread";

export type ConversationProps = {
  /** Who is reading. */
  side: Side;
  partiesKey: string;
  /** The other side, as this vault names them. */
  title: string;
  thread: Thread | undefined;
  /** Applies a change to this thread in the vault. */
  update: (change: (t: Thread) => Thread) => Promise<void>;
  /** Where offers are answered on this side (the Mailbox, or Offers). */
  offersHref: string;
  /** For a coworker conversation: its own slots, and plain messages only. */
  kinds?: ThreadKinds;
  accept?: (body: ThreadBody) => boolean;
  /** Under the title, instead of "Sealed to the two of you". */
  subtitle?: ReactNode;
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Conversation({ side, partiesKey, title, thread, update, offersHref, kinds, accept, subtitle }: ConversationProps) {
  const client = useMemo(() => new MailboxClient(), []);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(thread);
  latest.current = thread;
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const check = useCallback(async () => {
    setChecking(true);
    setStatus(null);
    try {
      const r = await readThread({
        client,
        partiesKey,
        reader: side,
        thread: latest.current,
        ...(kinds ? { kinds } : {}),
        ...(accept ? { accept } : {}),
        store: (item) => update((t) => addToThread(t, item)),
        skip: (seq) => update((t) => skipIncoming(t, seq)),
      });
      if (r.off) setStatus("Messages are off on this server.");
      else if (r.failed) setStatus(`Couldn't check for new messages: ${r.failed}`);
      else if (r.skipped.length > 0) setStatus(`${r.skipped.length} ${r.skipped.length === 1 ? "message" : "messages"} couldn't be read and ${r.skipped.length === 1 ? "was" : "were"} skipped.`);
      if (!r.off && !r.failed) {
        const waiting = awaitingReceipts(latest.current, partiesKey, side, 20, kinds);
        if (waiting.length > 0) {
          await readReceipts(client, waiting, (heard) => update((t) => heard.reduce((acc, h) => markDelivered(acc, h.target, h.receivedAt), t)));
        }
      }
      await update(markThreadRead);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, [client, partiesKey, side, update, kinds, accept]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
  }, [check]);

  // The directory list the business passes on is bookkeeping, not conversation.
  const items = (thread?.items ?? []).filter((i) => i.body.type !== "directory");
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const item = await postToThread({ client, partiesKey, from: side, nextOut: latest.current?.nextOut ?? 0, body: { type: "text", text: body }, ...(kinds ? { kinds } : {}) });
      await update((t) => addToThread(t, item));
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const lastMine = [...items].reverse().find((i) => i.mine);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {subtitle ?? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock aria-hidden className="size-3" /> Sealed to the two of you
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-8" disabled={checking} onClick={() => void check()}>
          <RefreshCw aria-hidden className={cn(checking && "animate-spin")} />
          {checking ? "Checking…" : "Check"}
        </Button>
      </div>
      {status && (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}

      <ol className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3" aria-label={`Messages with ${title}`}>
        {items.length === 0 && <li className="text-sm text-muted-foreground">No messages yet. Say hello.</li>}
        {items.map((item) => (
          <li key={item.id} className={cn("flex flex-col gap-0.5", item.mine ? "items-end" : "items-start")}>
            <Bubble item={item} title={title} offersHref={offersHref} />
            <span className="text-[11px] text-muted-foreground">
              {stamp(item.sentAt)}
              {item === lastMine && (item.receivedAt ? ` · Received ${stamp(item.receivedAt)}` : " · Sent")}
            </span>
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="message">
          Message to {title}
        </label>
        <textarea
          id="message"
          className={`${inputClass} h-auto min-h-11 flex-1 resize-y py-2`}
          rows={2}
          maxLength={MAX_TEXT_CHARS}
          placeholder={`Message ${title}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" className="min-h-11 shrink-0 sm:min-h-10" disabled={sending || !text.trim()} aria-label="Send">
          <Send aria-hidden />
          <span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span>
        </Button>
      </form>
      <FormError message={error} />
    </div>
  );
}

function Bubble({ item, title, offersHref }: { item: ThreadItem; title: string; offersHref: string }) {
  const b = item.body;
  if (b.type === "text") {
    return (
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
          item.mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card",
        )}
      >
        {b.text}
      </p>
    );
  }
  if (!isOfferStep(b)) {
    // A channel key or a removal: a quiet line, not a bubble.
    return <p className="max-w-[90%] rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground">{item.mine ? preview(item) : `${title}: ${lowerFirst(preview(item))}`}</p>;
  }
  // Negotiation: a short card; the full terms and the answers live with the offer.
  return (
    <div className="flex max-w-[90%] flex-col gap-1 rounded-xl border border-primary/40 bg-card px-3 py-2 text-sm">
      <span className="font-medium">{item.mine ? preview(item) : `${title}: ${lowerFirst(preview(item))}`}</span>
      <QuotedNote who={item.mine ? "You" : title} text={b.note} />
      <Link href={offersHref} className="text-xs font-medium text-primary underline underline-offset-4">
        See the offer
      </Link>
    </div>
  );
}
