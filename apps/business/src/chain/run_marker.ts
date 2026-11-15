// ---------------------------------------------------------------------------
// Run markers on chain: the note a device leaves before it pays a run
// (@pnw/rail marker.ts holds the format and the rules), kept as a letter to
// the business's own account so every device signed in to that account, with
// these books, can read it.
//
//   sealed   the marker's text, deflated (chain/compress.ts), then sealed with
//            the books' own data key the way a receipt file is
//            (`VaultSession.sealAttachment`, bound to the vault and to
//            `pm-<slot>`). Only these books open it: a copy restored on
//            another device does, with the passphrase or the recovery key.
//   slot     markers sit in numbered slots, 0, 1, 2, …; a slot's lookup is a
//            hash of the backup's finder key (the username and the account,
//            never the passphrase: chain/books_backup.ts), "pay-marker" and
//            the number. A marker goes in the first slot with no letter in it.
//            Two devices sending at once write under the same slot: both
//            letters are read.
//   order    a marker counts from the block its letter was accepted in, then
//            by its transaction id (marker.ts `ListedMarker`): both come from
//            the letter's record as Shield lists it.
//
// Sending is one Shield approval, and waits until the network has accepted
// the letter (`LetterBox.put`). A marker of up to 12 lines is one letter; a
// longer one is one page.
//
// Reading walks the slots from 0 for as long as a slot holds a letter. A
// letter that doesn't open with these books' key, or doesn't hold a marker,
// is passed over: anyone can send a letter to an account, and only these
// books can seal one that opens. A marker Shield gives no block or
// transaction for can't be placed in order, and reading refuses rather than
// guess.
//
// Nothing here logs a key, a lookup, an account or a marker.
// ---------------------------------------------------------------------------

import { MailboxError } from "@pnw/mailbox";
import { type ListedMarker, type RunMarker, decodeMarker, encodeMarker, orderMarkers } from "@pnw/rail";
import { type SealedAttachment, type VaultSession, sha256Hex } from "@pnw/vault";
import { finderKey } from "./books_backup";
import { packPayload, unpackPayload } from "./compress";
import { transactionIdOf } from "./history_probe";
import { LETTER_BYTES, LetterBox, type LetterWallet, SEND_FUNCTION, SEND_PAGE_FUNCTION } from "./letters";
import type { ExecuteOptions } from "./work/execute";

export class RunMarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunMarkerError";
  }
}

const VERSION = 1;
const IV_BYTES = 12;
/** Version, iv, and the ciphertext's length. */
const HEADER_BYTES = 1 + IV_BYTES + 2;
/** The most slots one reading walks. A marker is sent once a run, and again only when someone is paid again from another record. */
const MAX_SLOTS = 20_000;
/**
 * A marker of this many lines or fewer goes as one letter: 12 lines that each name a record come to
 * about 980 of a letter's 1,052 bytes. (Were its lines to hold more than a release ever writes, it
 * would go as a page, as anything too long for a letter does.) A marker of more lines is one page.
 */
export const MARKER_LETTER_LINES = 12;

/** The letters call that carries a marker of this many lines, for saying beforehand what Shield will be asked. */
export const markerFunction = (lines: number): string => (lines > MARKER_LETTER_LINES ? SEND_PAGE_FUNCTION : SEND_FUNCTION);

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Base64 a chunk at a time (spreading a large array into one call overflows the stack). */
function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * What a marker needs from the open books, and no more: sealing and opening a small file with
 * their data key, as a receipt file is sealed. The key itself stays in the vault.
 */
