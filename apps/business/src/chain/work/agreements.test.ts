import { tlvEncode } from "@pnw/commitments/canonical_encoder";
import { DOMAIN_TAGS, domainHash } from "@pnw/commitments/hash";
import { describe, expect, it } from "vitest";
import { ACCEPT, acceptCall, acceptInputs, acceptTimeHash, parseAgreementRecord, parseAgreementRecords, readAgreementRecords } from "./agreements";
import { AGREEMENT_PROGRAMS, AGREEMENT_V4, AGREEMENT_V5, halfToInput } from "../agreement_programs";

const WORKER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const bytes = (fill: (i: number) => number) => "[ " + Array.from({ length: 32 }, (_, i) => `${fill(i)}u8`).join(", ") + " ]";
const AID = bytes((i) => i + 1);
const KEY = bytes((i) => (i * 7 + 3) % 256);
const TERMS_HASH = bytes((i) => 255 - i);

/** A PendingAgreement as Shield hands it over, with the `.private` suffixes the wallet adds. */
const PENDING_PLAINTEXT = `{
  owner: ${WORKER}.private,
  agreement_id: ${AID}.private,
  parties_key: ${KEY}.private,
  employer_name_hash: 1111field.private,
  worker_name_hash: 2222field.private,
  industry_code: 9u8.private,
  pay_frequency_code: 2u8.private,
  start_epoch: 20261019u32.private,
  end_epoch: 0u32.private,
  review_epoch: 0u32.private,
  agreement_rev: 1u16.private,
  schema_v: 2u16.private,
  policy_v: 1u16.private,
  terms_doc_hash: ${TERMS_HASH}.private,
  terms_root: ${bytes(() => 0)}.private,
  offer_height: 4210000u32.private,
  offer_time_hash: ${bytes(() => 1)}.private,
  employer_address: ${EMPLOYER}.private,
  worker_address: ${WORKER}.private,
  _nonce: 1group.public
}`;

const pending = { recordName: "PendingAgreement", spent: false, recordPlaintext: PENDING_PLAINTEXT };
const final = { recordName: "FinalAgreement", spent: false, recordPlaintext: PENDING_PLAINTEXT.replace("offer_height", "accept_height: 4210100u32.private,\n  offer_height") };

const hex = (fill: (i: number) => number) => Array.from({ length: 32 }, (_, i) => fill(i).toString(16).padStart(2, "0")).join("");

describe("agreement records", () => {
  it("parses a PendingAgreement exactly as the old portal did, plus the key and the terms hash", () => {
    const r = parseAgreementRecord(pending, WORKER);
    expect(r).toEqual({
      kind: "pending",
      program: "employer_agreement_v4.aleo",
      agreementId: hex((i) => i + 1),
      partiesKey: hex((i) => (i * 7 + 3) % 256),
      employerAddress: EMPLOYER,
      workerAddress: WORKER,
      employerNameHash: "1111",
      workerNameHash: "2222",
      termsDocHash: hex((i) => 255 - i),
      plaintext: PENDING_PLAINTEXT,
    });
  });

  it("ignores spent records, other programs' records and other people's agreements", () => {
    expect(parseAgreementRecord({ ...pending, spent: true }, WORKER)).toBeNull();
    expect(parseAgreementRecord({ ...pending, recordName: "Token" }, WORKER)).toBeNull();
    expect(parseAgreementRecord(pending, EMPLOYER)).toBeNull();
    expect(parseAgreementRecord({ recordName: "PendingAgreement", recordPlaintext: "{ owner: x }" }, WORKER)).toBeNull();
    expect(parseAgreementRecord(null, WORKER)).toBeNull();
  });

  it("keeps one record per agreement, the final copy over the pending one", () => {
    const list = parseAgreementRecords([pending, final, pending], WORKER);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("final");
  });

  it("asks the wallet for the agreement program's records, spent ones included", async () => {
    const asked: [string, boolean | undefined][] = [];
    const list = await readAgreementRecords(async (p, all) => (asked.push([p, all]), [pending]), WORKER);
    expect(asked).toEqual(AGREEMENT_PROGRAMS.map((p) => [p, true]));
    expect(list).toHaveLength(1);
  });
});

