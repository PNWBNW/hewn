// Agreement records through the generated bindings (agreement_records.ts, docs/VEIL.md step 2),
// side by side with the hand readers they replaced (test/legacy/agreements_hand_parser.ts): the
// same records, the same answers. Where the two differ, the difference is written down, with why.
import { describe, expect, it } from "vitest";
import { packedWords } from "@pnw/records/packed";
import { handFinalAgreements, handParseAgreementRecord, handPartiesKeysOf, handSentOfferPlaintext } from "../../test/legacy/agreements_hand_parser";
import { AGREEMENT_V4, AGREEMENT_V5, halfToInput } from "./agreement_programs";
import { bytesHex, decodeAgreementRecord, wordsHex } from "./agreement_records";
import { bytesToAleoU8Array, finalAgreements, sentOfferPlaintext } from "./offer";
import { partiesKeysOf } from "./parties_key";
import { parseAgreementRecord } from "./work/agreements";

const WORKER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const EMPLOYER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const hex = (seed: number) => Array.from({ length: 32 }, (_, i) => ((i * 13 + seed) & 0xff).toString(16).padStart(2, "0")).join("");
const EMPLOYER_HALF = "04" + "ab".repeat(64);
const WORKER_HALF = "04" + "cd".repeat(64);

type Shape = { version: 4 | 5; name: "PendingAgreement" | "SentOffer" | "FinalAgreement"; seed?: number; owner?: string; worker?: string; nonce?: boolean };

/** An agreement record as the program writes it and Shield lists it. */
function record({ version, name, seed = 1, owner = WORKER, worker = WORKER, nonce = true }: Shape) {
  const bytes = (h: string) => (version === 5 ? packedWords(h, 2) : bytesToAleoU8Array(h));
  const lines = [`owner: ${owner}.private`, `agreement_id: ${bytes(hex(seed))}.private`, `parties_key: ${bytes(hex(seed + 1))}.private`, "employer_name_hash: 1111field.private", "worker_name_hash: 2222field.private"];
  if (name !== "SentOffer") lines.push("industry_code: 9u8.private", "pay_frequency_code: 2u8.private", "start_epoch: 10u32.private", "end_epoch: 0u32.private", "review_epoch: 10u32.private", "agreement_rev: 1u16.private", "schema_v: 2u16.private", "policy_v: 1u16.private");
  lines.push(`terms_doc_hash: ${bytes(hex(seed + 2))}.private`);
  if (name !== "SentOffer") lines.push(`terms_root: ${bytes(hex(seed + 3))}.private`);
  if (version === 4) lines.push("offer_height: 4210000u32.private");
  lines.push(`offer_time_hash: ${bytes(hex(seed + 4))}.private`);
  if (name === "FinalAgreement" && version === 5) lines.push(`accept_time_hash: ${bytes(hex(seed + 5))}.private`);
  lines.push(`employer_address: ${EMPLOYER}.private`, `worker_address: ${worker}.private`);
  if (version === 5) lines.push(`employer_half: ${halfToInput(EMPLOYER_HALF)}.private`);
  if (version === 5 && name === "FinalAgreement") lines.push(`worker_half: ${halfToInput(WORKER_HALF)}.private`, "end_reason: 0u8.private");
  if (nonce) lines.push("_nonce: 72037856912846704071group.public", "_version: 1u8.public");
  return { recordName: name, spent: false, recordPlaintext: `{\n  ${lines.join(",\n  ")}\n}` };
}

const all = [
  record({ version: 5, name: "PendingAgreement" }),
  record({ version: 5, name: "FinalAgreement", seed: 7 }),
  record({ version: 5, name: "SentOffer", seed: 9, owner: EMPLOYER }),
  record({ version: 4, name: "PendingAgreement", seed: 11 }),
  record({ version: 4, name: "FinalAgreement", seed: 13 }),
];

