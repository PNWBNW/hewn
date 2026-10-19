// ---------------------------------------------------------------------------
// The job board on the chain (`hewn_jobs_v1`, docs/JOB_BOARD.md): how a
// posting is encoded for the program, read back from its public mappings,
// and ordered on the board.
//
//   post     $1 USDCx to the Hewn foundation plus the network fee
//   update   free
//   feature  $5 USDCx a day, 1 to 30 days, never more than 30 days ahead
//   close    free
//
// Every call is gated on chain by the business's .hewn name and its industry
// code (the registry's `employer_suffix_code`), passed as inputs. The body
// (title, location, description) travels as 40 field elements, packed and
// deflated the way letters are. Pure apart from the injected reads: no
// React, no storage, nothing logged.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import {
  EMPLOYMENT_TYPES,
  type EmploymentType,
  JobsError,
  MAX_HOURS_TENTHS,
  PAY_TYPES,
  PLACES,
  type PayType,
  type Place,
  type PostingBody,
  type PostingFacts,
  validateBody,
  validateFacts,
} from "../books/jobs";
import { packPayload, unpackPayload } from "./compress";
import { FIELD_BYTES, LetterError, packParcel, unpackParcel } from "./letters";

export const JOBS_PROGRAM = PROGRAMS.jobs.hewn_jobs;
export const POST_FUNCTION = "post";
export const UPDATE_FUNCTION = "update";
export const FEATURE_FUNCTION = "feature";
export const CLOSE_FUNCTION = "close";

/** The body is `[field; 40]`: 40 × 31 bytes, less the 2-byte length. */
export const BODY_FIELDS = 40;
export const BODY_BYTES = BODY_FIELDS * FIELD_BYTES - 2;

/** The program's constants, in cents and blocks. */
export const POSTING_FEE_CENTS = 100;
export const FEATURE_FEE_CENTS_PER_DAY = 500;
export const MAX_FEATURE_DAYS = 30;
export const BLOCKS_PER_DAY = 28_800;
export const MAX_FEATURE_BLOCKS = MAX_FEATURE_DAYS * BLOCKS_PER_DAY;

export type JobsCall = { program: string; function: string; inputs: string[] };

// ---- Codes ---------------------------------------------------------------

const code = <T extends string>(list: readonly T[], value: T): number => list.indexOf(value);
const fromCode = <T extends string>(list: readonly T[], n: number, what: string): T => {
  const v = list[n];
  if (v === undefined) throw new JobsError(`A posting's ${what} isn't one this app knows`);
  return v;
};

// ---- The id ----------------------------------------------------------------

/** A fresh posting id: 31 random bytes, so it is always a field element and never 0. */
export function newPostingId(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  let v = 0n;
  do {
    const bytes = random(new Uint8Array(31));
    v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
  } while (v === 0n);
  return v.toString();
}

const FIELD = /^[0-9]{1,78}$/;
export const bareField = (f: string): string => f.replace(/field$/, "").trim();
const fieldInput = (f: string, what: string): string => {
  const bare = bareField(f);
  if (!FIELD.test(bare)) throw new JobsError(`The ${what} isn't valid`);
  return `${bare}field`;
};

// ---- The body ----------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const TOO_LONG = "The posting is too long to fit on the board; shorten the description";

/** The words as the 40 field elements the program takes: JSON, deflated when smaller, packed. */
export async function packBody(body: PostingBody): Promise<bigint[]> {
  const clean = validateBody(body);
  const payload = await packPayload(encoder.encode(JSON.stringify([clean.title, clean.location, clean.description])));
  if (payload.length > BODY_BYTES) throw new JobsError(TOO_LONG);
  try {
    return packParcel(payload, BODY_FIELDS);
  } catch (e) {
    throw e instanceof LetterError ? new JobsError(TOO_LONG) : e;
  }
}

/** The words back out of the program's fields. Throws on anything `packBody` couldn't have made. */
export async function unpackBody(fields: readonly bigint[]): Promise<PostingBody> {
  if (fields.length !== BODY_FIELDS) throw new JobsError("A posting's body has the wrong shape");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(await unpackPayload(unpackParcel(fields))));
  } catch {
    throw new JobsError("A posting's body couldn't be read");
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new JobsError("A posting's body couldn't be read");
  return validateBody({ title: parsed[0], location: parsed[1], description: parsed[2] });
}