describe("accept_job_offer inputs", () => {
  it("passes the record plaintext as Shield gave it, then the accept-time hash", () => {
    const inputs = acceptInputs(parseAgreementRecord(pending, WORKER)!, 1_760_457_600);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toBe(PENDING_PLAINTEXT);
    expect(inputs[1]).toBe(acceptTimeHash(1_760_457_600));
    expect(ACCEPT).toEqual({ program: "employer_agreement_v4.aleo", function: "accept_job_offer" });
  });

  it("builds the accept-time hash as the old portal did: BLAKE3(PNW::DOC, TLV 0x6008 of the u32 seconds)", () => {
    const ts = 1_760_457_600;
    const expected = domainHash(DOMAIN_TAGS.DOC, tlvEncode(0x6008, [{ tag: 0x01, value: new Uint8Array([(ts >>> 24) & 255, (ts >>> 16) & 255, (ts >>> 8) & 255, ts & 255]) }]));
    expect(acceptTimeHash(ts)).toBe("[ " + Array.from(expected, (b) => `${b}u8`).join(", ") + " ]");
    expect(acceptTimeHash(ts)).toMatch(/^\[ (\d{1,3}u8, ){31}\d{1,3}u8 \]$/);
    expect(acceptTimeHash(ts)).not.toBe(acceptTimeHash(ts + 1));
    expect(acceptTimeHash(ts)).toBe(
      "[ 153u8, 63u8, 27u8, 18u8, 131u8, 72u8, 58u8, 37u8, 10u8, 211u8, 178u8, 130u8, 13u8, 240u8, 63u8, 127u8, 57u8, 34u8, 242u8, 52u8, 233u8, 124u8, 196u8, 218u8, 74u8, 251u8, 201u8, 237u8, 139u8, 249u8, 122u8, 66u8 ]",
    );
  });

  it("refuses an agreement that is already final, and a bad time", () => {
    expect(() => acceptInputs(parseAgreementRecord(final, WORKER)!, 1)).toThrow(/pending/);
    expect(() => acceptTimeHash(-1)).toThrow();
    expect(() => acceptTimeHash(1.5)).toThrow();
  });
});

describe("employer_agreement_v5 records", () => {
  const employerHalf = "04" + "ab".repeat(64);
  const workerHalf = "04" + "cd".repeat(64);
  const pendingV5 = { recordName: "PendingAgreement", spent: false, recordPlaintext: PENDING_PLAINTEXT.replace("employer_address", `employer_half: ${halfToInput(employerHalf)}.private,\n  employer_address`) };
  const finalV5 = { recordName: "FinalAgreement", spent: false, recordPlaintext: pendingV5.recordPlaintext.replace("employer_half", `worker_half: ${halfToInput(workerHalf)}.private,\n  employer_half`) };

  it("carry the employer's half in the offer and both halves once accepted", () => {
    const p = parseAgreementRecord(pendingV5, WORKER, AGREEMENT_V5)!;
    expect(p).toMatchObject({ kind: "pending", program: AGREEMENT_V5, employerHalf });
    expect(p.workerHalf).toBeUndefined();
    const f = parseAgreementRecord(finalV5, WORKER, AGREEMENT_V5)!;
    expect(f).toMatchObject({ kind: "final", program: AGREEMENT_V5, employerHalf, workerHalf });
    // A v4 record has no halves, and a v5 one read as v4 shows none.
    expect(parseAgreementRecord(pending, WORKER)!.employerHalf).toBeUndefined();
    expect(parseAgreementRecord(pendingV5, WORKER, AGREEMENT_V4)!.employerHalf).toBeUndefined();
  });

  it("accept with the person's public half as the third input, and v4 with two", () => {
    const p = parseAgreementRecord(pendingV5, WORKER, AGREEMENT_V5)!;
    const call = acceptCall(p, 1_760_000_000, workerHalf);
    expect(call).toEqual({ program: AGREEMENT_V5, function: "accept_offer", inputs: [p.plaintext, acceptTimeHash(1_760_000_000), halfToInput(workerHalf)] });
    expect(() => acceptCall(p, 1_760_000_000)).toThrow(/key half/);
    const v4 = acceptCall(parseAgreementRecord(pending, WORKER)!, 1_760_000_000);
    expect(v4).toEqual({ ...ACCEPT, inputs: acceptInputs(parseAgreementRecord(pending, WORKER)!, 1_760_000_000) });
  });

  it("are read from every program the app uses, the newer program's copy winning", async () => {
    const calls: string[] = [];
    const requestRecords = async (program: string) => {
      calls.push(program);
      return program === AGREEMENT_V5 ? [finalV5] : [pending];
    };
    const found = await readAgreementRecords(requestRecords, WORKER, [AGREEMENT_V5, AGREEMENT_V4]);
    expect(calls).toEqual([AGREEMENT_V5, AGREEMENT_V4]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "final", program: AGREEMENT_V5, workerHalf });
  });
});
