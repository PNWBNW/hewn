"use client";

// ---------------------------------------------------------------------------
// The conversations shared events travel through (chain/events.ts), from
// either side: a business's thread with a person, a person's with their
// employer, or with a coworker (its key made on this device, coworkers.ts).
// Use inside an AleoWalletProviderWrapper. Nothing here logs a key or an
// account.
// ---------------------------------------------------------------------------

import { useOpenBooks } from "@/books/BooksProvider";
import { coworkersFrom } from "@/books/directory";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import type { Contact } from "@/books/shared_events";
import { addToThread } from "@/books/thread";
import { updateCoworker, updateWorkThread, workThread } from "@/books/work";
import { COWORKER_KINDS, mySide, pairKey } from "./coworkers";
import type { Reach } from "./events";
import { LetterBox, type LetterWallet } from "./letters";

export function useEventReach(wallet: LetterWallet) {
  const { role, rail, mailbox, work, updateCompany } = useOpenBooks();

  /** The key this account shares with a contact: their parties key, or the coworkers' pair key. */
  async function conversationKey(c: Contact): Promise<string> {
    if (c.via === "pair") return c.partiesKey;
    const me = work?.identities?.[c.businessKey];
    if (!me) throw new Error("You're not in that job's coworker directory");
    return pairKey(me, c.publicKey);
  }

  /** The account at the other end of a conversation: the person's, the employer's, or the coworker's as the business listed it. */
  function addressOf(c: Contact): string | undefined {
    if (c.via === "coworker") return work ? coworkersFrom(workThread(work, c.businessKey)).find((x) => x.publicKey === c.publicKey)?.address : undefined;
    if (role === "worker") return work?.agreements.find((a) => a.partiesKey === c.partiesKey)?.employerAddress;
    return rail?.links.find((l) => l.partiesKey === c.partiesKey)?.address;
  }

  /** One conversation, ready to send a message in (a letter to `address`), its copy kept in the vault. */
  async function reachFor(c: Contact, name: string, address: string): Promise<Reach> {
    const client = new LetterBox({ wallet, to: address });
    if (c.via === "coworker") {
      const me = work?.identities?.[c.businessKey];
      if (!me) throw new Error("You're not in that job's coworker directory");
      return {
        name,
        conversationKey: await pairKey(me, c.publicKey),
        from: mySide(me.publicKey, c.publicKey),
        kinds: COWORKER_KINDS,
        nextOut: work?.coworkers?.[c.publicKey]?.nextOut ?? 0,
        client,
        keep: async (item) => {
          await updateCompany((co) => ({ ...co, work: updateCoworker(co.work!, c.publicKey, { businessKey: c.businessKey, name }, (t) => ({ ...t, ...addToThread(t, item) })) }));
        },
      };
    }
    const key = c.partiesKey;
    if (role === "worker") {
      return {
        name,
        conversationKey: key,
        from: "worker",
        nextOut: (work ? workThread(work, key) : undefined)?.nextOut ?? 0,
        client,
        keep: async (item) => {
          await updateCompany((co) => ({ ...co, work: updateWorkThread(co.work!, key, (t) => addToThread(t, item)) }));
        },
      };
    }
    const workerId = rail?.links.find((l) => l.partiesKey === key)?.workerId;
    if (!workerId) throw new Error(`${name} isn't linked to these books any more`);
    return {
      name,
      conversationKey: key,
      from: "business",
      nextOut: threadFor(mailbox, key)?.nextOut ?? 0,
      client,
      keep: async (item) => {
        await updateCompany((co) => ({ ...co, mailbox: updateThread(co.mailbox ?? emptyMailbox(), key, workerId, (t) => addToThread(t, item)) }));
      },
    };
  }

  return { conversationKey, addressOf, reachFor };
}
