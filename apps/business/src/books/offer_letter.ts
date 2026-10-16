// ---------------------------------------------------------------------------
// The offer letter: what an offer carries beyond pay and dates (Joshua,
// 2026-10-16). A job offer is more than a rate; the business writes or
// pastes everything the person should read (the job, requirements, handbook,
// benefits) into one box, and the person accepts it as a whole.
//
// It lives inside the terms document (version 2), so the terms fingerprint
// the agreement records commits to the letter's exact words. The letter's
// shape still has four sections (offers sent before the single box used
// them); a new letter is all in `description`, shown as "Offer letter".
//
// Files: offers no longer carry PDFs or photos (Joshua, 2026-10-16: paste the
// text instead; files are too big for the chain, docs/LETTERS.md). An offer
// sent before that may still list files, each by its SHA-256; their pieces
// travel separately, and `chunks` says how many each file has.
//
// One definition for both sides of the app: the business builds and checks a
// letter with this module and the worker checks what arrives with it, so the
// two can never disagree on what a valid letter is or on its key order.
// Pure: no I/O, no React.
// ---------------------------------------------------------------------------

import type { AttachmentRef } from "@pnw/sales";

/** What the business writes, beyond the agreement's own terms text. Empty sections are left empty. */
export type Letter = {
  /** The job: what the role is and what the person will do. */
  description: string;
  /** What the person needs: licences, experience, tools, availability. */
  requirements: string;
  /** Handbook and policies: conduct, safety, time off, anything the business holds people to. */
  handbook: string;
  /** Anything else the business wants the person to read before accepting. */
  other: string;
};

/** A file attached to the offer, as the terms commit to it. */
export type OfferFile = {
  name: string;
  /** One of OFFER_FILE_TYPES. */
  type: string;
  /** Bytes. */
  size: number;
  /** SHA-256 of the file's bytes, 64 lower-case hex characters. */
  sha256: string;
  /** How many pieces it travels in: ceil(size / OFFER_CHUNK_BYTES). */
  chunks: number;
};

export const LETTER_SECTIONS = [
  { key: "description", label: "Job description", hint: "What the role is and what they'll do day to day." },
  { key: "requirements", label: "Requirements", hint: "Licences, experience, tools, availability." },
  { key: "handbook", label: "Handbook and policies", hint: "Conduct, safety, time off: what you hold everyone to." },
  { key: "other", label: "Anything else", hint: "Benefits, perks, or anything they should read before accepting." },
] as const satisfies readonly { key: keyof Letter; label: string; hint: string }[];

export const OFFER_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
/** Every attachment together (Joshua: PDFs and images, up to 5 MB). */
export const MAX_OFFER_FILES_BYTES = 5 * 1024 * 1024;
export const MAX_OFFER_FILES = 5;
/** One piece of a file: exactly what one sealed mailbox document can carry. */
export const OFFER_CHUNK_BYTES = 256 * 1024;
/** Per section, in characters: a long handbook fits, a novel doesn't. */
export const MAX_SECTION_CHARS = 20_000;
/** How the single box is labelled wherever a letter shows. */
export const LETTER_LABEL = "Offer letter";
const MAX_FILE_NAME = 120;

export class LetterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LetterError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const emptyLetter = (): Letter => ({ description: "", requirements: "", handbook: "", other: "" });

/** A letter written in the single box. */
export const letterFromText = (text: string): Letter => ({ ...emptyLetter(), description: text });

/**
 * A letter as one text, for the single box: a new letter's text as it is; an
 * older letter's sections one after another, each under its heading.
 */
export function letterText(l: Letter | undefined): string {
  if (!l) return "";
  const written = LETTER_SECTIONS.filter((s) => l[s.key].trim() !== "");
  if (written.length === 0) return "";
  if (written.length === 1 && written[0]!.key === "description") return l.description;
  return written.map((s) => `${s.label}\n\n${l[s.key].trim()}`).join("\n\n");
}

/** True when the business wrote anything in the letter. */
export const hasLetter = (l: Letter | undefined): boolean => !!l && LETTER_SECTIONS.some((s) => l[s.key].trim() !== "");

/** Checks a letter and returns a clean copy, keys in canonical order. */
export function validateLetter(raw: unknown): Letter {
  if (!isObject(raw)) throw new LetterError("The offer letter must be an object");
  const out = emptyLetter();
  for (const { key, label } of LETTER_SECTIONS) {
    const v = raw[key];
    if (typeof v !== "string") throw new LetterError(`The letter's ${label.toLowerCase()} must be text`);
    if ([...v].length > MAX_SECTION_CHARS) throw new LetterError(`${label} can be at most ${MAX_SECTION_CHARS.toLocaleString("en-US")} characters`);
    out[key] = v;
  }
  return out;
}

/** How many pieces a file of this size travels in. */
export const chunkCount = (size: number): number => Math.ceil(size / OFFER_CHUNK_BYTES);

/** Checks one file's name, type and size, as picked (before its fingerprint is known). */
export function checkOfferFile(name: string, type: string, size: number): void {
  if (!(OFFER_FILE_TYPES as readonly string[]).includes(type)) throw new LetterError("Attach a PDF or a photo (PNG, JPEG or WebP)");
  if (!Number.isInteger(size) || size <= 0) throw new LetterError(`${name || "That file"} is empty`);
  if (size > MAX_OFFER_FILES_BYTES) throw new LetterError(`${name || "That file"} is over 5 MB`);
}