export type MarkerSeal = {
  seal(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<SealedAttachment>;
  open(sealed: SealedAttachment): Promise<Uint8Array<ArrayBuffer>>;
};

/** A seal over an open session (tests, and the provider). */
export const sealOf = (session: VaultSession): MarkerSeal => ({ seal: (id, bytes) => session.sealAttachment(id, bytes), open: (sealed) => session.openAttachment(sealed) });

/** The letter box markers travel through: `put` sends to the account itself. */
export type MarkerBox = Pick<LetterBox, "put" | "getAll" | "refresh">;

/** One slot's lookup. `finder`: the backup's finder key (`finderKey`), so a restored copy of the books finds the markers too. */
export const markerLookup = (finder: string, slot: number): Promise<string> => sha256Hex(enc.encode(`${finder}:pay-marker:${slot}`));

const sealId = (slot: number) => `pm-${slot}`;

/**
 * [version][iv (12)][length of the ciphertext (2)][ciphertext][zeros]. The zeros are there only on
 * a marker of more than `MARKER_LETTER_LINES` lines that would still fit a letter: it is filled out
 * past a letter's size, so which call carries a marker depends on how many lines it has and on
 * nothing else (`markerFunction`).
 */
async function sealMarker(seal: MarkerSeal, slot: number, marker: RunMarker): Promise<Uint8Array> {
  const sealed = await seal.seal(sealId(slot), (await packPayload(enc.encode(encodeMarker(marker)))) as Uint8Array<ArrayBuffer>);
  const iv = unb64(sealed.iv);
  const data = unb64(sealed.data);
  if (iv.length !== IV_BYTES || data.length > 0xffff) throw new RunMarkerError("The books sealed a note in a way this app doesn't read");
  const length = HEADER_BYTES + data.length;
  const out = new Uint8Array(marker.lines.length > MARKER_LETTER_LINES ? Math.max(length, LETTER_BYTES + 1) : length);
  out.set([VERSION], 0);
  out.set(iv, 1);
  out.set([data.length >> 8, data.length & 0xff], 1 + IV_BYTES);
  out.set(data, HEADER_BYTES);
  return out;
}

/** The marker in one letter of a slot, or null when the letter isn't one these books sealed there. */
async function openMarker(seal: MarkerSeal, slot: number, envelope: Uint8Array): Promise<RunMarker | null> {
  if (envelope.length <= HEADER_BYTES || envelope[0] !== VERSION) return null;
  const length = (envelope[1 + IV_BYTES]! << 8) | envelope[2 + IV_BYTES]!;
  if (HEADER_BYTES + length > envelope.length || envelope.subarray(HEADER_BYTES + length).some((b) => b !== 0)) return null;
  try {
    const opened = await seal.open({ id: sealId(slot), iv: b64(envelope.subarray(1, 1 + IV_BYTES)), data: b64(envelope.subarray(HEADER_BYTES, HEADER_BYTES + length)) });
    return decodeMarker(dec.decode(await unpackPayload(opened)));
  } catch {
    return null; // someone else's letter, another slot's, or not a marker
  }
}

/** The first slot with no letter in it, and every marker in the slots before it. */
async function walk(box: MarkerBox, seal: MarkerSeal, finder: string): Promise<{ listed: ListedMarker[]; free: number }> {
  box.refresh(); // what the account holds now
  const listed: ListedMarker[] = [];
  const seen = new Set<string>();
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    const letters = await box.getAll(await markerLookup(finder, slot));
    if (letters.length === 0) return { listed: orderMarkers(listed), free: slot };
    for (const letter of letters) {
      const marker = await openMarker(seal, slot, letter.envelope);
      if (!marker || seen.has(marker.id)) continue;
      const txId = transactionIdOf(letter.transactionId ?? "");
      if (letter.blockHeight === undefined || txId === null) {
        throw new RunMarkerError("Shield didn't say when a note to this account was accepted, so the order of the notes can't be told. Update Shield, then try again.");
      }
      seen.add(marker.id);
      listed.push({ marker, height: letter.blockHeight, txId });
    }
  }
  throw new RunMarkerError("This account holds more notes about pay runs than can be read");
}

/**
 * Every run marker the account holds that these books can open, earliest first. Asks nothing of
 * the person: it reads the account's letters once. Throws when Shield can't list them, or lists a
 * marker without the block and transaction that place it.
 */
