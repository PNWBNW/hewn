"use client";

// ---------------------------------------------------------------------------
// One conversation between a business and one person (Joshua, 2026-10-16):
// plain messages and the offer negotiation, in one thread (books/thread.ts),
// the same screen on both sides. Opening it reads the other side's new
// messages and marks them as read. Sending seals one message to the two of
// you and puts it in your next slot.
//
// Between a business and a person (`peer` given), every message is a letter
// on chain (chain/letters.ts): Shield connects, each send is one approval
// with its fee choice, and reading looks through the account's letters (then
// the old mailbox, for anything sent before). No receipts: a letter in a
// block has arrived. Coworkers (no `peer`) still use the mailbox, with
// receipts, and need no Shield.
// Nothing here logs a key, a lookup or a message.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, RefreshCw, Send } from "lucide-react";
import { appMailbox } from "./mailbox_client";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { shortAddress } from "@/books/rail";
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
  markItemsRead,
  markThreadRead,
  preview,
  skipIncoming,
} from "@/books/thread";
import { FeeChoice } from "./FeeChoice";
import { useLetters } from "./letter_reader";
import { LETTER_BYTES, letterThread } from "./letters";
import { readReceipts } from "./receipts";
import { type PostInput, type ReadInput, type ThreadKinds, awaitingReceipts, postToThread, readThread } from "./thread";

export type ConversationProps = {
  /** Who is reading. */
  side: Side;
  partiesKey: string;
  /** The other side, as this vault names them. */
  title: string;
  thread: Thread | undefined;
  /** Applies a change to this thread in the vault. */
  update: (change: (t: Thread) => Thread) => Promise<void>;
  /** Where offers are answered on this side (Jobs → Offers, or the worker's Offers). */
  offersHref: string;
  /** For a coworker conversation: its own slots, and plain messages only. */
  kinds?: ThreadKinds;
  accept?: (body: ThreadBody) => boolean;
  /** Under the title, instead of "Sealed to the two of you". */
  subtitle?: ReactNode;
  /** Which messages this screen shows (a coworker's group messages live in the group). */
  show?: (item: ThreadItem) => boolean;
  /** The other side's account: messages go as letters on chain, through Shield. Left out for coworkers (the mailbox). */
  peer?: string;
};

