import { describe, expect, it } from "vitest";
import {
  MAX_OFFER_FILES_BYTES,
  MAX_SECTION_CHARS,
  OFFER_CHUNK_BYTES,
  checkOfferFile,
  chunkCount,
  cleanFileName,
  emptyLetter,
  fileLabel,
  firstPieces,
  hasLetter,
  validateFileRefs,
  validateLetter,
  validateOfferFiles,
} from "./offer_letter";

const SHA = (c: string) => c.repeat(64);
const file = (over: Partial<{ name: string; type: string; size: number; sha256: string; chunks: number }> = {}) => {
  const size = over.size ?? 300_000;
  return { name: "contract.pdf", type: "application/pdf", size, sha256: SHA("a"), chunks: chunkCount(size), ...over };
};

describe("the offer letter", () => {
  it("keeps the four sections in order and lets any of them be empty", () => {
    const l = validateLetter({ other: "Dental after 90 days", description: "Framing crew", requirements: "", handbook: "Steel toes on site" });
    expect(Object.keys(l)).toEqual(["description", "requirements", "handbook", "other"]);
    expect(validateLetter(emptyLetter())).toEqual(emptyLetter());
    expect(hasLetter(emptyLetter())).toBe(false);
    expect(hasLetter({ ...emptyLetter(), handbook: "  " })).toBe(false);
    expect(hasLetter(l)).toBe(true);
  });

  it("refuses a section that isn't text or is too long", () => {
    expect(() => validateLetter({ ...emptyLetter(), requirements: 3 })).toThrow(/requirements must be text/);
    expect(() => validateLetter({ description: "x" })).toThrow(/must be text/);
    expect(() => validateLetter({ ...emptyLetter(), handbook: "x".repeat(MAX_SECTION_CHARS + 1) })).toThrow(/at most/);
    expect(validateLetter({ ...emptyLetter(), handbook: "x".repeat(MAX_SECTION_CHARS) }).handbook).toHaveLength(MAX_SECTION_CHARS);
    expect(() => validateLetter("Framing crew")).toThrow(/object/);
  });
});

describe("offer files", () => {
  it("allow PDFs and photos up to 5 MB, nothing else", () => {
    expect(() => checkOfferFile("a.pdf", "application/pdf", 1)).not.toThrow();
    expect(() => checkOfferFile("a.jpg", "image/jpeg", MAX_OFFER_FILES_BYTES)).not.toThrow();
    expect(() => checkOfferFile("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10)).toThrow(/PDF or a photo/);
    expect(() => checkOfferFile("a.svg", "image/svg+xml", 10)).toThrow(/PDF or a photo/); // SVG can carry script: not a photo here
    expect(() => checkOfferFile("a.pdf", "application/pdf", 0)).toThrow(/empty/);
    expect(() => checkOfferFile("a.pdf", "application/pdf", MAX_OFFER_FILES_BYTES + 1)).toThrow(/over 5 MB/);
  });

  it("travel in 256 KB pieces, numbered one file after another", () => {
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(OFFER_CHUNK_BYTES)).toBe(1);
    expect(chunkCount(OFFER_CHUNK_BYTES + 1)).toBe(2);
    expect(chunkCount(MAX_OFFER_FILES_BYTES)).toBe(20);
    expect(firstPieces([{ chunks: 2 }, { chunks: 1 }, { chunks: 3 }])).toEqual([0, 2, 3]);
    expect(firstPieces([])).toEqual([]);
  });

  it("keep plain names: no folders, no control characters, not too long", () => {
    expect(cleanFileName("C:\\Users\\ana\\offer.pdf")).toBe("offer.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(cleanFileName("   ")).toBe("attachment");
    expect(cleanFileName("x".repeat(300))).toHaveLength(120);
    expect(fileLabel({ name: "a.pdf", size: 2048 })).toBe("a.pdf · 2 KB");
    expect(fileLabel({ name: "a.pdf", size: 3 * 1024 * 1024 })).toBe("a.pdf · 3.0 MB");
  });

  it("are checked as a list: at most five, 5 MB together, no repeats, piece counts that match", () => {
    expect(validateOfferFiles([file(), file({ name: "photo.png", type: "image/png", sha256: SHA("b"), size: 10 })])).toHaveLength(2);
    expect(Object.keys(validateOfferFiles([{ chunks: 2, sha256: SHA("a"), size: 300_000, type: "application/pdf", name: "contract.pdf" }])[0]!)).toEqual([
      "name",
      "type",
      "size",
      "sha256",
      "chunks",
    ]);
    expect(() => validateOfferFiles(Array.from({ length: 6 }, (_, i) => file({ sha256: SHA(String(i)), size: 10 })))).toThrow(/at most 5 files/);
    expect(() => validateOfferFiles([file({ size: 3_000_000 }), file({ sha256: SHA("b"), size: 3_000_000 })])).toThrow(/5 MB together/);
    expect(() => validateOfferFiles([file(), file()])).toThrow(/twice/);
    expect(() => validateOfferFiles([file({ chunks: 1 })])).toThrow(/piece count/);
    expect(() => validateOfferFiles([file({ sha256: "A".repeat(64) })])).toThrow(/fingerprint/);
    expect(() => validateOfferFiles([file({ name: "../contract.pdf" })])).toThrow(/plain name/);
    expect(() => validateOfferFiles("contract.pdf")).toThrow(/list/);
  });

  it("saved copies must be the offer's own files, one each", () => {
    const files = validateOfferFiles([file(), file({ name: "photo.png", type: "image/png", sha256: SHA("b"), size: 10 })]);
    const ref = (sha256: string, over = {}) => ({ attachmentId: `att-${sha256[0]}`, sha256, type: "application/pdf", size: 300_000, name: "contract.pdf", ...over });
    expect(validateFileRefs([ref(SHA("a"))], files)).toEqual([ref(SHA("a"))]);
    expect(() => validateFileRefs([ref(SHA("c"))], files)).toThrow(/isn't one of the offer's files/);
    expect(() => validateFileRefs([ref(SHA("a")), ref(SHA("a"))], files)).toThrow(/isn't one of the offer's files/);
    expect(() => validateFileRefs([ref(SHA("a"), { size: 5 })], files)).toThrow(/doesn't match/);
    expect(() => validateFileRefs([ref(SHA("a"), { attachmentId: "../x" })], files)).toThrow(/id isn't valid/);
  });
});
