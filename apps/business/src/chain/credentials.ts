// ---------------------------------------------------------------------------
// A worker's credentials on chain (pnw_mvp_v2 hewn_credentials_v1, staged
// 2026-10-25; the design in docs/HEWN_ART.md):
//
//   hewn_credentials_v1::issue(parties_key, subject, kind, scope, nonce)   all private
//   hewn_credentials_v1::accept(c) / decline(c)   the subject's copy
//   hewn_credentials_v1::revoke(c)                the issuer's copy
//
// Issuing checks the pair through employer_agreement_v5's assert_pair_agreed
// (the key and both accounts private; the pair tag the one public finalize
// input besides the commitment), so nothing public names the two. The record
// carries the kind, the two accounts, the document's hash (the scope) and a
// random nonce; the commitment, one hash over those, is what the public
// status and issue block are filed under. Pure apart from the injected reads:
// no wallet, no React, no storage, nothing logged.
// ---------------------------------------------------------------------------

import { tlvEncode } from "@pnw/commitments/canonical_encoder";
import { DOMAIN_TAGS, domainHash } from "@pnw/commitments/hash";
import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import { lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { arrayFieldHex, packedWords } from "@pnw/records/packed";
import { CREDENTIAL_KINDS, type Credential, type CredentialDocument, type CredentialDraft, type CredentialKind, type CredentialStatus, canonicalCredential, validateCredentialDocument } from "@/books/credential";
import { packPayload, unpackPayload } from "./compress";

export const CREDENTIALS_PROGRAM: string = PROGRAMS.credentials.hewn_credentials;
export const ISSUE_CREDENTIAL = { program: CREDENTIALS_PROGRAM, function: "issue" } as const;
export const ACCEPT_CREDENTIAL = { program: CREDENTIALS_PROGRAM, function: "accept" } as const;
export const DECLINE_CREDENTIAL = { program: CREDENTIALS_PROGRAM, function: "decline" } as const;
export const REVOKE_CREDENTIAL = { program: CREDENTIALS_PROGRAM, function: "revoke" } as const;

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

// The program's codes.
const KIND_CODE: Record<CredentialKind, number> = { employment: 1, skills: 2, clearance: 3, custom: 4 };
const STATUS_OF_CODE: Record<number, CredentialStatus> = { 1: "offered", 2: "active", 3: "revoked", 4: "declined" };

export const kindCode = (kind: CredentialKind): number => KIND_CODE[kind];
export const kindOfCode = (code: number): CredentialKind | null => CREDENTIAL_KINDS.find((k) => KIND_CODE[k] === code) ?? null;
/** 0 is no credential; anything else unknown is null. */
export const statusOfCode = (code: number): CredentialStatus | null => STATUS_OF_CODE[code] ?? null;

// The document's hash, the way the handshake hashes its documents (BLAKE3 over PNW::DOC and a
// TLV object), with its own object tag after the handshake's.
const OBJ_CREDENTIAL_DOC = 0x6005;
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The scope the record carries: the document's hash, 64 hex characters. */
export function scopeHash(doc: CredentialDocument): string {
  return hex(domainHash(DOMAIN_TAGS.DOC, tlvEncode(OBJ_CREDENTIAL_DOC, [{ tag: 0x01, value: new TextEncoder().encode(canonicalCredential(doc)) }])));
}

/** A fresh nonce: 32 random bytes, hex. Both sides keep it; it is never public. */
export function newNonce(): string {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const FIELD = /^\d{1,78}$/;

/** The five inputs of `issue`, all private: the agreement's key, the person, the kind, the scope and the nonce, the 32-byte ones packed. */
export function issueInputs(partiesKey: string, subject: string, kind: CredentialKind, scope: string, nonce: string): string[] {
  if (!HEX64.test(partiesKey)) throw new CredentialsError("The agreement's key must be 64 hex characters");
  if (!ADDRESS.test(subject)) throw new CredentialsError("A credential needs the person's account");
  if (!(kind in KIND_CODE)) throw new CredentialsError("A credential is employment, skills, clearance or custom");
  if (!HEX64.test(scope)) throw new CredentialsError("The scope must be 64 hex characters");
  if (!HEX64.test(nonce) || /^0+$/.test(nonce)) throw new CredentialsError("The nonce must be 64 hex characters and not zero");
  return [packedWords(partiesKey, 2), subject, `${KIND_CODE[kind]}u8`, packedWords(scope, 2), packedWords(nonce, 2)];
}

export type CredentialRecord = {
  /** Which copy this is: the business's or the person's. */
  role: "issuer" | "subject";
  kind: CredentialKind;
  issuer: string;
  subject: string;
  /** 64 hex characters each. */
  scope: string;
  nonce: string;
  /** Decimal field, no suffix. */
  commitment: string;
  /** The record exactly as the wallet gave it: the one input of accept, decline and revoke. */
  plaintext: string;
};

const ADDRESS_FIELD = (field: string) => new RegExp(`${field}:\\s*(aleo1[a-z0-9]{58})`);
const U8_FIELD = (field: string) => new RegExp(`${field}:\\s*(\\d+)u8`);

/** One record, or null if it isn't an unspent credential record owned by this account. */
export function parseCredentialRecord(raw: unknown, address: string): CredentialRecord | null {
  const rec = raw as Record<string, unknown> | null;
  if (!rec || typeof rec !== "object" || rec.spent === true || rec.recordName !== "Credential") return null;
  const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
  const owner = plaintext.match(ADDRESS_FIELD("owner"))?.[1];
  const issuer = plaintext.match(ADDRESS_FIELD("issuer"))?.[1];
  const subject = plaintext.match(ADDRESS_FIELD("subject"))?.[1];
  const roleCode = Number(plaintext.match(U8_FIELD("role"))?.[1]);
  const kind = kindOfCode(Number(plaintext.match(U8_FIELD("kind"))?.[1]));
  const scope = arrayFieldHex(plaintext, "scope", 32);
  const nonce = arrayFieldHex(plaintext, "nonce", 32);
  const commitment = plaintext.match(/commitment:\s*(\d+)field/)?.[1];
  if (!owner || owner !== address || !issuer || !subject || !kind || !scope || !nonce || !commitment || !FIELD.test(commitment)) return null;
  const role = roleCode === 1 ? "issuer" : roleCode === 2 ? "subject" : null;
  if (!role) return null;
  // The copy's role agrees with its owner: the issuer holds the issuer copy, the subject theirs.
  if ((role === "issuer" && owner !== issuer) || (role === "subject" && owner !== subject)) return null;
  return { role, kind, issuer, subject, scope, nonce, commitment, plaintext };
}

/** Every unspent credential record this account holds, one per commitment. */
export function parseCredentialRecords(records: unknown[], address: string): CredentialRecord[] {
  const byCommitment = new Map<string, CredentialRecord>();
  for (const raw of records) {
    const r = parseCredentialRecord(raw, address);
    if (r && !byCommitment.has(r.commitment)) byCommitment.set(r.commitment, r);
  }
  return [...byCommitment.values()];
}

/** Reads the account's credential records from Shield. */
export async function readCredentialRecords(requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>, address: string): Promise<CredentialRecord[]> {
  const records = await requestRecords(CREDENTIALS_PROGRAM, true);
  return parseCredentialRecords(Array.isArray(records) ? records : [], address);
}

/** Whether a document is the one the record was issued for. */
export const documentMatchesRecord = (doc: CredentialDocument, record: Pick<CredentialRecord, "scope" | "kind">): boolean => doc.kind === record.kind && scopeHash(doc) === record.scope;

/** The one input of accept, decline and revoke: the mover's own copy. */
export const moveInputs = (record: Pick<CredentialRecord, "plaintext">): string[] => [record.plaintext];

/** One mapping value, as the explorer returns it; null when the commitment has no entry. */
export type MappingRead = (commitment: string) => Promise<string | null>;

export function explorerCredentialRead(mapping: "credential_status" | "credential_anchor", endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): MappingRead {
  return async (commitment) => {
    if (!FIELD.test(commitment)) throw new CredentialsError("That isn't a credential's commitment");
    const res = await fetchImpl(`${endpoint}/program/${CREDENTIALS_PROGRAM}/mapping/${mapping}/${commitment}field`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new CredentialsError("The credential couldn't be read; try again in a moment");
    const data: unknown = await res.json();
    return data === null || data === undefined ? null : typeof data === "string" ? data : JSON.stringify(data);
  };
}

/** The credential's public status, or null when none was issued under that commitment. */
export async function queryCredentialStatus(commitment: string, read: MappingRead = explorerCredentialRead("credential_status")): Promise<CredentialStatus | null> {
  const raw = await read(commitment);
  if (raw === null) return null;
  const code = /^\s*(\d+)u8/.exec(raw)?.[1];
  return code ? statusOfCode(Number(code)) : null;
}

/** The block the credential was issued at, or null. */
export async function queryCredentialAnchor(commitment: string, read: MappingRead = explorerCredentialRead("credential_anchor")): Promise<number | null> {
  const raw = await read(commitment);
  if (raw === null) return null;
  const height = /^\s*(\d+)u32/.exec(raw)?.[1];
  return height ? Number(height) : null;
}

// ---- The document as a letter ----------------------------------------------------------------
// What a credential says travels to the person as a sealed page under the agreement's parties
// key, the way an offer's terms do (chain/work/terms.ts): one slot of its own kind, named by the
// scope, so the person finds it from their record alone. The record carries only the hash.

/** The letter kind a credential's document goes under: its own slot, named by the scope (a kind is at most 32 characters). */
export function credentialDocKind(scope: string): string {
  if (!HEX64.test(scope)) throw new CredentialsError("The scope must be 64 hex characters");
  return `cred_${scope.slice(0, 24)}`;
}

/** Where the document sits: the lookup of its slot under the agreement's key. */
export function credentialLookup(partiesKeyHex: string, scope: string): string {
  return lookupId(partiesKeyFromHex(partiesKeyHex), credentialDocKind(scope), 0);
}

/** The document sealed for the person: the lookup, the envelope and the scope the record will carry. */
export async function sealCredentialDocument(partiesKeyHex: string, doc: CredentialDocument): Promise<{ lookup: string; envelope: Uint8Array; scope: string }> {
  const document = validateCredentialDocument(doc);
  const scope = scopeHash(document);
  const sealed = await seal(partiesKeyFromHex(partiesKeyHex), credentialDocKind(scope), 0, await packPayload(new TextEncoder().encode(canonicalCredential(document))));
  return { lookup: sealed.lookup, envelope: sealed.envelope, scope };
}

/** The document back from its envelope, checked against the scope it was sealed under. */
export async function openCredentialDocument(partiesKeyHex: string, scope: string, envelope: Uint8Array): Promise<CredentialDocument> {
  const bytes = await unpackPayload(await open(partiesKeyFromHex(partiesKeyHex), credentialDocKind(scope), 0, envelope));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CredentialsError("The credential's document couldn't be read");
  }
  const doc = validateCredentialDocument(raw);
  if (scopeHash(doc) !== scope) throw new CredentialsError("The credential's document doesn't match its record");
  return doc;
}

// ---- From the record to the vault ------------------------------------------------------------

/** The record issued with this nonce, if it is among the account's records yet. */
export const findRecordByNonce = (records: readonly CredentialRecord[], nonce: string): CredentialRecord | undefined => records.find((r) => r.nonce === nonce);

/** The business's copy, once its record is read: the draft's document and the record's commitment. */
export function credentialFromDraft(draft: CredentialDraft, record: CredentialRecord): Credential {
  if (record.role !== "issuer" || record.nonce !== draft.nonce || record.scope !== draft.scope || record.subject !== draft.counterpart) throw new CredentialsError("That record isn't this draft's");
  return { commitment: record.commitment, kind: draft.kind, document: draft.document, scope: draft.scope, nonce: draft.nonce, status: "offered", counterpart: draft.counterpart, workerId: draft.workerId };
}

/** The person's copy: the record with the document that came for it. */
export function credentialFromRecord(record: CredentialRecord, document: CredentialDocument, status: CredentialStatus): Credential {
  if (record.role !== "subject") throw new CredentialsError("That copy isn't the person's");
  if (!documentMatchesRecord(document, record)) throw new CredentialsError("The credential's document doesn't match its record");
  return { commitment: record.commitment, kind: record.kind, document, scope: record.scope, nonce: record.nonce, status, counterpart: record.issuer };
}

export type AwaitOptions = {
  read?: MappingRead;
  /** What the status must be before it counts. */
  until: (status: CredentialStatus | null) => boolean;
  attempts?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** After Shield says a move was accepted: the status as the explorer shows it, which can lag by a few blocks. */
export async function awaitCredentialStatus(commitment: string, options: AwaitOptions): Promise<CredentialStatus | null> {
  const read = options.read ?? explorerCredentialRead("credential_status");
  const attempts = options.attempts ?? 15;
  const waitMs = options.waitMs ?? 4_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    const status = await queryCredentialStatus(commitment, read).catch(() => null);
    if (options.until(status)) return status;
    if (i + 1 < attempts) await sleep(waitMs);
  }
  throw new CredentialsError("The network accepted it, but the change isn't showing yet. Check again in a minute.");
}
