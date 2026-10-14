import { KINDS, MailboxError, lookupId, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { type PaystubDocument, canonicalPaystub, paystubDocument, paystubHash } from "@pnw/payroll";
import { describe, expect, it } from "vitest";
import { type ReceivedPaystub, type Work, addPaystub, bumpWorkSeq, emptyWork, upsertAgreement } from "../../books/work";
import { type PaystubEnvelope, parsePaystubEnvelope, scanPaystubs } from "./inbox";

const AID = "01".repeat(32);
const KEY_HEX = "ab".repeat(32);
const key = partiesKeyFromHex(KEY_HEX);
const EMPLOYER = "aleo1" + "k".repeat(58);

const base = (): Work =>
  upsertAgreement(emptyWork("Ana"), { agreementId: AID, partiesKey: KEY_HEX, employerAddress: EMPLOYER, employerNameHash: "1", status: "active" });

/** A paystub exactly as the employer's books build it. */
const doc: PaystubDocument = paystubDocument(
  { id: "run-1", payDate: "2026-10-16", periodStart: "2026-10-12", periodEnd: "2026-10-18", paychecks: [{ workerId: "wkr-1" }] },
  { workerId: "wkr-1", hours: 40, gross: 120000n, federalIncomeTax: 6015n, socialSecurity: 7440n, medicare: 1740n, additionalMedicare: 0n, employerSocialSecurity: 7440n, employerMedicare: 1740n, net: 104805n },
  { id: "wkr-1", name: "Ana Ruiz", payType: "hourly", rate: 3000n },
  { businessName: "Day Construction" },
  { gross: 0n, withheld: 0n },
);
const canonical = JSON.parse(canonicalPaystub(doc)) as PaystubEnvelope["document"];
const TX = "at1" + "y".repeat(58);
const envelope = (over: Partial<PaystubEnvelope> = {}): PaystubEnvelope => ({ version: 1, kind: "paystub", document: canonical, settlement: { transactionId: TX, height: 4210777, feeMicrocredits: "51580" }, businessName: "Day Construction", ...over });
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** A mailbox holding sealed envelopes by lookup, counting gets and drops. */
function fakeMailbox(slots: Record<string, Uint8Array<ArrayBuffer>>, options: { getError?: MailboxError } = {}) {
  const gets: string[] = [];
  const drops: string[] = [];
  return {
    gets,
    drops,
    client: {
      async get(lookup: string): Promise<Uint8Array<ArrayBuffer> | null> {
        if (options.getError) throw options.getError;
        gets.push(lookup);
        return slots[lookup] ?? null;
      },
      async drop(lookup: string) {
        drops.push(lookup);
      },
    },
  };
}

/** Records every vault write the scan asks for, applying it to a running copy of the work. */
function vault(initial: Work) {
  let work = initial;
  const stored: ReceivedPaystub[] = [];
  const skipped: [string, number][] = [];
  const order: string[] = [];
  return {
    get work() {
      return work;
    },
    stored,
    skipped,
    order,
    store: async (p: ReceivedPaystub) => {
      order.push(`store:${p.seq}`);
      stored.push(p);
      work = addPaystub(work, p);
    },
    skip: async (agreementId: string, seq: number) => {
      order.push(`skip:${seq}`);
      skipped.push([agreementId, seq]);
      work = bumpWorkSeq(work, agreementId, "paystub", seq);
    },
  };
}

describe("parsePaystubEnvelope", () => {
  it("reads what deliver.ts writes", () => {
    expect(parsePaystubEnvelope(bytes(envelope()))).toEqual(envelope());
    expect(parsePaystubEnvelope(bytes(envelope({ settlement: { transactionId: TX } })))).toEqual(envelope({ settlement: { transactionId: TX } }));
  });

  it("refuses anything else", () => {
    expect(() => parsePaystubEnvelope(new TextEncoder().encode("{"))).toThrow(/couldn't be read/);
    expect(() => parsePaystubEnvelope(bytes(envelope({ kind: "w4" as never })))).toThrow(/isn't a paystub/);
    expect(() => parsePaystubEnvelope(bytes(envelope({ version: 2 as never })))).toThrow(/version/);
    expect(() => parsePaystubEnvelope(bytes({ ...envelope(), settlement: {} }))).toThrow(/payment id/);
    expect(() => parsePaystubEnvelope(bytes({ ...envelope(), settlement: { transactionId: TX, feeMicrocredits: 51580 } }))).toThrow(/fee/);
    expect(() => parsePaystubEnvelope(bytes({ ...envelope(), document: null }))).toThrow(/no document/);
  });
});

describe("scanPaystubs", () => {
  it("reads slots from the next unseen one until a miss, keeps each in the vault, then drops the pin", async () => {
    const s0 = await seal(key, KINDS.paystub, 0, bytes(envelope()));
    const s1 = await seal(key, KINDS.paystub, 1, bytes(envelope({ settlement: { transactionId: "at1" + "z".repeat(58) } })));
    const box = fakeMailbox({ [s0.lookup]: s0.envelope, [s1.lookup]: s1.envelope });
    const v = vault(base());
    const result = await scanPaystubs({ work: v.work, client: box.client, store: v.store, skip: v.skip, now: () => "2026-10-16T20:00:00.000Z" });
    expect(result.off).toBe(false);
    expect(result.skipped).toEqual([]);
    expect(result.received.map((p) => p.seq)).toEqual([0, 1]);
    expect(result.received[0]).toEqual({
      agreementId: AID,
      seq: 0,
      lookup: s0.lookup,
      receivedAt: "2026-10-16T20:00:00.000Z",
      document: canonical,
      settlement: { transactionId: TX, height: 4210777, feeMicrocredits: "51580" },
      businessName: "Day Construction",
      paystubHash: paystubHash(doc),
    });
    expect(box.gets).toEqual([s0.lookup, s1.lookup, lookupId(key, KINDS.paystub, 2)]);
    expect(box.drops).toEqual([s0.lookup, s1.lookup]);
    expect(v.order).toEqual(["store:0", "store:1"]);
    expect(v.work.paystubs).toHaveLength(2);
    expect(v.work.mailboxSeq[AID]?.paystub).toBe(2);
  });

  it("starts from the slot the vault remembers and never re-reads earlier ones", async () => {
    const s2 = await seal(key, KINDS.paystub, 2, bytes(envelope()));
    const box = fakeMailbox({ [s2.lookup]: s2.envelope });
    const v = vault(bumpWorkSeq(base(), AID, "paystub", 1));
    const result = await scanPaystubs({ work: v.work, client: box.client, store: v.store, skip: v.skip });
    expect(result.received.map((p) => p.seq)).toEqual([2]);
    expect(box.gets[0]).toBe(s2.lookup);
  });

  it("skips one bad envelope with a visible error and goes on to the next slot", async () => {
    const bad = await seal(partiesKeyFromHex("cd".repeat(32)), KINDS.paystub, 0, bytes(envelope())); // someone else's key
    const junk = await seal(key, KINDS.paystub, 1, bytes({ version: 1, kind: "paystub", document: { version: 1 }, settlement: { transactionId: TX }, businessName: "x" })); // a document that isn't a paystub
    const good = await seal(key, KINDS.paystub, 2, bytes(envelope()));
    const box = fakeMailbox({ [lookupId(key, KINDS.paystub, 0)]: bad.envelope, [junk.lookup]: junk.envelope, [good.lookup]: good.envelope });
    const v = vault(base());
    const result = await scanPaystubs({ work: v.work, client: box.client, store: v.store, skip: v.skip });
    expect(result.skipped.map((s) => s.seq)).toEqual([0, 1]);
    expect(result.skipped[0]!.message).toMatch(/isn't for this agreement|changed in transit/);
    expect(result.skipped[1]!.message).toMatch(/pay type/);
    expect(result.received.map((p) => p.seq)).toEqual([2]);
    expect(box.drops).toEqual([good.lookup]); // a skipped pin is left alone
    expect(v.order).toEqual(["skip:0", "skip:1", "store:2"]);
    expect(v.work.mailboxSeq[AID]?.paystub).toBe(3);
  });

  it("stops everything on a host with no mailbox, and on another read failure", async () => {
    const off = fakeMailbox({}, { getError: new MailboxError("NOT_CONFIGURED", "off") });
    const v = vault(base());
    expect(await scanPaystubs({ work: v.work, client: off.client, store: v.store, skip: v.skip })).toEqual({ received: [], skipped: [], off: true });
    const broken = fakeMailbox({}, { getError: new MailboxError("REQUEST_FAILED", "The mailbox read failed (502)") });
    expect(await scanPaystubs({ work: v.work, client: broken.client, store: v.store, skip: v.skip })).toMatchObject({ off: false, failed: /502/ });
    expect(v.stored).toEqual([]);
  });

  it("scans every accepted agreement and leaves pending ones alone", async () => {
    const other = { agreementId: "02".repeat(32), partiesKey: "ef".repeat(32), employerAddress: EMPLOYER, employerNameHash: "2", status: "paused" as const };
    const pending = { ...other, agreementId: "03".repeat(32), partiesKey: "0f".repeat(32), status: "pending" as const };
    const w = upsertAgreement(upsertAgreement(base(), other), pending);
    const s = await seal(partiesKeyFromHex(other.partiesKey), KINDS.paystub, 0, bytes(envelope()));
    const box = fakeMailbox({ [s.lookup]: s.envelope });
    const v = vault(w);
    const result = await scanPaystubs({ work: v.work, client: box.client, store: v.store, skip: v.skip });
    expect(result.received.map((p) => p.agreementId)).toEqual([other.agreementId]);
    expect(box.gets).toHaveLength(3); // one miss for the active agreement, a hit and a miss for the paused one
    expect(box.gets).not.toContain(lookupId(partiesKeyFromHex(pending.partiesKey), KINDS.paystub, 0));
  });
});