/** A file name safe to show and save: no folders, no control characters, not too long. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_FILE_NAME);
  return clean || "attachment";
}

/** Checks the attached files and returns clean copies, keys in canonical order. */
export function validateOfferFiles(raw: unknown): OfferFile[] {
  if (!Array.isArray(raw)) throw new LetterError("The offer's files must be a list");
  if (raw.length > MAX_OFFER_FILES) throw new LetterError(`Attach at most ${MAX_OFFER_FILES} files`);
  let total = 0;
  const seen = new Set<string>();
  return raw.map((f) => {
    if (!isObject(f)) throw new LetterError("Each attached file must be an object");
    const { name, type, size, sha256, chunks } = f;
    if (typeof name !== "string" || name !== cleanFileName(name)) throw new LetterError("Each attached file needs a plain name");
    if (typeof type !== "string" || typeof size !== "number") throw new LetterError("Each attached file needs a type and a size");
    checkOfferFile(name, type, size);
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw new LetterError("Each attached file needs its fingerprint");
    if (chunks !== chunkCount(size)) throw new LetterError("An attached file's piece count doesn't match its size");
    if (seen.has(sha256)) throw new LetterError("The same file is attached twice");
    seen.add(sha256);
    total += size;
    if (total > MAX_OFFER_FILES_BYTES) throw new LetterError("The attached files can be at most 5 MB together");
    return { name, type, size, sha256, chunks };
  });
}

/** Where each file's first piece sits: the pieces of all files are numbered one after another, in order. */
export function firstPieces(files: readonly Pick<OfferFile, "chunks">[]): number[] {
  const starts: number[] = [];
  let next = 0;
  for (const f of files) {
    starts.push(next);
    next += f.chunks;
  }
  return starts;
}

/** Shown for a file: its name and size. */
export function fileLabel(f: Pick<OfferFile, "name" | "size">): string {
  const kb = f.size / 1024;
  return `${f.name} · ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`}`;
}

/**
 * The saved copies of an offer's files, one per file, as the vault keeps them
 * (an attachment id plus the same fingerprint, type and size). Checked against
 * the files the terms list, so a copy always matches what was offered.
 */
export function validateFileRefs(raw: unknown, files: readonly OfferFile[]): AttachmentRef[] {
  if (!Array.isArray(raw)) throw new LetterError("The offer's saved files must be a list");
  const wanted = new Map(files.map((f) => [f.sha256, f]));
  const seen = new Set<string>();
  return raw.map((r) => {
    if (!isObject(r)) throw new LetterError("Each saved file must be an object");
    const { attachmentId, sha256, type, size, name } = r;
    if (typeof attachmentId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(attachmentId)) throw new LetterError("A saved file's id isn't valid");
    const file = typeof sha256 === "string" ? wanted.get(sha256) : undefined;
    if (!file || seen.has(file.sha256)) throw new LetterError("A saved file isn't one of the offer's files");
    if (type !== file.type || size !== file.size) throw new LetterError("A saved file doesn't match the offer's");
    seen.add(file.sha256);
    return { attachmentId, sha256: file.sha256, type: file.type, size: file.size, name: typeof name === "string" && name.trim() ? name : file.name };
  });
}

// ---- Expiry -----------------------------------------------------------------------------------
// Every offer has one (Joshua, 2026-10-16). It sits inside the terms, so the
// agreement's terms hash commits to it: the person's app won't accept after it,
// and the offer's documents are cleared from the mailbox once it passes.

/** The windows a business can give an offer, in days. */
export const EXPIRY_DAYS = [3, 7, 14, 30] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];
export const DEFAULT_EXPIRY_DAYS: ExpiryDays = 7;
const DAY_MS = 86_400_000;

/** When an offer made at `offeredAt` expires, given `days`. */
export function expiryFor(offeredAt: string, days: ExpiryDays): string {
  if (!(EXPIRY_DAYS as readonly number[]).includes(days)) throw new LetterError(`An offer expires after ${EXPIRY_DAYS.join(", ")} days`);
  return new Date(Date.parse(offeredAt) + days * DAY_MS).toISOString();
}

/** Checks an expiry: a real time after the offer, at most the longest window later. */
export function validateExpiry(offeredAt: string, raw: unknown): string {
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) throw new LetterError("The offer needs an expiry time");
  const span = Date.parse(raw) - Date.parse(offeredAt);
  if (span <= 0) throw new LetterError("The offer must expire after it's made");
  if (span > Math.max(...EXPIRY_DAYS) * DAY_MS) throw new LetterError(`An offer can stay open at most ${Math.max(...EXPIRY_DAYS)} days`);
  return raw;
}

export const isExpired = (expiresAt: string, now: Date = new Date()): boolean => now.getTime() >= Date.parse(expiresAt);

/** "Expires in 3 days", "Expires today", "Expired": for a row on a phone. */
export function expiryLabel(expiresAt: string, now: Date = new Date()): string {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / DAY_MS);
  if (days === 0) return `Expires in ${Math.max(1, Math.ceil(ms / 3_600_000))} h`;
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}
