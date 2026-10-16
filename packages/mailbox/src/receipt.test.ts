import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { KINDS, MailboxError, lookupId, open, openReceipt, receiptLookup, seal, sealReceipt } from "./envelope";

const KEY = new Uint8Array(32).map((_, i) => i);
const OTHER_KEY = new Uint8Array(32).fill(0xff);
const AT = "2026-10-16T18:04:05.000Z";

async function failsWith(p: Promise<unknown>, code: MailboxError["code"]) {
  await expect(p).rejects.toBeInstanceOf(MailboxError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("receipts", () => {
  it("live at their own address, never a document's slot", () => {
    const r = receiptLookup(KEY, KINDS.paystub, 3);
    expect(r).toMatch(/^[0-9a-f]{64}$/);
    expect(r).not.toBe(lookupId(KEY, KINDS.paystub, 3));
    expect(r).not.toBe(receiptLookup(KEY, KINDS.paystub, 4));
    expect(r).not.toBe(receiptLookup(KEY, KINDS.w4, 3));
    expect(r).not.toBe(receiptLookup(OTHER_KEY, KINDS.paystub, 3));
    // The receipt domain, spelled out.
    const seq = new Uint8Array([0, 0, 0, 3]);
    const input = new Uint8Array([...utf8ToBytes("PNW::MAILBOX::RECEIPT::v1"), 0, ...KEY, ...utf8ToBytes("paystub"), ...seq]);
    expect(r).toBe(bytesToHex(blake3(input)));
  });

  it("open to the time the document was received", async () => {
    const sealed = await sealReceipt(KEY, KINDS.paystub, 3, AT);
    expect(sealed.lookup).toBe(receiptLookup(KEY, KINDS.paystub, 3));
    expect(await openReceipt(KEY, KINDS.paystub, 3, sealed.envelope)).toEqual({ version: 1, receivedAt: AT });
    expect(new TextDecoder("utf-8", { fatal: false }).decode(sealed.envelope)).not.toContain("2026");
  });

  it("won't open for another document, another agreement, or as a document", async () => {
    const sealed = await sealReceipt(KEY, KINDS.paystub, 3, AT);
    await failsWith(openReceipt(KEY, KINDS.paystub, 4, sealed.envelope), "TAMPERED");
    await failsWith(openReceipt(KEY, KINDS.w4, 3, sealed.envelope), "TAMPERED");
    await failsWith(openReceipt(OTHER_KEY, KINDS.paystub, 3, sealed.envelope), "TAMPERED");
    await failsWith(open(KEY, KINDS.paystub, 3, sealed.envelope), "TAMPERED");
    const doc = await seal(KEY, KINDS.paystub, 3, new TextEncoder().encode('{"version":1,"receivedAt":"2026-10-16T18:04:05.000Z"}'));
    await failsWith(openReceipt(KEY, KINDS.paystub, 3, doc.envelope), "TAMPERED");
  });

  it("need a real time, and the receipt key's kind is not a document kind", async () => {
    await failsWith(sealReceipt(KEY, KINDS.paystub, 3, "yesterday"), "BAD_ENVELOPE");
    await failsWith(seal(KEY, "_receipt", 0, new Uint8Array(1)), "BAD_KIND");
    await failsWith(open(KEY, "_receipt", 0, new Uint8Array(40).fill(1)), "BAD_KIND");
  });
});
