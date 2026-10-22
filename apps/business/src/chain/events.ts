// ---------------------------------------------------------------------------
// Shared events (books/shared_events.ts has the model), as letters on chain.
//
//   key out:   an `event_key` message in each guest's conversation with the
//              organizer (thread.ts), sealed with that conversation's key:
//              one letter each, once per circle and key number
//   posts:     sealed with the circle's key, kind `evt_<epoch>`, slots only the
//              organizer writes; one copy to every recipient through
//              send_many (letters.ts `ManyLetterBox`: one approval for each
//              eight). A guest list too long for one letter goes in parts.
//   reading:   the posts went to some guests and not others, so a reader's
//              slots have gaps: it looks a long way ahead of where it got to
//              (and a little behind, in case the wallet listed a later letter
//              first; keeping a post twice changes nothing). A post counts only
//              when its letter's sender, which only its owner can see, is the
//              organizer: every guest holds the circle's key, and none of them
//              may pass as the organizer.
//   answers:   an `event_answer` in the guest's own conversation, read with
//              the rest of their messages.
//
// Nothing here logs a key, a lookup, an address or an event.
// ---------------------------------------------------------------------------

import { ENVELOPE_OVERHEAD, MailboxError, lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import type { Company } from "../books/company";
import { coworkersFrom } from "../books/directory";
import { type Mailbox, threadFor } from "../books/mailbox";
import type { Rail } from "../books/rail";
import {
  type Circle,
  type Contact,
  type EventPost,
  type HeldKey,
  MAX_EVENT_PARTS,
  type PostGuest,
  type SharedCalendar,
  SharedEventError,
  emptyCalendar,
  eventWho,
  keysIn,
  readKey,
  readPast,
  receivePost,
  validateEventPost,
} from "../books/shared_events";
import { type Side, type ThreadItem, newMessageId } from "../books/thread";
import { type Work, workThread } from "../books/work";
import { pairKey } from "./coworkers";
import { packPayload, unpackPayload } from "./compress";
import { LETTER_BYTES, type LetterRecord } from "./letters";
import { type PostInput, type ThreadKinds, postToThread } from "./thread";

/** The kind posts under key `epoch` travel in. */
export const eventKind = (epoch: number): string => `evt_${epoch}`;

/** How far past the last post a reader looks, and how far back. */
export const READ_AHEAD = 256;
export const READ_BACK = 8;
const MAX_TAKEN = 8;
/** Room left in each letter: a post's random id deflates a byte or two differently from the one it was sized with. */
const SLACK = 16;

const sizeOf = async (post: EventPost) => (await packPayload(new TextEncoder().encode(JSON.stringify(post)))).length + ENVELOPE_OVERHEAD;

/**
 * The posts one revision goes out in: part 0 carries what the event is and as
 * many guests as fit, each later part more guests. Throws when what the event
 * is doesn't fit in a letter alone, or the list needs too many parts.
 */
export async function eventParts(
  base: Pick<EventPost, "eventId" | "rev" | "since" | "head">,
  guests: readonly PostGuest[],
  now: Date = new Date(),
  maxBytes = LETTER_BYTES,
): Promise<EventPost[]> {
  // Sized with a random id, as each part will have: zeros would deflate to nothing and size it short.
  const sizingId = newMessageId();
  const make = (part: number, list: PostGuest[]): EventPost => {
    const p: EventPost = { version: 1, id: sizingId, sentAt: now.toISOString(), eventId: base.eventId, rev: base.rev, since: base.since, part, parts: MAX_EVENT_PARTS, guests: list };
    if (part === 0) p.head = base.head!;
    return p;
  };
  const room = maxBytes - SLACK;
  if ((await sizeOf(make(0, []))) > room) throw new SharedEventError("The event's details are too long for one letter: shorten the notes, the place or the link");
  const groups: PostGuest[][] = [[]];
  for (const g of guests) {
    const current = groups.at(-1)!;
    if ((await sizeOf(make(groups.length - 1, [...current, g]))) <= room) current.push(g);
    else groups.push([g]);
  }
  if (groups.length > MAX_EVENT_PARTS) throw new SharedEventError("The guest list is too long to send at once");
  return groups.map((list, part) => validateEventPost({ ...make(part, list), id: newMessageId(), parts: groups.length }));
}

/** One guest's conversation with the organizer, ready to send in: its key, the organizer's side and kinds, the next slot, and where the copy is kept. */
export type Reach = {
  name: string;
  /** Which guest, when names might repeat (books/shared_events.ts `contactRef`). */
  ref?: string;
  conversationKey: string;
  from: Side;
  kinds?: ThreadKinds;
  nextOut: number;
  client: PostInput["client"];
  keep: (item: ThreadItem) => Promise<void>;
};

export type KeysOut = { sent: string[]; failed: { name: string; ref: string; message: string }[] };

/** Gives the circle's current key to each guest who hasn't it, one letter each. One failure doesn't stop the rest. */
export async function sendEventKeys(reaches: readonly Reach[], circle: Circle, feeMode?: FeeMode): Promise<KeysOut> {
  const out: KeysOut = { sent: [], failed: [] };
  for (const r of reaches) {
    try {
      const item = await postToThread({
        client: r.client,
        ...(feeMode ? { feeMode } : {}),
        partiesKey: r.conversationKey,
        from: r.from,
        ...(r.kinds ? { kinds: r.kinds } : {}),
        nextOut: r.nextOut,
        body: { type: "event_key", circleId: circle.id, epoch: circle.epoch, key: circle.key },
      });
      await r.keep(item);
      out.sent.push(r.name);
    } catch (e) {
      out.failed.push({ name: r.name, ref: r.ref ?? r.name, message: e instanceof Error ? e.message : "It didn't go out" });
    }
  }
  return out;
}

/** Seals one post with the circle's key into its next free slot and sends it to everyone (`client` is a ManyLetterBox). Returns the slot it took. */
export async function postEvent(client: PostInput["client"], circle: Circle, post: EventPost, feeMode?: FeeMode): Promise<number> {
  const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(validateEventPost(post))));
  if (bytes.length + ENVELOPE_OVERHEAD > LETTER_BYTES) throw new SharedEventError("That part of the event is too long for one letter");
  const key = partiesKeyFromHex(circle.key);
  try {
    for (let seq = circle.nextOut; seq < circle.nextOut + MAX_TAKEN; seq++) {
      const sealed = await seal(key, eventKind(circle.epoch), seq, bytes);
      try {
        await (feeMode ? client.put(sealed.lookup, sealed.envelope, { feeMode }) : client.put(sealed.lookup, sealed.envelope));
        return seq;
      } catch (e) {
        if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
      }
    }
  } finally {
    key.fill(0);
  }
  throw new SharedEventError("Couldn't find a free slot for the event; try again");
}