/** How messages travel: the mailbox (with receipts) or letters (without). */
type Transport = {
  reader: ReadInput["client"];
  writer: PostInput["client"];
  letters: boolean;
  /** Reads the wallet's letters afresh on the next check. */
  refresh?: () => void;
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Conversation(props: ConversationProps) {
  if (!props.peer) return <MailboxConversation {...props} />;
  return (
    <AleoWalletProviderWrapper>
      <LetterConversation {...props} peer={props.peer} />
    </AleoWalletProviderWrapper>
  );
}

function MailboxConversation(props: ConversationProps) {
  const transport = useMemo<Transport>(() => {
    const client = appMailbox();
    return { reader: client, writer: client, letters: false };
  }, []);
  return <ConversationView {...props} transport={transport} />;
}

function LetterConversation(props: ConversationProps & { peer: string }) {
  const { state, connect, error, address, mismatch, letters, wallet } = useLetters();
  const { peer } = props;
  const transport = useMemo<Transport | null>(() => (letters ? { ...letterThread(wallet, peer, { letters }), letters: true } : null), [letters, wallet, peer]);

  let gate: ReactNode = null;
  if (mismatch && address) {
    gate = <p className="text-sm">Shield is signed in to a different account ({shortAddress(address)}) than this one. Switch accounts in Shield to send and read messages.</p>;
  } else if (state.kind === "missing") {
    gate = <p className="text-sm">Messages travel as letters on the network, through Shield. Install the Shield extension, or open this page in the Shield app.</p>;
  } else if (state.kind === "connecting") {
    gate = <p className="text-sm">Connecting… approve the request in Shield.</p>;
  } else if (state.kind === "ready") {
    gate = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">Messages travel as letters on the network. Connect Shield to send and read them.</p>
        <Button className="min-h-11 sm:min-h-9" onClick={connect}>
          Connect Shield
        </Button>
      </div>
    );
  }
  return (
    <ConversationView
      {...props}
      transport={transport}
      gate={
        gate || error ? (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
            {gate}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : null
      }
    />
  );
}

function ConversationView({
  side,
  partiesKey,
  title,
  thread,
  update,
  offersHref,
  kinds,
  accept,
  subtitle,
  show,
  transport,
  gate,
}: ConversationProps & { transport: Transport | null; gate?: ReactNode }) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(thread);
  latest.current = thread;
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // This send's fee, starting from the device's switch.
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());

  const check = useCallback(async () => {
    if (!transport) return;
    setChecking(true);
    setStatus(null);
    try {
      transport.refresh?.();
      const r = await readThread({
        client: transport.reader,
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
      if (!r.off && !r.failed && !transport.letters) {
        const waiting = awaitingReceipts(latest.current, partiesKey, side, 20, kinds);
        if (waiting.length > 0) {
          const client = appMailbox();
          await readReceipts(client, waiting, (heard) => update((t) => heard.reduce((acc, h) => markDelivered(acc, h.target, h.receivedAt), t)));
        }
      }
      await update((t) => (show ? markItemsRead(t, new Set(t.items.filter(show).map((i) => i.id))) : markThreadRead(t)));
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, [transport, partiesKey, side, update, kinds, accept, show]);

  useEffect(() => {
    if (started.current || !transport) return;
    started.current = true;
    void check();
  }, [check, transport]);

  // The directory list the business passes on is bookkeeping, not conversation.
  const items = (thread?.items ?? []).filter((i) => i.body.type !== "directory" && (!show || show(i)));
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  async function send() {
    const body = text.trim();
    if (!body || !transport) return;
    setSending(true);
    setError(null);
    try {
      const item = await postToThread({
        client: transport.writer,
        partiesKey,
        from: side,
        nextOut: latest.current?.nextOut ?? 0,
        body: { type: "text", text: body },
        ...(kinds ? { kinds } : {}),
        ...(transport.letters ? { feeMode } : {}),
      });
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
        <Button variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-8" disabled={checking || !transport} onClick={() => void check()}>
          <RefreshCw aria-hidden className={cn(checking && "animate-spin")} />
          {checking ? "Checking…" : "Check"}
        </Button>
      </div>
      {gate}
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
              {item === lastMine && (item.receivedAt ? ` · Received ${stamp(item.receivedAt)}` : transport?.letters ? " · On the network" : " · Sent")}
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
        <Button type="submit" className="min-h-11 shrink-0 sm:min-h-10" disabled={sending || !text.trim() || !transport} aria-label="Send">
          <Send aria-hidden />
          <span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span>
        </Button>
      </form>
      {transport?.letters && (
        <div className="flex flex-col gap-1">
          <FeeChoice compact value={feeMode} onChange={setFeeMode} disabled={sending} />
          <p className="text-xs text-muted-foreground">
            {sending
              ? "Approve it in Shield; it's on the network in about a minute."
              : longText(text)
                ? "Long: it may go as a page (a bigger network fee than a letter)."
                : "Each message is a sealed letter on the network: one approval in Shield."}
          </p>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}

/** Roughly whether a message will need a page rather than a letter (its JSON and seal add about 150 bytes; text may compress). */
const longText = (text: string) => new TextEncoder().encode(text.trim()).length > LETTER_BYTES - 150;

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
  if (b.type === "application") {
    // The application that opened this conversation: the message, and the resume folded away.
    return (
      <div className="flex max-w-[90%] flex-col gap-2 rounded-xl border border-primary/40 bg-card px-3 py-2 text-sm">
        <span className="font-medium">{item.mine ? "Your application" : `${b.name}'s application`}</span>
        {b.message && <p className="whitespace-pre-wrap break-words">{b.message}</p>}
        <details>
          <summary className="cursor-pointer text-xs font-medium text-primary">Resume</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{b.resume}</pre>
        </details>
      </div>
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
