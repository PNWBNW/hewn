// ---------------------------------------------------------------------------
// Collecting what the team has sent the business (today: a week of hours,
// kind `timesheet`): letters on chain (chain/letters.ts), then the old
// mailbox for any sent before. For each linked agreement with a parties
// key, the slots are read from the next unread one upward until a miss; each
// envelope is opened with the agreement's key, checked field by field, kept in
// the vault through `store`, and only then dropped from the mailbox. One that
// won't open or won't check is skipped (its slot moves on through `skip`) and
// reported, so a bad document never blocks the ones behind it.
//
// Pure apart from the injected reader and vault writes. Nothing here logs a key, a lookup or an hour.
// ---------------------------------------------------------------------------

import { MailboxError, type MailboxClient, open, partiesKeyFromHex } from "@pnw/mailbox";
import { type Mailbox, type ReceivedHours, nextHoursSeq, threadFor, validateTimesheetPayload } from "../books/mailbox";
import { mailboxLinks } from "../books/mailbox_feed";
import type { Rail } from "../books/rail";
import { unpackPayload } from "./compress";
import { findSlot, laterSlotExists, slotKeys } from "./key_ring";
import { sendReceipt } from "./receipts";
import { TIMESHEET_KIND } from "./work/timesheet";

export type ScanHoursInput = {
  rail: Rail;
  mailbox: Mailbox | null;
  /** With `put`, a receipt goes back for each document kept (chain/receipts.ts). */
  client?: Pick<MailboxClient, "get" | "drop"> & Partial<Pick<MailboxClient, "put">>;
  /** Or a reader for each person's letters, believing only their account (chain/letters.ts `letterReader`). */
  clientFor?: (address: string) => Pick<MailboxClient, "get" | "drop">;
  /** Keeps one week in the vault (and moves its slot on). Called before the pin is dropped. */
  store: (hours: ReceivedHours) => Promise<void>;
  /** Moves an agreement's slot past an envelope that couldn't be kept. */
  skip: (agreementId: string, seq: number) => Promise<void>;
  now?: () => string;
  /** The most slots read per agreement in one scan. */
  limit?: number;
};

export type SkippedHours = { agreementId: string; seq: number; message: string };

export type ScanHoursResult = {
  received: ReceivedHours[];
  skipped: SkippedHours[];
  /** The host has no mailbox (503): nothing was read. */
  off: boolean;
  /** A read failed for another reason; the scan stopped there. */
  failed?: string;
  /** How many agreements were checked. */
  checked: number;
};

/** Reads every new week of hours for every linked agreement. Never throws; the result says what happened. */
export async function scanHours({ rail, mailbox, client: shared, clientFor, store, skip, now, limit }: ScanHoursInput): Promise<ScanHoursResult> {
  const stamp = now ?? (() => new Date().toISOString());
  const most = limit ?? 100;
  const links = mailboxLinks(rail);
  const result: ScanHoursResult = { received: [], skipped: [], off: false, checked: links.length };
  const known = mailbox ?? { version: 1 as const, hours: [] };
  for (const link of links) {
    const client: Pick<MailboxClient, "get" | "drop"> & Partial<Pick<MailboxClient, "put">> = clientFor ? clientFor(link.address) : shared!;
    // Each slot is sealed with the agreement's key or, after the handshake, a pair's (chain/key_ring.ts).
    const ring = threadFor(mailbox, link.partiesKey!)?.ring;
    const keys = await slotKeys(link.partiesKey!, ring);
    let seq = nextHoursSeq(known, link.agreementId);
    for (let read = 0; read < most; read++, seq++) {
      let found: Awaited<ReturnType<typeof findSlot>>;
      try {
        found = await findSlot((l) => client.get(l), keys, TIMESHEET_KIND, seq);
        if (!found && ring && (await laterSlotExists((l) => client.get(l), keys, TIMESHEET_KIND, seq))) {
          // Sealed with a key these books no longer hold; a later week has come, so this one is passed.
          result.skipped.push({ agreementId: link.agreementId, seq, message: "Sealed with a key these books no longer have" });
          await skip(link.agreementId, seq);
          continue;
        }
      } catch (e) {
        if (e instanceof MailboxError && e.code === "NOT_CONFIGURED") {
          result.off = true;
          return result;
        }
        result.failed = e instanceof Error ? e.message : "The mailbox couldn't be read";
        return result;
      }
      if (!found) break; // the end of this agreement's mailbox
      const { lookup, bytes } = found;
      let item: ReceivedHours;
      const key = partiesKeyFromHex(found.key);
      try {
        const opened = await unpackPayload(await open(key, TIMESHEET_KIND, seq, bytes));
        const payload = validateTimesheetPayload(JSON.parse(new TextDecoder().decode(opened)), link.agreementId);
        item = {
          agreementId: link.agreementId,
          seq,
          lookup,
          receivedAt: stamp(),
          workerId: link.workerId,
          weekStart: payload.weekStart,
          entries: payload.entries,
          totalMinutes: payload.totalMinutes,
          sentAt: payload.sentAt,
        };
      } catch (e) {
        result.skipped.push({ agreementId: link.agreementId, seq, message: e instanceof Error ? e.message : "The hours couldn't be read" });
        await skip(link.agreementId, seq);
        continue; // the pin stays: nothing of it is in the vault
      } finally {
        key.fill(0);
      }
      await store(item); // in the vault first…
      result.received.push(item);
      await client.drop(lookup).catch(() => {}); // …then the pin goes; a pin that lingers is harmless
      if (client.put) await sendReceipt({ put: client.put.bind(client) }, link.partiesKey!, TIMESHEET_KIND, seq); // the sender learns it arrived
    }
  }
  return result;
}