describe("agreement records through generated bindings, beside the hand readers", () => {
  it("the worker's reader reads every v4 and v5 record the same, for both programs", () => {
    for (const r of all) {
      for (const program of [AGREEMENT_V4, AGREEMENT_V5]) {
        expect(parseAgreementRecord(r, WORKER, program)).toEqual(handParseAgreementRecord(r, WORKER, program));
      }
    }
    expect(parseAgreementRecord(all[1], WORKER, AGREEMENT_V5)).toMatchObject({ kind: "final", agreementId: hex(7), employerHalf: EMPLOYER_HALF, workerHalf: WORKER_HALF });
    expect(parseAgreementRecord(all[3], WORKER, AGREEMENT_V4)).toMatchObject({ kind: "pending", agreementId: hex(11), partiesKey: hex(12), termsDocHash: hex(13), employerNameHash: "1111" });
  });

  it("the employer's readers find the same agreements, halves, offers and parties keys", () => {
    expect(finalAgreements(all)).toEqual(handFinalAgreements(all));
    expect(finalAgreements(all).get(hex(7))).toEqual({ workerHalf: WORKER_HALF });
    expect(finalAgreements(all).get(hex(13))).toEqual({});
    expect(partiesKeysOf(all)).toEqual(handPartiesKeysOf(all));
    expect(partiesKeysOf(all).size).toBe(5);
    for (const id of [hex(9), hex(1), "44".repeat(32)]) expect(sentOfferPlaintext(all, id)).toBe(handSentOfferPlaintext(all, id));
    expect(sentOfferPlaintext(all, hex(9))).toBe(all[2]!.recordPlaintext);
  });

  it("both refuse the same: spent records, other names, someone else's offer, nothing readable", () => {
    const spent = { ...all[1]!, spent: true };
    const other = { ...all[1]!, recordName: "AgreementEnd" };
    const theirs = record({ version: 5, name: "PendingAgreement", worker: EMPLOYER });
    for (const r of [spent, other, theirs, null, "x", { recordName: "FinalAgreement" }]) {
      expect(parseAgreementRecord(r, WORKER, AGREEMENT_V5)).toBe(null);
      expect(handParseAgreementRecord(r, WORKER, AGREEMENT_V5)).toBe(null);
    }
    expect(finalAgreements([spent, other])).toEqual(handFinalAgreements([spent, other]));
    expect(finalAgreements([spent, other]).size).toBe(0);
  });

  it("differ only where the generated path is stricter", () => {
    // 1. Text without a `_nonce` isn't a record (a record without it can't be spent, and every
    //    one Shield lists has it): the hand readers read the fields anyway.
    const noNonce = record({ version: 5, name: "FinalAgreement", nonce: false });
    expect(parseAgreementRecord(noNonce, WORKER, AGREEMENT_V5)).toBeNull();
    expect(handParseAgreementRecord(noNonce, WORKER, AGREEMENT_V5)).not.toBeNull();

    // 2. A record mixing the two programs' shapes (v4's byte-array id with v5's halves), which
    //    neither program can write. The hand readers took each field in whatever shape it came;
    //    the generated path reads a record as the one program its id belongs to.
    const hybrid = record({ version: 4, name: "FinalAgreement" });
    hybrid.recordPlaintext = hybrid.recordPlaintext.replace("_nonce", `worker_half: ${halfToInput(WORKER_HALF)}.private,\n  _nonce`);
    expect(finalAgreements([hybrid]).get(hex(1))).toEqual({});
    expect(handFinalAgreements([hybrid]).get(hex(1))).toEqual({ workerHalf: WORKER_HALF });
  });

  it("checks what the decoders leave unchecked: byte and word ranges, lengths", () => {
    expect(wordsHex([1n, 2n], 32)).toBe("0".repeat(31) + "1" + "0".repeat(31) + "2");
    expect(wordsHex([1n << 128n, 0n])).toBeNull();
    expect(wordsHex([1n], 32)).toBeNull();
    expect(wordsHex([])).toBeNull();
    expect(bytesHex([0, 255])).toBe("00ff");
    expect(bytesHex([256])).toBeNull();
    expect(bytesHex([1, 2], 32)).toBeNull();
    expect(decodeAgreementRecord({ recordName: "SentOffer", recordPlaintext: record({ version: 4, name: "PendingAgreement" }).recordPlaintext })).toBeNull();
  });
});
