// The terms document is a contract shared with the worker's app: its
// canonical form, and the hash the agreement record carries, are pinned.
import { describe, expect, it } from "vitest";
import { computeTermsDocHash } from "@pnw/handshake/engine";
import { TERMS_KEYS, type Terms, canonicalTerms, parseTerms, validateTerms } from "./terms";

const OFFER_TIME_HASH = "3b7f2d4c9e1a6f8d0c5b4a3e2d1f0e9c8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c";

export const TERMS: Terms = {
  version: 1,
  kind: "terms",
  agreementId: OFFER_TIME_HASH,
  termsText: "Carpenter, 40 hours a week. Tools provided. Two weeks' notice either way.",
  payType: "hourly",
  rate: "3000",
  frequency: "biweekly",
  startDate: "2026-11-02",
  businessName: "dayco",
  offeredAt: "2026-10-14T15:04:05.000Z",
};

const CANONICAL =
  '{"version":1,"kind":"terms","agreementId":"3b7f2d4c9e1a6f8d0c5b4a3e2d1f0e9c8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c",' +
  '"termsText":"Carpenter, 40 hours a week. Tools provided. Two weeks\' notice either way.","payType":"hourly","rate":"3000",' +
  '"frequency":"biweekly","startDate":"2026-11-02","businessName":"dayco","offeredAt":"2026-10-14T15:04:05.000Z"}';

/** BLAKE3("PNW::DOC", TLV(0x6002, canonical)) of the document above. Shared with the worker's app; never changes without a version bump. */
const PINNED_HASH = "0x9f83731ce270fc8e7e7538cb1d5ac76ab6569d380f34eeb7cb3f382b33c948ac";

describe("terms document", () => {
  it("has exactly these keys in this order, and its canonical form is JSON.stringify of them", () => {
    expect(TERMS_KEYS).toEqual(["version", "kind", "agreementId", "termsText", "payType", "rate", "frequency", "startDate", "businessName", "offeredAt"]);
    expect(canonicalTerms(TERMS)).toBe(CANONICAL);
    expect(Object.keys(JSON.parse(CANONICAL))).toEqual([...TERMS_KEYS]);
  });

  it("comes out the same whatever order the keys were given in, and without extras", () => {
    const shuffled = { offeredAt: TERMS.offeredAt, businessName: TERMS.businessName, startDate: TERMS.startDate, frequency: TERMS.frequency, rate: TERMS.rate, payType: TERMS.payType, termsText: TERMS.termsText, agreementId: TERMS.agreementId, kind: TERMS.kind, version: TERMS.version, extra: "no" };
    expect(canonicalTerms(shuffled as Terms)).toBe(CANONICAL);
  });

  it("hashes to the pinned value", () => {
    expect(computeTermsDocHash(canonicalTerms(TERMS))).toBe(PINNED_HASH);
    expect(computeTermsDocHash(canonicalTerms({ ...TERMS, termsText: TERMS.termsText + " " }))).not.toBe(PINNED_HASH);
  });

  it("round-trips through its canonical form", () => {
    expect(parseTerms(canonicalTerms(TERMS))).toEqual(TERMS);
  });

  it("refuses a malformed document", () => {
    expect(() => validateTerms({ ...TERMS, version: 2 })).toThrow(/version/);
    expect(() => validateTerms({ ...TERMS, kind: "paystub" })).toThrow(/terms document/);
    expect(() => validateTerms({ ...TERMS, agreementId: "0x" + OFFER_TIME_HASH })).toThrow(/64 hex/);
    expect(() => validateTerms({ ...TERMS, termsText: "  " })).toThrow(/Write the terms/);
    expect(() => validateTerms({ ...TERMS, payType: "daily" })).toThrow(/hourly or salary/);
    expect(() => validateTerms({ ...TERMS, rate: "30.00" })).toThrow(/whole cents/);
    expect(() => validateTerms({ ...TERMS, rate: 3000 })).toThrow(/whole cents/);
    expect(() => validateTerms({ ...TERMS, frequency: "daily" })).toThrow(/how often/);
    expect(() => validateTerms({ ...TERMS, startDate: "11/02/2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => validateTerms({ ...TERMS, startDate: "2026-13-40" })).toThrow(/YYYY-MM-DD/);
    expect(() => validateTerms({ ...TERMS, businessName: "" })).toThrow(/business name/);
    expect(() => validateTerms({ ...TERMS, offeredAt: "yesterday" })).toThrow(/time of the offer/);
    expect(() => parseTerms("null")).toThrow(/object/);
  });
});
