import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  ENVELOPE_OVERHEAD,
  ENVELOPE_VERSION,
  KINDS,
  LOOKUP_PATTERN,
  MAX_ENVELOPE_BYTES,
  MAX_PAYLOAD_BYTES,
  MailboxError,
  deriveMailboxKey,
  lookupId,
  open,
  partiesKeyFromHex,
  seal,
} from "./envelope";

const KEY = new Uint8Array(32).map((_, i) => i);
const OTHER_KEY = new Uint8Array(32).fill(0xff);
const text = (s: string) => new TextEncoder().encode(s);
const read = (b: Uint8Array) => new TextDecoder().decode(b);

async function failsWith(p: Promise<unknown>, code: MailboxError["code"]) {
  await expect(p).rejects.toBeInstanceOf(MailboxError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("lookup ids", () => {
  it("are 64 hex characters, deterministic, and differ by kind and seq", () => {
    const a = lookupId(KEY, KINDS.terms, 0);
    expect(a).toMatch(LOOKUP_PATTERN);
    expect(lookupId(KEY, KINDS.terms, 0)).toBe(a);
    expect(lookupId(KEY, KINDS.w4, 0)).not.toBe(a);
    expect(lookupId(KEY, KINDS.terms, 1)).not.toBe(a);
    expect(lookupId(OTHER_KEY, KINDS.terms, 0)).not.toBe(a);
  });

  it("two parties derive the same id from their own copies of the parties key", () => {
    const employer = partiesKeyFromHex("0x" + bytesToHex(KEY));
    const worker = partiesKeyFromHex(bytesToHex(KEY).toUpperCase());
    expect(lookupId(employer, KINDS.paystub, 7)).toBe(lookupId(worker, KINDS.paystub, 7));
  });

  it("match the spelled-out construction", () => {
    const seq = new Uint8Array([0, 0, 0, 7]);
    const input = new Uint8Array([
      ...utf8ToBytes("PNW::MAILBOX::LOOKUP::v1"), 0x00, ...KEY, ...utf8ToBytes("paystub"), ...seq,
    ]);
    expect(lookupId(KEY, KINDS.paystub, 7)).toBe(bytesToHex(blake3(input)));
  });

  // If any of these change, every mailbox in the field goes dark. They may
  // only change together with a new domain string (v2) and a migration.
  it("pinned vectors", () => {
    expect(lookupId(KEY, KINDS.terms, 0)).toBe("8a45f32884aa20563afb9535932161b51369dfddce1d952bc1e8f5341b14416e");
    expect(lookupId(KEY, KINDS.paystub, 7)).toBe("304918ffd1acbdabc9838208d029ed0ba67004bf7eefcd1ad2a6ffa321725a8b");
    expect(lookupId(KEY, KINDS.w4, 1)).toBe("f2cbfa3e9f36e1db8de1bb6bc6dba7b84f0a0d16debb4f15ffcf5f31087774a7");
    expect(lookupId(KEY, KINDS.payment_note, 0xffff_ffff)).toBe("23ce8744c6925ebab74cc2e7cc7b71b5dcb601fb0d9183babc183a25fce9407c");
    expect(lookupId(OTHER_KEY, KINDS.terms, 0)).toBe("bf5ad8b8014ef7fa3119b37e3c3408acc7c761247959fb4e4d7dd5426f7efd8d");
  });

  it("refuse a bad key, kind or seq", () => {
    expect(() => lookupId(KEY.subarray(0, 31), KINDS.terms, 0)).toThrow(MailboxError);
    expect(() => lookupId(KEY, "Terms", 0)).toThrowError(expect.objectContaining({ code: "BAD_KIND" }));
    expect(() => lookupId(KEY, "", 0)).toThrowError(expect.objectContaining({ code: "BAD_KIND" }));
    expect(() => lookupId(KEY, KINDS.terms, -1)).toThrowError(expect.objectContaining({ code: "BAD_SEQ" }));
    expect(() => lookupId(KEY, KINDS.terms, 1.5)).toThrowError(expect.objectContaining({ code: "BAD_SEQ" }));
    expect(() => lookupId(KEY, KINDS.terms, 2 ** 32)).toThrowError(expect.objectContaining({ code: "BAD_SEQ" }));
    expect(() => partiesKeyFromHex("abc")).toThrowError(expect.objectContaining({ code: "BAD_KEY" }));
  });

  it("do not keep the caller's key bytes", () => {
    const mine = new Uint8Array(KEY);
    lookupId(mine, KINDS.terms, 0);
    expect(mine).toEqual(KEY);
  });
});

describe("keys", () => {
  it("are AES-256-GCM, non-extractable, and the same for both parties", async () => {
    const a = await deriveMailboxKey(KEY, KINDS.terms);
    expect(a.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(a.extractable).toBe(false);
    expect(a.usages.sort()).toEqual(["decrypt", "encrypt"]);
    // Same key material: what one encrypts, the other opens.
    const b = await deriveMailboxKey(new Uint8Array(KEY), KINDS.terms);
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, a, text("x"));
    expect(read(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, b, ct)))).toBe("x");
  });

  it("differ per kind", async () => {
    const terms = await deriveMailboxKey(KEY, KINDS.terms);
    const w4 = await deriveMailboxKey(KEY, KINDS.w4);
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, terms, text("x"));
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv }, w4, ct)).rejects.toThrow();
  });
});

