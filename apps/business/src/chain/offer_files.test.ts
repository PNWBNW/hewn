// An offer's files through the mailbox: cut into pieces, sealed, put back
// together and checked against the fingerprints in the terms.
import { describe, expect, it } from "vitest";
import { MailboxError, lookupId, partiesKeyFromHex } from "@pnw/mailbox";
import { OFFER_CHUNK_BYTES } from "../books/offer_letter";
import { fetchOfferFile, offerFileKind, offerFileLookups, pickFile, sendOfferFiles } from "./offer_files";

const KEY = "ab".repeat(32);
const OFFER = "cd".repeat(32);

function memoryClient() {
  const slots = new Map<string, Uint8Array>();
  return {
    slots,
    async put(lookup: string, envelope: Uint8Array) {
      if (slots.has(lookup)) throw new MailboxError("CONFLICT", "taken");
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      const v = slots.get(lookup);
      return v ? new Uint8Array(v) : null;
    },
  };
}

const bytes = (n: number, seed: number) => new Uint8Array(n).map((_, i) => (i * 31 + seed) & 0xff);

describe("offer files in the mailbox", () => {
  it("go up in numbered pieces and come back byte for byte", async () => {
    const client = memoryClient();
    const big = await pickFile("contract.pdf", "application/pdf", bytes(OFFER_CHUNK_BYTES * 2 + 7, 1));
    const small = await pickFile("site.jpg", "image/jpeg", bytes(1234, 2));
    const progress: string[] = [];
    await sendOfferFiles(client, KEY, OFFER, [big, small], (d, t) => progress.push(`${d}/${t}`));
    expect(big.file.chunks).toBe(3);
    expect(client.slots.size).toBe(4);
    expect(progress).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    const files = [big.file, small.file];
    expect((await fetchOfferFile(client, KEY, OFFER, files, 0)).bytes).toEqual(big.bytes);
    expect((await fetchOfferFile(client, KEY, OFFER, files, 1)).bytes).toEqual(small.bytes);
    expect(new Set(offerFileLookups(KEY, OFFER, files))).toEqual(new Set(client.slots.keys()));
  });

  it("refuse a file with a piece missing, a piece swapped, or a fingerprint that doesn't match", async () => {
    const client = memoryClient();
    const a = await pickFile("a.pdf", "application/pdf", bytes(OFFER_CHUNK_BYTES + 10, 3));
    const b = await pickFile("b.pdf", "application/pdf", bytes(OFFER_CHUNK_BYTES + 10, 4));
    await sendOfferFiles(client, KEY, OFFER, [a, b]);
    const files = [a.file, b.file];
    const [a0, a1, b0] = offerFileLookups(KEY, OFFER, files) as [string, string, string, string];

    const swapped = memoryClient();
    for (const [k, v] of client.slots) swapped.slots.set(k, v);
    swapped.slots.set(a0, client.slots.get(b0)!); // b's first piece where a's should be: opens under the wrong slot
    await expect(fetchOfferFile(swapped, KEY, OFFER, files, 0)).rejects.toThrow(/couldn't be opened/);

    const gap = memoryClient();
    for (const [k, v] of client.slots) if (k !== a1) gap.slots.set(k, v);
    await expect(fetchOfferFile(gap, KEY, OFFER, files, 0)).rejects.toThrow(/hasn't fully arrived/);

    const lying = [{ ...a.file, sha256: "0".repeat(64) }, b.file];
    await expect(fetchOfferFile(client, KEY, OFFER, lying, 0)).rejects.toThrow(/doesn't match the offer/);
    // Someone else's parties key: their lookups lead nowhere, so nothing of this offer is found.
    await expect(fetchOfferFile(client, "ef".repeat(32), OFFER, files, 0)).rejects.toThrow(/hasn't fully arrived/);
  });

  it("live under a kind of their own per offer, so a second offer never lands on the first one's slots", async () => {
    expect(offerFileKind(OFFER)).toBe(`offer_${OFFER.slice(0, 24)}`);
    expect(offerFileKind("0x" + OFFER.toUpperCase())).toBe(offerFileKind(OFFER));
    expect(() => offerFileKind("abc")).toThrow(/64 hex/);
    const key = partiesKeyFromHex(KEY);
    expect(lookupId(key, offerFileKind(OFFER), 0)).not.toBe(lookupId(key, offerFileKind("ef".repeat(32)), 0));
  });

  it("checks a picked file before it goes anywhere", async () => {
    await expect(pickFile("notes.docx", "application/msword", bytes(10, 5))).rejects.toThrow(/PDF or a photo/);
    await expect(pickFile("big.pdf", "application/pdf", new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow(/over 5 MB/);
    const p = await pickFile("C:\\docs\\offer.pdf", "application/pdf", bytes(10, 6));
    expect(p.file.name).toBe("offer.pdf");
    expect(p.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treat a taken slot as a retry of the same piece, and stop on any other failure", async () => {
    const client = memoryClient();
    const a = await pickFile("a.pdf", "application/pdf", bytes(100, 7));
    await sendOfferFiles(client, KEY, OFFER, [a]);
    await expect(sendOfferFiles(client, KEY, OFFER, [a])).resolves.toBeUndefined();
    const broken = { put: async () => Promise.reject(new MailboxError("REQUEST_FAILED", "nope")) };
    await expect(sendOfferFiles(broken, KEY, OFFER, [a])).rejects.toThrow(/nope/);
  });
});