/** A circle key this account holds, with the organizer's account (the only sender it believes) and this account's tag with them. */
export type Listening = { held: HeldKey; organizer: string; me: string };

export type ReadEventsResult = { received: number; forged: number; skipped: number };

/**
 * Reads every circle this account was given, from a little before where it
 * got to up to READ_AHEAD past the last post it found, and keeps each post
 * from the organizer (`save` applies the change to the calendar in the vault).
 */
export async function readEvents({
  letters,
  listening,
  calendar,
  save,
  now,
}: {
  letters: { getAll(lookup: string): Promise<LetterRecord[]> };
  listening: readonly Listening[];
  calendar: SharedCalendar;
  save: (change: (c: SharedCalendar) => SharedCalendar) => Promise<void>;
  now?: () => string;
}): Promise<ReadEventsResult> {
  const stamp = now ?? (() => new Date().toISOString());
  const result: ReadEventsResult = { received: 0, forged: 0, skipped: 0 };
  for (const { held, organizer, me } of listening) {
    const kind = eventKind(held.epoch);
    const at = readKey(held.from, held.circleId, held.epoch);
    const key = partiesKeyFromHex(held.key);
    try {
      const from = calendar.reads[at] ?? 0;
      let end = from + READ_AHEAD;
      for (let seq = Math.max(0, from - READ_BACK); seq < end; seq++) {
        const records = await letters.getAll(lookupId(key, kind, seq));
        if (records.length === 0) continue;
        const real = records.filter((r) => r.sender === organizer);
        result.forged += records.length - real.length;
        for (const r of real) {
          let post: EventPost;
          try {
            post = validateEventPost(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(key, kind, seq, r.envelope)))));
          } catch {
            result.skipped++;
            continue;
          }
          const s = seq;
          await save((c) => readPast(receivePost(c, held.from, held.circleId, post, me, stamp()), at, s));
          result.received++;
        }
        if (real.length > 0) end = Math.max(end, seq + 1 + READ_AHEAD);
      }
    } finally {
      key.fill(0);
    }
  }
  return result;
}

// ---- Who this account listens to ---------------------------------------------------------

/** A business listens to each key a team member gave it, believing only that person's account. */
export function businessListening(rail: Rail | null | undefined, mailbox: Mailbox | null | undefined): Listening[] {
  return (rail?.links ?? []).flatMap((link) => {
    if (!link.partiesKey) return [];
    const from: Contact = { via: "pair", partiesKey: link.partiesKey };
    return keysIn(from, threadFor(mailbox, link.partiesKey)).map((held) => ({ held, organizer: link.address, me: eventWho(link.partiesKey!) }));
  });
}

/** A person listens to each employer's keys, and each coworker's (believing only the account the business listed for them). */
export async function workListening(work: Work): Promise<Listening[]> {
  const out: Listening[] = [];
  for (const a of work.agreements) {
    const from: Contact = { via: "pair", partiesKey: a.partiesKey };
    for (const held of keysIn(from, workThread(work, a.partiesKey))) out.push({ held, organizer: a.employerAddress, me: eventWho(a.partiesKey) });
  }
  for (const [publicKey, thread] of Object.entries(work.coworkers ?? {})) {
    const from: Contact = { via: "coworker", businessKey: thread.businessKey, publicKey };
    const keys = keysIn(from, thread);
    const identity = work.identities?.[thread.businessKey];
    const address = coworkersFrom(workThread(work, thread.businessKey)).find((c) => c.publicKey === publicKey)?.address;
    if (keys.length === 0 || !identity || !address) continue;
    const me = eventWho(await pairKey(identity, publicKey));
    for (const held of keys) out.push({ held, organizer: address, me });
  }
  return out;
}

/** Reads the shared events once a check has read the conversations (where the keys arrive). Nothing to listen to, nothing read. */
export async function checkEvents(
  letters: { getAll(lookup: string): Promise<LetterRecord[]> },
  listening: readonly Listening[],
  calendar: SharedCalendar | null | undefined,
  updateCompany: (op: (c: Company) => Company) => Promise<Company>,
): Promise<ReadEventsResult | null> {
  if (listening.length === 0) return null;
  return readEvents({
    letters,
    listening,
    calendar: calendar ?? emptyCalendar(),
    save: async (change) => {
      await updateCompany((c) => ({ ...c, calendar: change(c.calendar ?? emptyCalendar()) }));
    },
  });
}
