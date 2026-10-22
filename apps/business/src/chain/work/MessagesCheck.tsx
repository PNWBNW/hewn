"use client";

// Checking every conversation and channel at once, for the Messages list (the
// person's side): each business's new messages (thread.ts; channel keys and
// the coworker directory arrive this way too), then each channel's new posts
// (channels.ts), then each coworker's messages (coworkers.ts). All of them
// come as letters on chain once Shield is connected (letter_reader.ts). Runs
// once when Shield has had its moment to reconnect, and reports back; it
// draws nothing itself.
// Nothing here logs a key, a lookup or a message.

import { useEffect, useRef } from "react";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useWork } from "@/books/BooksProvider";
import { addReceivedPost, skipPost } from "@/books/channels";
import { addToThread, skipIncoming } from "@/books/thread";
import { type Work, updateCoworker, updateWorkChannels, updateWorkThread, workThread } from "@/books/work";
import { coworkersFrom } from "@/books/directory";
import { COWORKER_KINDS, coworkerAccepts, mySide, pairKey } from "../coworkers";
import { readChannel } from "../channels";
import { useLetters } from "../letter_reader";
import { letterReader, letterThread } from "../letters";
import { readThread } from "../thread";

export type WorkMessagesCheckProps = { onFinished: (message: string | null) => void };

export default function WorkMessagesCheck(props: WorkMessagesCheckProps) {
  return (
    <AleoWalletProviderWrapper>
      <Check {...props} />
    </AleoWalletProviderWrapper>
  );
}

function Check({ onFinished }: WorkMessagesCheckProps) {
  const { work, updateWork } = useWork();
  const { settled, letters, wallet } = useLetters();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !settled) return;
    started.current = true;
    (async () => {
      if (!letters) return onFinished("Connect Shield (open a conversation) to check for messages.");
      const reader = letterReader(letters);
      let latest: Work = work;
      const apply = async (op: (w: Work) => Work) => {
        latest = await updateWork(op);
      };
      const employers = new Map([...work.agreements.map((a) => [a.partiesKey, a.employerAddress] as const), ...(work.applications ?? []).map((a) => [a.partiesKey, a.employerAddress] as const)]);
      for (const [partiesKey, employer] of employers) {
        const r = await readThread({
          client: letterThread(wallet, employer, { letters }).reader,
          partiesKey,
          reader: "worker",
          thread: workThread(work, partiesKey),
          store: (item) => apply((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item))),
          skip: (seq) => apply((w) => updateWorkThread(w, partiesKey, (t) => skipIncoming(t, seq))),
        });
        if (r.off) return onFinished("Connect Shield (open a conversation) to check for messages.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      // Channels as they stand after the threads (new keys may have just arrived).
      for (const channel of latest.channels ?? []) {
        const r = await readChannel({
          // Posts come as letters (send_many).
          client: { get: reader.get },
          channel,
          store: (item) => apply((w) => updateWorkChannels(w, (all) => all.map((c) => (c.id === channel.id && c.partiesKey === channel.partiesKey ? addReceivedPost(c, item) : c)))),
          skip: (epoch, seq) => apply((w) => updateWorkChannels(w, (all) => all.map((c) => (c.id === channel.id && c.partiesKey === channel.partiesKey ? skipPost(c, epoch, seq) : c)))),
        });
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      // Coworkers: each one in each directory this person is listed in.
      for (const [businessKey, identity] of Object.entries(latest.identities ?? {})) {
        if (!identity.listed) continue;
        for (const c of coworkersFrom(workThread(latest, businessKey))) {
          if (c.publicKey === identity.publicKey) continue;
          const key = await pairKey(identity, c.publicKey);
          const r = await readThread({
            // Letters from them (their account isn't needed to read).
            client: reader,
            partiesKey: key,
            reader: mySide(identity.publicKey, c.publicKey),
            thread: latest.coworkers?.[c.publicKey],
            kinds: COWORKER_KINDS,
            accept: coworkerAccepts,
            store: (item) => apply((w) => updateCoworker(w, c.publicKey, { businessKey, name: c.name }, (t) => ({ ...t, ...addToThread(t, item) }))),
            skip: (seq) => apply((w) => updateCoworker(w, c.publicKey, { businessKey, name: c.name }, (t) => ({ ...t, ...skipIncoming(t, seq) }))),
          });
          if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
        }
      }
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [work, updateWork, onFinished, settled, letters, wallet]);

  return null;
}
