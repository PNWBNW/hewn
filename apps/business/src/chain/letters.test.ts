import { describe, expect, it } from "vitest";
import { open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import {
  LETTERS_PROGRAM,
  LETTER_BYTES,
  LETTER_FIELDS,
  LetterBox,
  type LetterWallet,
  PAGE_BYTES,
  PAGE_FIELDS,
  SEND_FUNCTION,
  SEND_PAGE_FUNCTION,
  letterCall,
  lookupHalves,
  lookupOf,
  packParcel,
  parseLetterRecord,
  unpackParcel,
} from "./letters";

const ANA = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const LOOKUP = "0f".repeat(32);
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

/** A record as Shield shows it, in snarkVM's own plaintext format (as `leo run` prints it). */
function record(name: "Letter" | "SentLetter" | "Page", lookup: string, envelope: Uint8Array, extra: Record<string, unknown> = {}) {
  const [hi, lo] = lookupHalves(lookup);
  const fields = packParcel(envelope, name === "Page" ? PAGE_FIELDS : LETTER_FIELDS);
  const list = name === "Page" ? "page" : "parcel";
  const recordPlaintext = `{\n  owner: ${ANA}.private,\n  lookup: [\n    ${hi}u128.private,\n    ${lo}u128.private\n  ],\n  ${list}: [\n${fields.map((f) => `    ${f}field.private`).join(",\n")}\n  ],\n  _nonce: 72037856912846704071group.public,\n  _version: 1u8.public\n}`;
  return { recordName: name, recordPlaintext, spent: false, ...extra };
}

describe("the parcel codec", () => {
  it("round-trips any envelope that fits, padded to the call's fixed size", () => {
    for (const n of [0, 1, 30, 31, 32, 500, LETTER_BYTES]) {
      const fields = packParcel(bytes(n), LETTER_FIELDS);
      expect(fields).toHaveLength(LETTER_FIELDS);
      expect(fields.every((f) => f >= 0n && f < 1n << 248n)).toBe(true);
      expect(unpackParcel(fields)).toEqual(bytes(n));
    }
    expect(unpackParcel(packParcel(bytes(PAGE_BYTES, 9), PAGE_FIELDS))).toEqual(bytes(PAGE_BYTES, 9));
  });

  it("refuses what doesn't fit, and anything packParcel couldn't have made", () => {
    expect(() => packParcel(bytes(LETTER_BYTES + 1), LETTER_FIELDS)).toThrow(/too long/);
    const fields = packParcel(bytes(10), LETTER_FIELDS);
    expect(() => unpackParcel([1n << 248n, ...fields.slice(1)])).toThrow(/out of range/);
    expect(() => unpackParcel([...fields.slice(0, -1), 1n])).toThrow(/padding/);
    expect(() => unpackParcel([0xffffn, ...fields.slice(1)])).toThrow(/longer than it is/);
  });

  it("splits a lookup into the program's two halves and back", () => {
    const [hi, lo] = lookupHalves(LOOKUP);
    expect(lookupOf(hi, lo)).toBe(LOOKUP);
    expect(lookupHalves("00".repeat(31) + "01")).toEqual([0n, 1n]);
    expect(() => lookupHalves("xyz")).toThrow(/64 hex/);
  });
});

describe("the call", () => {
  it("sends a letter when it fits and a page when it doesn't", () => {
    const short = letterCall(ANA, LOOKUP, bytes(100));
    expect([short.program, short.function]).toEqual([LETTERS_PROGRAM, SEND_FUNCTION]);
    expect(short.inputs[0]).toBe(ANA);
    expect(short.inputs[1]).toMatch(/^\[\d+u128, \d+u128\]$/);
    expect(short.inputs[2]!.match(/field/g)).toHaveLength(LETTER_FIELDS);
    const long = letterCall(ANA, LOOKUP, bytes(LETTER_BYTES + 1));
    expect(long.function).toBe(SEND_PAGE_FUNCTION);
    expect(long.inputs[2]!.match(/field/g)).toHaveLength(PAGE_FIELDS);
  });

  it("refuses what the program would refuse, before Shield is asked", () => {
    expect(() => letterCall("aleo1nope", LOOKUP, bytes(1))).toThrow(/account/);
    expect(() => letterCall(ANA, "00".repeat(32), bytes(1))).toThrow(/all zeros/);
    expect(() => letterCall(ANA, LOOKUP, bytes(PAGE_BYTES + 1))).toThrow(/too long to send/);
  });
});

describe("reading Shield's records", () => {
  it("reads a letter, a page and the sender's own copy", () => {
    const env = bytes(200);
    expect(parseLetterRecord(record("Letter", LOOKUP, env, { blockHeight: 12, transactionId: "at1x" }))).toEqual({ kind: "letter", lookup: LOOKUP, envelope: env, blockHeight: 12, transactionId: "at1x" });
    expect(parseLetterRecord(record("Page", LOOKUP, bytes(5000)))?.envelope).toEqual(bytes(5000));
    expect(parseLetterRecord(record("SentLetter", LOOKUP, env))?.kind).toBe("sent");
  });

  it("ignores records that aren't letters this app wrote", () => {
    expect(parseLetterRecord({ recordName: "Credits", recordPlaintext: "{ microcredits: 5u64.private }" })).toBeNull();
    expect(parseLetterRecord({ recordName: "Letter" })).toBeNull();
    expect(parseLetterRecord({ recordName: "Letter", recordPlaintext: "{ lookup: [ 1u128.private ], parcel: [ 1field.private ] }" })).toBeNull();
    expect(parseLetterRecord(null)).toBeNull();
  });
});

describe("the letter box", () => {
  function wallet(records: unknown[]) {
    const sent: { program: string; function: string; inputs: string[] }[] = [];
    let reads = 0;
    const w: LetterWallet = {
      async executeTransaction(opts) {
        sent.push(opts);
        return { transactionId: "shield_1" };
      },
      async transactionStatus() {
        return { status: "accepted", transactionId: "at1" + "x".repeat(58) };
      },
      async requestRecords(program) {
        reads++;
        return program === LETTERS_PROGRAM ? records : [];
      },
    };
    return { w, sent, reads: () => reads };
  }
  const fast = { sleep: async () => {}, pollMs: 1 };

  it("carries a sealed envelope there and back: seal, send, find, open", async () => {
    const key = "ab".repeat(32);
    const sealed = await seal(partiesKeyFromHex(key), "thread_b", 0, new TextEncoder().encode("Welcome aboard"));
    const out = wallet([]);
    await new LetterBox({ wallet: out.w, to: ANA, execute: fast }).put(sealed.lookup, sealed.envelope);
    expect(out.sent).toHaveLength(1);
    expect(out.sent[0]!.function).toBe(SEND_FUNCTION);

    // The recipient's wallet now holds that letter (and the sender's copy shows on the sender's side only).
    const inbox = wallet([record("SentLetter", "aa".repeat(32), bytes(3)), record("Letter", sealed.lookup, sealed.envelope)]);
    const box = new LetterBox({ wallet: inbox.w });
    const got = await box.get(sealed.lookup);
    expect(new TextDecoder().decode(await open(partiesKeyFromHex(key), "thread_b", 0, got!))).toBe("Welcome aboard");
    expect(await box.get("aa".repeat(32))).toBeNull(); // a sent copy is not a letter received
    expect(await box.get("cc".repeat(32))).toBeNull();
    expect(inbox.reads()).toBe(1); // one read of the wallet for all of that
    box.refresh();
    await box.get(sealed.lookup);
    expect(inbox.reads()).toBe(2);
    await expect(box.drop(sealed.lookup)).resolves.toBeUndefined();
  });

  it("won't send from a box that only reads", async () => {
    const { w } = wallet([]);
    await expect(new LetterBox({ wallet: w }).put(LOOKUP, bytes(10))).rejects.toThrow(/only reads/);
  });
});
