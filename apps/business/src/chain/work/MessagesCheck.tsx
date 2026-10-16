"use client";

// Checking every conversation and channel at once, for the Messages list (the
// person's side): each business's new messages (thread.ts; channel keys
// arrive this way too), then each channel's new posts (channels.ts), with a
// receipt back for each. Runs once when it mounts and reports back; it draws
// nothing itself. Needs no Shield. Nothing here logs a key, a lookup or a message.

import { useEffect, useMemo, useRef } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { useWork } from "@/books/BooksProvider";
import { addReceivedPost, skipPost } from "@/books/channels";
import { addToThread, skipIncoming } from "@/books/thread";
import { type Work, updateWorkChannels, updateWorkThread, workThread } from "@/books/work";
import { readChannel } from "../channels";
import { readThread } from "../thread";

export type WorkMessagesCheckProps = { onFinished: (message: string | null) => void };

export default function WorkMessagesCheck({ onFinished }: WorkMessagesCheckProps) {
  const { work, updateWork } = useWork();
  const client = useMemo(() => new MailboxClient(), []);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let latest: Work = work;
      const apply = async (op: (w: Work) => Work) => {
        latest = await updateWork(op);
      };
      for (const partiesKey of new Set(work.agreements.map((a) => a.partiesKey))) {
        const r = await readThread({
          client,
          partiesKey,
          reader: "worker",
          thread: workThread(work, partiesKey),
          store: (item) => apply((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item))),
          skip: (seq) => apply((w) => updateWorkThread(w, partiesKey, (t) => skipIncoming(t, seq))),
        });
        if (r.off) return onFinished("Messages are off on this server.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      // Channels as they stand after the threads (new keys may have just arrived).
      for (const channel of latest.channels ?? []) {
        const r = await readChannel({
          client,
          channel,
          store: (item) => apply((w) => updateWorkChannels(w, (all) => all.map((c) => (c.id === channel.id && c.partiesKey === channel.partiesKey ? addReceivedPost(c, item) : c)))),
          skip: (epoch, seq) => apply((w) => updateWorkChannels(w, (all) => all.map((c) => (c.id === channel.id && c.partiesKey === channel.partiesKey ? skipPost(c, epoch, seq) : c)))),
        });
        if (r.off) return onFinished("Messages are off on this server.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [work, updateWork, client, onFinished]);

  return null;
}
