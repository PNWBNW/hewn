import { describe, expect, it } from "vitest";
import { open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { PROGRAMS } from "@pnw/config/programs";
import {
  LETTERS_PROGRAM,
  LETTER_PROGRAMS,
  MANY,
  ManyLetterBox,
  SEND_MANY_FUNCTION,
  manyCalls,
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
import type { LetterRecord } from "./letters";

const ANA = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const BO = "aleo1" + "c".repeat(58);
const ME = "aleo1" + "m".repeat(58);
const LOOKUP = "0f".repeat(32);
const OLD_PROGRAM = PROGRAMS.letters.hewn_letters_v1;
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
  function wallet(records: unknown[], oldRecords: unknown[] = []) {
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
        if (program !== LETTERS_PROGRAM) return program === OLD_PROGRAM ? oldRecords : [];
        reads++;
        return records;
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

  it("still reads letters sent with the program before this one", async () => {
    expect(LETTER_PROGRAMS).toEqual([LETTERS_PROGRAM, OLD_PROGRAM]);
    const { w } = wallet([record("Letter", "aa".repeat(32), bytes(3))], [record("Letter", LOOKUP, bytes(7))]);
    const box = new LetterBox({ wallet: w });
    expect(await box.get(LOOKUP)).toEqual(bytes(7));
    expect(await box.get("aa".repeat(32))).toEqual(bytes(3));
  });

  it("won't send from a box that only reads", async () => {
    const { w } = wallet([]);
    await expect(new LetterBox({ wallet: w }).put(LOOKUP, bytes(10))).rejects.toThrow(/only reads/);
  });
});

describe("reading a thread's letters", () => {
  it("finds a slot's letter from the one sender it believes, nothing else, and drops nothing", async () => {
    const { letterReader, SenderUnknown } = await import("./letters");
    const THEM = `aleo1${"q".repeat(58)}`;
    const OTHER = `aleo1${"p".repeat(58)}`;
    const slots: Record<string, LetterRecord[]> = {
      a: [{ kind: "letter", lookup: "a", envelope: Uint8Array.of(9), sender: OTHER }, { kind: "letter", lookup: "a", envelope: Uint8Array.of(1), sender: THEM }],
      forged: [{ kind: "letter", lookup: "forged", envelope: Uint8Array.of(2), sender: OTHER }],
      silent: [{ kind: "letter", lookup: "silent", envelope: Uint8Array.of(3) }],
    };
    const reader = letterReader({ getAll: async (l: string) => slots[l] ?? [] }, THEM);
    expect(await reader.get("a")).toEqual(Uint8Array.of(1)); // theirs, not the other one sealed into the same slot
    expect(await reader.get("forged")).toBeNull(); // someone else holding the key: not believed
    expect(await reader.get("b")).toBeNull();
    await expect(reader.get("silent")).rejects.toBeInstanceOf(SenderUnknown); // no sender at all: say so, don't guess
    await expect(reader.drop("a")).resolves.toBeUndefined();
  });
});

describe("announcements: one letter to many", () => {
  it("sends eight to a call, filling the last call's places with the sender", () => {
    const to = Array.from({ length: 10 }, (_, i) => (i % 2 ? ANA : BO));
    const calls = manyCalls(to, ME, LOOKUP, bytes(300));
    expect(calls.map((c) => c.function)).toEqual([SEND_MANY_FUNCTION, SEND_MANY_FUNCTION]);
    const accounts = (c: { inputs: string[] }) => c.inputs[0]!.slice(1, -1).split(", ");
    expect(accounts(calls[0]!)).toEqual(to.slice(0, MANY));
    expect(accounts(calls[1]!)).toEqual([...to.slice(MANY), ...Array(6).fill(ME)]);
    // Every copy is the same parcel under the same lookup.
    expect(calls[0]!.inputs.slice(1)).toEqual(calls[1]!.inputs.slice(1));
    expect(calls[0]!.inputs[2]!.match(/field/g)).toHaveLength(LETTER_FIELDS);
  });

  it("refuses what the program would refuse, or what doesn't fit one letter", () => {
    expect(() => manyCalls([], ME, LOOKUP, bytes(1))).toThrow(/someone/);
    expect(() => manyCalls(["aleo1nope"], ME, LOOKUP, bytes(1))).toThrow(/accounts/);
    expect(() => manyCalls([ANA], ME, "00".repeat(32), bytes(1))).toThrow(/all zeros/);
    expect(() => manyCalls([ANA], ME, LOOKUP, bytes(LETTER_BYTES + 1))).toThrow(/too long/);
  });

  it("sends each call through Shield, and steps aside from a slot already used", async () => {
    const sent: string[] = [];
    const sentCopy = (lookup: string) => {
      const [hi, lo] = lookupHalves(lookup);
      const fields = packParcel(bytes(1), LETTER_FIELDS);
      return { recordName: "SentLetter", recordPlaintext: `{ owner: ${ME}.private, lookup: [ ${hi}u128.private, ${lo}u128.private ], parcel: [ ${fields.map((f) => `${f}field.private`).join(", ")} ] }`, spent: false };
    };
    const used = "dd".repeat(32);
    const w: LetterWallet = {
      async executeTransaction(o) {
        sent.push(o.function);
        return { transactionId: "shield_1" };
      },
      async transactionStatus() {
        return { status: "accepted", transactionId: "at1" + "x".repeat(58) };
      },
      async requestRecords(program) {
        return program === LETTERS_PROGRAM ? [sentCopy(used)] : [];
      },
    };
    const box = new ManyLetterBox({ wallet: w, to: Array(9).fill(ANA), self: ME, execute: { sleep: async () => {}, pollMs: 1 } });
    await box.put(LOOKUP, bytes(200));
    expect(sent).toEqual([SEND_MANY_FUNCTION, SEND_MANY_FUNCTION]);
    await expect(box.put(used, bytes(200))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sent).toHaveLength(2);
  });
});