describe("seal and open", () => {
  it.each(Object.values(KINDS))("round-trips a %s document", async (kind) => {
    const payload = text(`{"kind":"${kind}","amount":"123456"}`);
    const { lookup, envelope } = await seal(KEY, kind, 2, payload);
    expect(lookup).toBe(lookupId(KEY, kind, 2));
    expect(envelope[0]).toBe(ENVELOPE_VERSION);
    expect(envelope.length).toBe(payload.length + ENVELOPE_OVERHEAD);
    expect(await open(KEY, kind, 2, envelope)).toEqual(payload);
  });

  it("uses a fresh IV every time", async () => {
    const a = await seal(KEY, KINDS.terms, 0, text("same"));
    const b = await seal(KEY, KINDS.terms, 0, text("same"));
    expect(a.lookup).toBe(b.lookup);
    expect(bytesToHex(a.envelope)).not.toBe(bytesToHex(b.envelope));
  });

  it("opens a pinned envelope from an earlier build", async () => {
    const envelope = hexToBytes(
      "01c24b8a7106b87039bc18ff85d12cec1300267d60dc292a0c8b416000369b1e1ce4fcb7671e4c13fe86",
    );
    expect(read(await open(KEY, KINDS.w4, 3, envelope))).toBe("hello mailbox");
  });

  it("handles an empty payload and the largest one", async () => {
    const empty = await seal(KEY, KINDS.terms, 0, new Uint8Array(0));
    expect((await open(KEY, KINDS.terms, 0, empty.envelope)).length).toBe(0);
    const big = new Uint8Array(MAX_PAYLOAD_BYTES).map((_, i) => (i * 7) & 0xff);
    const sealed = await seal(KEY, KINDS.paystub, 1, big);
    expect(sealed.envelope.length).toBeLessThanOrEqual(MAX_ENVELOPE_BYTES);
    expect(await open(KEY, KINDS.paystub, 1, sealed.envelope)).toEqual(big);
  });

  it("refuses a payload over the limit, on seal and on open", async () => {
    await failsWith(seal(KEY, KINDS.terms, 0, new Uint8Array(MAX_PAYLOAD_BYTES + 1)), "TOO_LARGE");
    const tooBig = new Uint8Array(MAX_PAYLOAD_BYTES + ENVELOPE_OVERHEAD + 1);
    tooBig[0] = ENVELOPE_VERSION;
    await failsWith(open(KEY, KINDS.terms, 0, tooBig), "BAD_ENVELOPE");
  });

  it("fails with the wrong key, kind or seq", async () => {
    const { envelope } = await seal(KEY, KINDS.terms, 5, text("offer"));
    await failsWith(open(OTHER_KEY, KINDS.terms, 5, envelope), "TAMPERED");
    await failsWith(open(KEY, KINDS.w4, 5, envelope), "TAMPERED");
    await failsWith(open(KEY, KINDS.terms, 6, envelope), "TAMPERED");
  });

  it("fails on any flipped byte", async () => {
    const { envelope } = await seal(KEY, KINDS.paystub, 0, text("net 1048.05"));
    for (const at of [1, 12, 13, envelope.length - 17, envelope.length - 1]) {
      const bent = new Uint8Array(envelope);
      bent[at]! ^= 0x01;
      await failsWith(open(KEY, KINDS.paystub, 0, bent), "TAMPERED");
    }
  });

  it("fails on a truncated, extended or wrong-version envelope", async () => {
    const { envelope } = await seal(KEY, KINDS.terms, 0, text("x"));
    await failsWith(open(KEY, KINDS.terms, 0, envelope.subarray(0, ENVELOPE_OVERHEAD - 1)), "BAD_ENVELOPE");
    await failsWith(open(KEY, KINDS.terms, 0, new Uint8Array(0)), "BAD_ENVELOPE");
    await failsWith(open(KEY, KINDS.terms, 0, new Uint8Array([...envelope, 0])), "TAMPERED");
    const v2 = new Uint8Array(envelope);
    v2[0] = 0x02;
    await failsWith(open(KEY, KINDS.terms, 0, v2), "BAD_VERSION");
    const v0 = new Uint8Array(envelope);
    v0[0] = 0x00;
    await failsWith(open(KEY, KINDS.terms, 0, v0), "BAD_VERSION");
  });

  it("is bound to the lookup: the same bytes under another slot do not open", async () => {
    // Copying an envelope to the next slot (a replay) must fail even though the key matches.
    const { envelope } = await seal(KEY, KINDS.payment_note, 1, text("inv-42 paid"));
    await failsWith(open(KEY, KINDS.payment_note, 2, envelope), "TAMPERED");
  });
});
