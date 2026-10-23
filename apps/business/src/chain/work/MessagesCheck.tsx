"use client";

// Checking every conversation and channel at once, for the Messages list (the
// person's side): each business's new messages (thread.ts; channel keys and
// the coworker directory arrive this way too), then each channel's new posts
// (channels.ts), then each coworker's messages (coworkers.ts), then the
// invitations from whoever gave this person their calendar's key (events.ts). All of them
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
import { checkEvents, workListening } from "../events";
import { useLetters } from "../letter_reader";
import { keepHalvesReady } from "../key_ring";
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
  const { work, updateWork, calendar, updateCompany } = useWork();
  const { settled, letters, wallet } = useLetters();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !settled) return;
    started.current = true;
    (async () => {
      if (!letters) return onFinished("Connect Shield (open a conversation) to check for messages.");
      let latest: Work = work;
      const apply = async (op: (w: Work) => Work) => {
        latest = await updateWork(op);
      };
      const employers = new Map([...work.agreements.map((a) => [a.partiesKey, a.employerAddress] as const), ...(work.applications ?? []).map((a) => [a.partiesKey, a.employerAddress] as const)]);
      // An employer's conversation moves to keys made by handshake; an application's key already comes from key exchange.
      const hired = new Set(work.agreements.map((a) => a.partiesKey));
      for (const [partiesKey, employer] of employers) {
        const twin = hired.has(partiesKey);
        const r = await readThread({
          client: letterThread(wallet, employer, { letters }).reader,
          partiesKey,
          reader: "worker",
          thread: workThread(work, partiesKey),
          ...(twin ? { twin: true as const } : {}),
          store: (item) => apply((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item))),
          skip: (seq, via) => apply((w) => updateWorkThread(w, partiesKey, (t) => skipIncoming(t, seq, via))),
        });
        if (r.off) return onFinished("Connect Shield (open a conversation) to check for messages.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
        if (twin) await keepHalvesReady(workThread(latest, partiesKey)?.ring, (change) => apply((w) => updateWorkThread(w, partiesKey, (t) => ({ ...t, ring: change(t.ring) }))));
      }
      // Channels as they stand after the threads (new keys may have just arrived).
      for (const channel of latest.channels ?? []) {
        // A post counts only from the business's own account: everyone in the channel holds its key.
        const business = employers.get(channel.partiesKey);
        if (!business) continue;
        const r = await readChannel({
          // Posts come as letters (send_many).
          client: { get: letterReader(letters, business).get },
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
          // A coworker's letters count only from the account the business listed for them.
          if (c.publicKey === identity.publicKey || !c.address) continue;
          const key = await pairKey(identity, c.publicKey);
          const r = await readThread({
            client: letterReader(letters, c.address),
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
      // Invitations, now that any new calendar keys are in.
      await checkEvents(letters, await workListening(latest), calendar, updateCompany);
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [work, updateWork, calendar, updateCompany, onFinished, settled, letters, wallet]);

  return null;
}
