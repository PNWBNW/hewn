// ---------------------------------------------------------------------------
// The terms of an offer, as the employer seals them into the mailbox (the
// offer's own terms slot) and as the agreement record on the chain commits to them:
//
//   terms_doc_hash = computeTermsDocHash(canonicalTerms(terms))
//
// where canonicalTerms is JSON with the keys in exactly this order. The
// employer's side of the app has an identical helper; the two must not drift.
// The person's app refuses an offer whose terms don't hash to the record.
// ---------------------------------------------------------------------------

import { computeTermsDocHash } from "@pnw/handshake/engine";
import { KINDS, MailboxError, type MailboxClient, lookupId, open, partiesKeyFromHex } from "@pnw/mailbox";
import { validateLetter, validateOfferFiles } from "../../books/offer_letter";
import { validateJobFields } from "../../books/terms_words";
import { validateWorkWeek } from "../../books/work_week";
import { unpackPayload } from "../compress";
import { offerTermsKind } from "../offer_files";
import { type Terms, WorkError, validateTerms } from "../../books/work";

/**
 * The exact bytes the employer hashed: keys in a fixed order, nothing else.
 * Version 2 adds the expiry, the letter's sections and the files at the end,
 * each in the order books/offer_letter.ts gives them, then the employment type
 * and the hours a week when the offer has them, then the work week when it has one.
 */
export function canonicalTerms(t: Terms): string {
  const v1 = {
    version: t.version,
    kind: t.kind,
    agreementId: t.agreementId,
    termsText: t.termsText,
    payType: t.payType,
    rate: t.rate,
    frequency: t.frequency,
    startDate: t.startDate,
    businessName: t.businessName,
    offeredAt: t.offeredAt,
  };
  if (t.version === 1) return JSON.stringify(v1);
  // Then the job fields, each only when the offer has it (offers before them keep their bytes).
  return JSON.stringify({
    ...v1,
    expiresAt: t.expiresAt,
    letter: validateLetter(t.letter),
    files: validateOfferFiles(t.files),
    ...validateJobFields(t),
    ...(t.workWeek !== undefined ? { workWeek: validateWorkWeek(t.workWeek) } : {}),
  });
}

const strip = (hex: string) => hex.replace(/^0x/i, "").toLowerCase();

/** The record's `terms_doc_hash` these terms must match, as 64 lower-case hex characters. */
export function termsDocHash(t: Terms): string {
  return strip(computeTermsDocHash(canonicalTerms(validateTerms(t))));
}

/** True when the terms hash to what the agreement record carries (either form of hex). */
export function termsMatchRecord(t: Terms, recordTermsDocHash: string): boolean {
  return termsDocHash(t) === strip(recordTermsDocHash);
}

export const TERMS_MISMATCH = "Terms don't match the agreement";

/** The terms document from its sealed bytes. */
export function parseTermsPayload(bytes: Uint8Array): Terms {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new WorkError("The terms couldn't be read");
  }
  return validateTerms(raw);
}

export type TermsFetch = { terms: Terms; lookup: string } | { terms: null; lookup: string; reason: "missing" | "off" | "unreadable"; message: string };

/**
 * The terms for one agreement from the mailbox, opened with the agreement's
 * parties key: from the offer's own slot, or, for an offer sent before those
 * existed, the shared slot 0 of kind `terms`. Never throws: a missing
 * document, a host with no mailbox and a document that won't open each come
 * back as a reason.
 */
export async function fetchTerms(partiesKeyHex: string, agreementId: string, client: Pick<MailboxClient, "get">): Promise<TermsFetch> {
  const own = await fetchTermsAt(partiesKeyHex, offerTermsKind(agreementId), client);
  if (own.terms || own.reason !== "missing") return own;
  const legacy = await fetchTermsAt(partiesKeyHex, KINDS.terms, client);
  return legacy.terms || legacy.reason !== "missing" ? legacy : own;
}

async function fetchTermsAt(partiesKeyHex: string, kind: string, client: Pick<MailboxClient, "get">): Promise<TermsFetch> {
  const key = partiesKeyFromHex(partiesKeyHex);
  try {
    const lookup = lookupId(key, kind, 0);
    let bytes: Uint8Array | null;
    try {
      bytes = await client.get(lookup);
    } catch (e) {
      if (e instanceof MailboxError && e.code === "NOT_CONFIGURED") return { terms: null, lookup, reason: "off", message: "Delivery is off on this server" };
      return { terms: null, lookup, reason: "unreadable", message: e instanceof Error ? e.message : "The terms couldn't be fetched" };
    }
    if (!bytes) return { terms: null, lookup, reason: "missing", message: "The terms haven't arrived yet" };
    try {
      // Offers sent as letters are deflated before sealing (chain/compress.ts); older ones aren't.
      return { terms: parseTermsPayload(await unpackPayload(await open(key, kind, 0, bytes))), lookup };
    } catch (e) {
      return { terms: null, lookup, reason: "unreadable", message: e instanceof Error ? e.message : "The terms couldn't be read" };
    }
  } finally {
    key.fill(0);
  }
}
