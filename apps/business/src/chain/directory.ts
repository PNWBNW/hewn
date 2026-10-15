// ---------------------------------------------------------------------------
// Finding people and businesses on the registry by their name. One lookup
// for both: type `ana.hewn` or `dayco.hewn` (or just the name, or an account
// starting aleo1) and get back who it is: a person or a business, the account
// it points at, and for a business its industry. Names are public by design (the registry's reverse resolver),
// and nothing private is read.
//
// Names are held on chain as hashes, so only an exact name can be found:
// there is no way to search by the first letters, and no list to browse.
//
// Pure apart from the injected reads: no React, no storage, nothing logged.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import {
  INDUSTRY_SUFFIXES,
  computeNameHash,
  queryEmployerName,
  queryNameKind,
  queryNameOwner,
  queryNamePlaintext,
  queryWorkerName,
} from "@pnw/records/registry/name_registry";
import { isRailAddress } from "../books/rail";

export type NameKind = "worker" | "business";

export type DirectoryEntry = {
  /** The bare registered name; empty when the registry holds no plaintext for it. */
  name: string;
  /** Decimal field, no `field` suffix. */
  nameHash: string;
  address: string;
  kind: NameKind;
  /** Businesses only: the industry code and label the name was registered under. */
  industryCode?: number;
  industry?: string;
};

export class DirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryError";
  }
}

export type DirectoryReads = {
  nameOwner: (nameHash: string) => Promise<string | null>;
  nameKind: (nameHash: string) => Promise<number | null>;
  namePlaintext: (nameHash: string) => Promise<string | null>;
  workerName: (address: string) => Promise<string | null>;
  employerName: (address: string) => Promise<string | null>;
  employerSuffix: (nameHash: string) => Promise<number | null>;
};

/** `employer_suffix_code` in the registry: the industry a business name was registered under. Null on a miss. */
export async function queryEmployerSuffix(nameHash: string, endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const url = `${endpoint}/program/${PROGRAMS.layer1.pnw_name_registry}/mapping/employer_suffix_code/${nameHash}field`;
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (typeof data !== "string") return null;
    const code = parseInt(data.replace(/u8(\.private|\.public)?$/, "").trim(), 10);
    return Number.isInteger(code) && code >= 1 && code <= 40 ? code : null;
  } catch {
    return null;
  }
}

const field = (hash: string) => `${hash.replace(/field$/, "").trim()}field`;

export const directoryReads: DirectoryReads = {
  nameOwner: (h) => queryNameOwner(h),
  nameKind: (h) => queryNameKind(field(h)),
  namePlaintext: (h) => queryNamePlaintext(h),
  workerName: (a) => queryWorkerName(a),
  employerName: (a) => queryEmployerName(a),
  employerSuffix: (h) => queryEmployerSuffix(h),
};

const bareField = (f: string) => f.replace(/field$/, "").trim();

export const NAME_FORMAT = /^[a-z0-9_]{3,16}$/;
/** The display suffix is `.hewn`; `.pnw` is what names were called before, and is accepted too. */
const LEGACY_SUFFIXES = ["pnw"];

/** A name as typed (any case, `@` first, with or without the display suffix) → the bare name. */
export function bareDirectoryName(text: string, suffix: string): string {
  let t = text.trim().toLowerCase().replace(/^@/, "");
  for (const s of [suffix.toLowerCase(), ...LEGACY_SUFFIXES]) {
    if (t.endsWith(`.${s}`)) {
      t = t.slice(0, -(s.length + 1));
      break;
    }
  }
  return t;
}

async function describe(nameHash: string, address: string, kind: NameKind, reads: DirectoryReads): Promise<DirectoryEntry> {
  const name = (await reads.namePlaintext(nameHash)) || "";
  const entry: DirectoryEntry = { name, nameHash, address, kind };
  if (kind === "business") {
    const code = await reads.employerSuffix(nameHash);
    if (code !== null) {
      entry.industryCode = code;
      const label = INDUSTRY_SUFFIXES[code]?.label;
      if (label) entry.industry = label;
    }
  }
  return entry;
}

/** An account → whoever holds it: a business name first, else a worker's, else an error. */
export async function lookupAddress(address: string, reads: DirectoryReads = directoryReads): Promise<DirectoryEntry> {
  if (!isRailAddress(address)) throw new DirectoryError("That account isn't complete: 63 characters starting aleo1");
  const employer = await reads.employerName(address);
  if (employer) return describe(bareField(employer), address, "business", reads);
  const worker = await reads.workerName(address);
  if (worker) return describe(bareField(worker), address, "worker", reads);
  throw new DirectoryError("That account has no registered name");
}

/** A name → whoever registered it. Exact names only. */
export async function lookupName(text: string, suffix: string, reads: DirectoryReads = directoryReads): Promise<DirectoryEntry> {
  const name = bareDirectoryName(text, suffix);
  if (!name) throw new DirectoryError("Enter a name or an account");
  if (!NAME_FORMAT.test(name)) throw new DirectoryError("Names are 3 to 16 characters: lower-case letters, digits and underscores");
  const nameHash = computeNameHash(name);
  const owner = await reads.nameOwner(nameHash);
  if (!owner) throw new DirectoryError(`No one has registered ${name}.${suffix}. Names have to match exactly; check the spelling`);
  const code = await reads.nameKind(nameHash);
  let kind: NameKind;
  if (code === 2) kind = "business";
  else if (code === 1) kind = "worker";
  else kind = (await reads.employerName(owner)) ? "business" : "worker"; // the kind mapping missed; the owner's own primary name says
  const entry = await describe(nameHash, owner, kind, reads);
  return entry.name ? entry : { ...entry, name };
}

/** One lookup for either: an account when it starts aleo1, else a name. */
export async function lookup(text: string, suffix: string, reads: DirectoryReads = directoryReads): Promise<DirectoryEntry> {
  const raw = text.trim();
  return raw.startsWith("aleo1") ? lookupAddress(raw, reads) : lookupName(raw, suffix, reads);
}

/** Throws when what was found isn't one of the kinds the caller can use. */
export function requireKind(entry: DirectoryEntry, allow: readonly NameKind[], suffix: string): DirectoryEntry {
  if (allow.includes(entry.kind)) return entry;
  const who = entry.name ? `${entry.name}.${suffix}` : "That account";
  throw new DirectoryError(`${who} is ${entry.kind === "business" ? "a business" : "a person"}, not ${allow.includes("business") ? "a business" : "a person"}`);
}

/** `dayco.hewn`, or the short account when the registry has no plaintext for the name. */
export function entryLabel(entry: DirectoryEntry, suffix: string): string {
  return entry.name ? `${entry.name}.${suffix}` : `${entry.address.slice(0, 9)}…${entry.address.slice(-4)}`;
}
