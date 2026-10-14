// ---------------------------------------------------------------------------
// Collecting paystubs from the mailbox (docs/INTEGRATION_AUDIT.md §2.2 step
// 3, §4.4). For each agreement the person holds, the slots of kind
// `paystub` are read from the next unseen one upward until a miss; each
// envelope is opened with the agreement's parties key, checked for shape,
// its paystub hash recomputed from the document exactly as the employer's
// books did, kept in the vault through `store`, and only then dropped from
// the mailbox. An envelope that won't open or won't parse is skipped (its
// slot moves on through `skip`) and reported, so one bad document never
// blocks the ones behind it.
//
// Pure apart from the client calls: the mailbox client, the vault writes
// and the clock are injected. Nothing here logs a key, a lookup or a document.
// ---------------------------------------------------------------------------

import { KINDS, MailboxError, type MailboxClient, lookupId, open, partiesKeyFromHex } from "@pnw/mailbox";
import { receivedPaystubHash } from "../../books/paystub_document";
import { type ReceivedPaystub, type Work, WorkError, nextWorkSeq } from "../../books/work";

/** What the employer's app seals (src/chain/deliver.ts), read back. */
export type PaystubEnvelope = {
  version: 1;
  kind: "paystub";
  document: unknown;
  settlement: { transactionId: string; height?: number; feeMicrocredits?: string };
  businessName: string;
};

export type ScanInput = {
  work: Work;
  client: Pick<MailboxClient, "get" | "drop">;
  /** Keeps one paystub in the vault (and moves its slot on). Called before the pin is dropped. */
  store: (paystub: ReceivedPaystub) => Promise<void>;
  /** Moves an agreement's slot past an envelope that couldn't be kept. */
  skip: (agreementId: string, seq: number) => Promise<void>;
  now?: () => string;
  /** The most slots read per agreement in one scan. */
  limit?: number;
};

export type Skipped = { agreementId: string; seq: number; message: string };

export type ScanResult = {
  received: ReceivedPaystub[];
  skipped: Skipped[];
  /** The host has no mailbox (503): nothing was read. */
  off: boolean;
  /** A read failed for another reason; the scan stopped there. */
  failed?: string;
};

export const INBOX_OFF_MESSAGE = "Paystub delivery is off on this server";

/** Parses the opened envelope; throws on any missing or ill-shaped part. */
export function parsePaystubEnvelope(bytes: Uint8Array): PaystubEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new WorkError("The paystub couldn't be read");
  }
  const e = raw as Partial<PaystubEnvelope> | null;
  if (!e || typeof e !== "object") throw new WorkError("The paystub isn't a document");
  if (e.version !== 1) throw new WorkError("Unknown paystub version");
  if (e.kind !== KINDS.paystub) throw new WorkError("That document isn't a paystub");
  if (typeof e.businessName !== "string") throw new WorkError("The paystub names no business");
  const s = e.settlement as Partial<PaystubEnvelope["settlement"]> | null;
  if (!s || typeof s !== "object" || typeof s.transactionId !== "string" || !s.transactionId) throw new WorkError("The paystub has no payment id");
  const settlement: PaystubEnvelope["settlement"] = { transactionId: s.transactionId };
  if (s.height !== undefined) {
    if (typeof s.height !== "number" || !Number.isInteger(s.height)) throw new WorkError("The paystub's height must be a whole number");
    settlement.height = s.height;
  }
  if (s.feeMicrocredits !== undefined) {
    if (typeof s.feeMicrocredits !== "string" || !/^\d+$/.test(s.feeMicrocredits)) throw new WorkError("The paystub's fee must be a whole number");
    settlement.feeMicrocredits = s.feeMicrocredits;
  }
  if (e.document === undefined || e.document === null) throw new WorkError("The paystub has no document");
  return { version: 1, kind: "paystub", document: e.document, settlement, businessName: e.businessName };
}

/** The agreements whose mailboxes are scanned: everything that was ever accepted. */
const scannable = (work: Work) => work.agreements.filter((a) => a.status !== "pending");

/** Reads every new paystub for every agreement. Never throws; the result says what happened. */
export async function scanPaystubs({ work, client, store, skip, now, limit }: ScanInput): Promise<ScanResult> {
  const stamp = now ?? (() => new Date().toISOString());
  const most = limit ?? 100;
  const result: ScanResult = { received: [], skipped: [], off: false };
  for (const agreement of scannable(work)) {
    const key = partiesKeyFromHex(agreement.partiesKey);
    try {
      let seq = nextWorkSeq(work, agreement.agreementId, "paystub");
      for (let read = 0; read < most; read++, seq++) {
        const lookup = lookupId(key, KINDS.paystub, seq);
        let bytes: Uint8Array | null;
        try {
          bytes = await client.get(lookup);
        } catch (e) {
          if (e instanceof MailboxError && e.code === "NOT_CONFIGURED") {
            result.off = true;
            return result;
          }
          result.failed = e instanceof Error ? e.message : "The mailbox couldn't be read";
          return result;
        }
        if (!bytes) break; // the end of this agreement's mailbox
        let paystub: ReceivedPaystub;
        try {
          const envelope = parsePaystubEnvelope(await open(key, KINDS.paystub, seq, bytes));
          const { hash } = receivedPaystubHash(envelope.document);
          paystub = {
            agreementId: agreement.agreementId,
            seq,
            lookup,
            receivedAt: stamp(),
            document: envelope.document,
            settlement: envelope.settlement,
            businessName: envelope.businessName,
            paystubHash: hash,
          };
        } catch (e) {
          result.skipped.push({ agreementId: agreement.agreementId, seq, message: e instanceof Error ? e.message : "The paystub couldn't be read" });
          await skip(agreement.agreementId, seq);
          continue; // the pin stays: nothing of it is in the vault
        }
        await store(paystub); // in the vault first…
        result.received.push(paystub);
        await client.drop(lookup).catch(() => {}); // …then the pin goes; a pin that lingers is harmless
      }
    } finally {
      key.fill(0);
    }
  }
  return result;
}