export async function readMarkers(box: MarkerBox, seal: MarkerSeal, finder: string): Promise<ListedMarker[]> {
  return (await walk(box, seal, finder)).listed;
}

/** How many slots one send tries when another device of the account takes each one first. */
const SLOT_TRIES = 3;

/**
 * Sends one marker as a letter to the account itself, in the first empty slot: one Shield
 * approval, and it resolves once the network has accepted the letter. If Shield throws, the slots
 * are read again, and it resolves normally only when this marker is there (a letter can land and
 * Shield still report an error); otherwise it throws what Shield threw. A slot another device of
 * the account wrote to after it was read is refused before Shield is asked anything: the slots are
 * read again and the marker goes in a later one.
 */
export async function sendMarker(box: MarkerBox, seal: MarkerSeal, finder: string, marker: RunMarker): Promise<void> {
  encodeMarker(marker); // refuses a marker that couldn't be read back, before anything is asked
  let taken = -1;
  for (let tries = 1; ; tries++) {
    const free = Math.max((await walk(box, seal, finder)).free, taken + 1);
    const envelope = await sealMarker(seal, free, marker);
    try {
      await box.put(await markerLookup(finder, free), envelope);
      return;
    } catch (e) {
      if (e instanceof MailboxError && e.code === "CONFLICT") {
        if (tries < SLOT_TRIES) {
          taken = free;
          continue;
        }
        throw new RunMarkerError("Another device sent a note to this account at the same moment. Try again in a minute.");
      }
      const landed = await walk(box, seal, finder).then(
        (now) => now.listed.some((l) => l.marker.id === marker.id),
        () => false,
      );
      if (!landed) throw e;
      return;
    }
  }
}

export type MarkerWait = {
  /** How long to wait for the marker to be listed. Default 2 minutes. */
  capMs?: number;
  /** Between two readings. Default 4 seconds. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Reads the markers again until the one with this id is listed, and resolves with everything
 * listed then: Shield lists a block at a time, so whatever was accepted before it is there too.
 * Throws when it isn't listed within the cap.
 */
export async function awaitOwnMarker(box: MarkerBox, seal: MarkerSeal, finder: string, id: string, wait: MarkerWait = {}): Promise<ListedMarker[]> {
  const capMs = wait.capMs ?? 2 * 60_000;
  const pollMs = wait.pollMs ?? 4_000;
  const sleep = wait.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = wait.now ?? (() => Date.now());
  const started = now();
  for (;;) {
    const listed = await readMarkers(box, seal, finder);
    if (listed.some((l) => l.marker.id === id)) return listed;
    if (now() - started >= capMs) throw new RunMarkerError("The note to your own account hasn't shown in Shield yet. Try again in a minute.");
    await sleep(pollMs);
  }
}

// ---- What a release is handed ---------------------------------------------------------------

/** The markers of one account, as a release uses them (release.ts). */
export type MarkerDesk = {
  /** Every marker listed now, earliest first. Asks nothing of the person. */
  read(): Promise<ListedMarker[]>;
  /** Sends one marker (one approval) and resolves once it is accepted. */
  send(marker: RunMarker): Promise<void>;
  /** Waits until the marker with this id is listed; resolves with everything listed then. */
  awaitListed(id: string): Promise<ListedMarker[]>;
};

/** The markers of the account `address`, read and sent through `wallet`, sealed by the open books. */
export function markerDesk(input: { wallet: LetterWallet; address: string; username: string; seal: MarkerSeal; execute?: ExecuteOptions; wait?: MarkerWait }): MarkerDesk {
  const box = new LetterBox({ wallet: input.wallet, to: input.address, ...(input.execute ? { execute: input.execute } : {}) });
  const finder = finderKey(input.username, input.address);
  return {
    read: async () => readMarkers(box, input.seal, await finder),
    send: async (marker) => sendMarker(box, input.seal, await finder, marker),
    awaitListed: async (id) => awaitOwnMarker(box, input.seal, await finder, id, input.wait),
  };
}