/** The `Body` struct as a transition input. */
export const bodyInput = (fields: readonly bigint[]): string => `{ words: [${fields.map((f) => `${f}field`).join(", ")}] }`;

// ---- The calls --------------------------------------------------------------

export type PostingKey = {
  /** Decimal field, with or without `field`. */
  id: string;
  employerNameHash: string;
  /** The industry code the business name was registered under, 1 to 40. */
  suffixCode: number;
};

function keyInputs(k: PostingKey): string[] {
  if (!Number.isInteger(k.suffixCode) || k.suffixCode < 1 || k.suffixCode > 40) throw new JobsError("The business name's industry isn't known; try again in a moment");
  const id = fieldInput(k.id, "posting id");
  if (/^0+field$/.test(id)) throw new JobsError("The posting id isn't valid");
  return [id, fieldInput(k.employerNameHash, "business name"), `${k.suffixCode}u8`];
}

function factsInputs(facts: PostingFacts): string[] {
  const f = validateFacts(facts);
  return [`${code(PAY_TYPES, f.payType)}u8`, `${f.payMinCents}u64`, `${f.payMaxCents}u64`, `${code(EMPLOYMENT_TYPES, f.employmentType)}u8`, `${f.hoursPerWeekTenths}u16`, `${code(PLACES, f.place)}u8`];
}

export const postCall = (key: PostingKey, facts: PostingFacts, body: readonly bigint[]): JobsCall => ({
  program: JOBS_PROGRAM,
  function: POST_FUNCTION,
  inputs: [...keyInputs(key), ...factsInputs(facts), bodyInput(body)],
});

export const updateCall = (key: PostingKey, facts: PostingFacts, body: readonly bigint[]): JobsCall => ({
  program: JOBS_PROGRAM,
  function: UPDATE_FUNCTION,
  inputs: [...keyInputs(key), ...factsInputs(facts), bodyInput(body)],
});

export function featureCall(key: PostingKey, days: number): JobsCall {
  if (!Number.isInteger(days) || days < 1 || days > MAX_FEATURE_DAYS) throw new JobsError(`Choose 1 to ${MAX_FEATURE_DAYS} days`);
  return { program: JOBS_PROGRAM, function: FEATURE_FUNCTION, inputs: [...keyInputs(key), `${days}u8`] };
}

export const closeCall = (key: PostingKey): JobsCall => ({ program: JOBS_PROGRAM, function: CLOSE_FUNCTION, inputs: keyInputs(key) });

export const featureCostCents = (days: number): number => days * FEATURE_FEE_CENTS_PER_DAY;

/** The most days a posting can be featured for right now: the cap, less what it already has ahead. */
export function daysAllowed(featuredUntil: number, height: number): number {
  const ahead = Math.max(0, featuredUntil - height);
  return Math.max(0, Math.floor((MAX_FEATURE_BLOCKS - ahead) / BLOCKS_PER_DAY));
}

/** Where the window would end after `days` more, as the program computes it. */
export const featuredUntilAfter = (featuredUntil: number, height: number, days: number): number => Math.max(featuredUntil, height) + days * BLOCKS_PER_DAY;

/** Whole days of featuring left, rounded up; 0 when the window has passed. */
export const featuredDaysLeft = (featuredUntil: number, height: number): number => Math.max(0, Math.ceil((featuredUntil - height) / BLOCKS_PER_DAY));

// ---- Reading the board -------------------------------------------------------

/** A posting as the chain holds it (`postings[id]`). */
export type Posting = {
  id: string;
  employerNameHash: string;
  postedHeight: number;
  open: boolean;
  featuredUntil: number;
  facts: PostingFacts;
};

export type BoardPosting = Posting & { body: PostingBody | null };

/** One mapping value from the program, as the explorer returns it; null when the key is unset. */
export type JobsRead = (mapping: string, key: string) => Promise<string | null>;

