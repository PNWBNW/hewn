import { KINDS, MailboxError, lookupId, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { computeTermsDocHash } from "@pnw/handshake/engine";
import { describe, expect, it } from "vitest";
import type { Terms } from "../../books/work";
import { offerTermsKind } from "../offer_files";
import { canonicalTerms, fetchTerms, parseTermsPayload, termsDocHash, termsMatchRecord } from "./terms";

// The fixture the employer's side pins too: if this hash changes, offers stop verifying.
const TERMS: Terms = {
  version: 1,
  kind: "terms",
  agreementId: "0101010101010101010101010101010101010101010101010101010101010101",
  termsText: "Framing carpenter, 40 hours a week, tools provided.",
  payType: "hourly",
  rate: "3000",
  frequency: "weekly",
  startDate: "2026-10-19",
  businessName: "Day Construction",
  offeredAt: "2026-10-14T16:00:00.000Z",
};

const PINNED_HASH = "0b56276bce6516f482492af7b1acbfc5d40690f20ab1967a45151edc4986719f";

describe("canonical terms", () => {
  it("is JSON with the keys in the agreed order, whatever order the object had", () => {
    const shuffled = Object.fromEntries(Object.entries(TERMS).reverse()) as Terms;
    expect(canonicalTerms(shuffled)).toBe(
      '{"version":1,"kind":"terms","agreementId":"0101010101010101010101010101010101010101010101010101010101010101","termsText":"Framing carpenter, 40 hours a week, tools provided.","payType":"hourly","rate":"3000","frequency":"weekly","startDate":"2026-10-19","businessName":"Day Construction","offeredAt":"2026-10-14T16:00:00.000Z"}',
    );
  });

  it("hashes to the record's terms_doc_hash: computeTermsDocHash of the canonical text", () => {
    expect(termsDocHash(TERMS)).toBe(computeTermsDocHash(canonicalTerms(TERMS)).slice(2));
    expect(termsDocHash(TERMS)).toMatch(/^[0-9a-f]{64}$/);
    expect(termsDocHash(TERMS)).toBe(PINNED_HASH);
  });

  it("matches the record's hash with or without 0x, and not after a change", () => {
    expect(termsMatchRecord(TERMS, "0x" + PINNED_HASH)).toBe(true);
    expect(termsMatchRecord(TERMS, PINNED_HASH.toUpperCase())).toBe(true);
    expect(termsMatchRecord({ ...TERMS, rate: "3001" }, PINNED_HASH)).toBe(false);
    expect(termsMatchRecord({ ...TERMS, agreementId: "02".repeat(32) }, PINNED_HASH)).toBe(false);
  });

  it("refuses ill-formed terms before hashing", () => {
    expect(() => termsDocHash({ ...TERMS, payType: "daily" } as never)).toThrow();
    expect(() => parseTermsPayload(new TextEncoder().encode("not json"))).toThrow(/couldn't be read/);
    expect(parseTermsPayload(new TextEncoder().encode(JSON.stringify(TERMS)))).toEqual(TERMS);
  });
});

describe("fetchTerms", () => {
  const KEY_HEX = "ab".repeat(32);
  const key = partiesKeyFromHex(KEY_HEX);
  const AID = "0a".repeat(32);
  const OWN = offerTermsKind(AID);

  it("opens the terms in the offer's own slot first", async () => {
    const sealed = await seal(key, OWN, 0, new TextEncoder().encode(JSON.stringify(TERMS)));
    const asked: string[] = [];
    const result = await fetchTerms(KEY_HEX, AID, { get: async (l) => (asked.push(l), l === sealed.lookup ? sealed.envelope : null) });
    expect(OWN).toBe("terms_0a0a0a0a0a0a0a0a0a0a0a0a");
    expect(asked).toEqual([lookupId(key, OWN, 0)]);
    expect(result).toEqual({ terms: TERMS, lookup: sealed.lookup });
  });

  it("falls back to the shared slot 0 of kind terms for an offer sent before per-offer slots", async () => {
    const sealed = await seal(key, KINDS.terms, 0, new TextEncoder().encode(JSON.stringify(TERMS)));
    const asked: string[] = [];
    const result = await fetchTerms(KEY_HEX, AID, { get: async (l) => (asked.push(l), l === sealed.lookup ? sealed.envelope : null) });
    expect(asked).toEqual([lookupId(key, OWN, 0), lookupId(key, KINDS.terms, 0)]);
    expect(result).toEqual({ terms: TERMS, lookup: sealed.lookup });
    const none = await fetchTerms(KEY_HEX, AID, { get: async () => null });
    expect(none).toMatchObject({ terms: null, reason: "missing", lookup: lookupId(key, OWN, 0) });
  });

  it("reports a missing document, a host without a mailbox, and a document it can't open", async () => {
    expect(await fetchTerms(KEY_HEX, AID, { get: async () => null })).toMatchObject({ terms: null, reason: "missing" });
    expect(await fetchTerms(KEY_HEX, AID, { get: async () => { throw new MailboxError("NOT_CONFIGURED", "off"); } })).toMatchObject({ terms: null, reason: "off" });
    expect(await fetchTerms(KEY_HEX, AID, { get: async () => { throw new MailboxError("REQUEST_FAILED", "502"); } })).toMatchObject({ terms: null, reason: "unreadable", message: "502" });
    const other = await seal(partiesKeyFromHex("cd".repeat(32)), OWN, 0, new TextEncoder().encode(JSON.stringify(TERMS)));
    expect(await fetchTerms(KEY_HEX, AID, { get: async () => other.envelope })).toMatchObject({ terms: null, reason: "unreadable" });
    const junk = await seal(key, OWN, 0, new TextEncoder().encode('{"kind":"w4"}'));
    expect(await fetchTerms(KEY_HEX, AID, { get: async () => junk.envelope })).toMatchObject({ terms: null, reason: "unreadable", message: expect.stringMatching(/terms/) });
  });
});