export function explorerJobsRead(endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): JobsRead {
  return async (mapping, key) => {
    const res = await fetchImpl(`${endpoint}/program/${JOBS_PROGRAM}/mapping/${mapping}/${key}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new JobsError("The board couldn't be read; try again in a moment");
    const data: unknown = await res.json();
    return data === null || data === undefined ? null : typeof data === "string" ? data : JSON.stringify(data);
  };
}

const number = (raw: string, name: string, suffix: string, max: number): number => {
  const m = new RegExp(`\\b${name}\\s*:\\s*(\\d+)${suffix}\\b`).exec(raw);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) throw new JobsError(`A posting's ${name.replace(/_/g, " ")} couldn't be read`);
  return n;
};

/** `postings[id]` from the explorer's text. */
export function parsePosting(id: string, raw: string): Posting {
  const hash = /\bemployer_name_hash\s*:\s*(\d+)field\b/.exec(raw)?.[1];
  const open = /\bopen\s*:\s*(true|false)\b/.exec(raw)?.[1];
  if (!hash || !open) throw new JobsError("A posting couldn't be read");
  const facts = validateFacts({
    payType: fromCode<PayType>(PAY_TYPES, number(raw, "pay_type", "u8", 255), "pay type"),
    payMinCents: number(raw, "pay_min", "u64", Number.MAX_SAFE_INTEGER),
    payMaxCents: number(raw, "pay_max", "u64", Number.MAX_SAFE_INTEGER),
    employmentType: fromCode<EmploymentType>(EMPLOYMENT_TYPES, number(raw, "employment_type", "u8", 255), "kind of work"),
    hoursPerWeekTenths: number(raw, "hours_per_week", "u16", MAX_HOURS_TENTHS),
    place: fromCode<Place>(PLACES, number(raw, "place", "u8", 255), "place"),
  });
  return { id: bareField(id), employerNameHash: hash, postedHeight: number(raw, "posted_height", "u32", 0xffff_ffff), open: open === "true", featuredUntil: number(raw, "featured_until", "u32", 0xffff_ffff), facts };
}

/** `posting_body[id]`'s 40 fields from the explorer's text. */
export function parseBodyFields(raw: string): bigint[] {
  const list = /\bwords\s*:\s*\[([^\]]*)\]/.exec(raw)?.[1];
  if (list === undefined) throw new JobsError("A posting's body couldn't be read");
  return [...list.matchAll(/(\d+)field\b/g)].map((m) => BigInt(m[1]!));
}

const count = (raw: string | null): number => {
  if (raw === null) return 0;
  const n = Number(/(\d+)u32/.exec(raw)?.[1]);
  return Number.isInteger(n) ? n : 0;
};

/** How many postings there have ever been. */
export const readPostingCount = async (read: JobsRead): Promise<number> => count(await read("posting_count", "0u8"));

/** The i-th posting's id, or null past the end. */
export async function readPostingIdAt(read: JobsRead, i: number): Promise<string | null> {
  const raw = await read("posting_at", `${i}u32`);
  const id = raw ? /(\d+)field/.exec(raw)?.[1] : undefined;
  return id ?? null;
}

export async function readPosting(read: JobsRead, id: string): Promise<Posting | null> {
  const raw = await read("postings", fieldInput(id, "posting id"));
  return raw === null ? null : parsePosting(id, raw);
}

export async function readBody(read: JobsRead, id: string): Promise<PostingBody | null> {
  const raw = await read("posting_body", fieldInput(id, "posting id"));
  if (raw === null) return null;
  try {
    return await unpackBody(parseBodyFields(raw));
  } catch {
    return null; // a body this app can't read is shown without words, not as an error for the whole board
  }
}

/** The newest `max` postings, newest index first, with their words. `openOnly` skips closed ones (still counting toward `max`). */
export async function readRecent(read: JobsRead, max: number, openOnly = true): Promise<{ postings: BoardPosting[]; total: number }> {
  const total = await readPostingCount(read);
  const postings: BoardPosting[] = [];
  for (let i = total - 1; i >= 0 && i >= total - max; i--) {
    const id = await readPostingIdAt(read, i);
    if (!id) continue;
    const posting = await readPosting(read, id);
    if (!posting || (openOnly && !posting.open)) continue;
    postings.push({ ...posting, body: await readBody(read, id) });
  }
  return { postings, total };
}

/** Featured postings still inside their window first (the latest window first), then the rest newest first. */
export function boardOrder<T extends Pick<Posting, "postedHeight" | "featuredUntil">>(list: readonly T[], height: number): T[] {
  const featured = (p: T) => p.featuredUntil > height;
  return [...list].sort((a, b) => {
    const fa = featured(a);
    const fb = featured(b);
    if (fa !== fb) return fa ? -1 : 1;
    if (fa && a.featuredUntil !== b.featuredUntil) return b.featuredUntil - a.featuredUntil;
    return b.postedHeight - a.postedHeight;
  });
}
