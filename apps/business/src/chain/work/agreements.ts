// ---------------------------------------------------------------------------
// The person's agreement records, read from their own Shield account:
// `PendingAgreement` (an offer waiting for them) and `FinalAgreement` (one
// they accepted), parsed the way the old portal parsed them, plus the
// inputs of `accept_job_offer`: the record's plaintext as the wallet gave
// it and an accept-time hash built exactly as the old portal built it
// (BLAKE3("PNW::DOC", TLV(0x6008, u32 epoch seconds)) as a `[u8; 32]`).
//
// Private records never leave the session and nothing here is logged.
// ---------------------------------------------------------------------------

import { tlvEncode } from "@pnw/commitments/canonical_encoder";
import { DOMAIN_TAGS, domainHash } from "@pnw/commitments/hash";
import { PROGRAMS } from "@pnw/config/programs";
import { byteArrayHex } from "../parties_key";

export type AgreementRecord = {
  kind: "pending" | "final";
  /** Hex, no `0x`. */
  agreementId: string;
  /** 64 hex characters. */
  partiesKey: string;
  employerAddress: string;
  workerAddress: string;
  /** Decimal field elements. */
  employerNameHash: string;
  workerNameHash: string;
  /** 64 hex characters: what the terms must hash to. */
  termsDocHash: string;
  /** The record exactly as the wallet gave it: the first input of accept_job_offer. */
  plaintext: string;
};

const ADDRESS = (field: string) => new RegExp(`${field}:\\s*(aleo1[a-z0-9]{58})`);
const FIELD = (field: string) => new RegExp(`${field}:\\s*(\\d+)field`);

/** One record, or null if it isn't an unspent agreement record owned by this person. */
export function parseAgreementRecord(raw: unknown, workerAddress: string): AgreementRecord | null {
  const rec = raw as Record<string, unknown> | null;
  if (!rec || typeof rec !== "object") return null;
  if (rec.spent === true) return null;
  const kind = rec.recordName === "PendingAgreement" ? "pending" : rec.recordName === "FinalAgreement" ? "final" : null;
  if (!kind) return null;
  const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
  const worker = plaintext.match(ADDRESS("worker_address"))?.[1];
  const employer = plaintext.match(ADDRESS("employer_address"))?.[1];
  if (!worker || !employer || worker !== workerAddress) return null;
  const agreementId = byteArrayHex(plaintext, "agreement_id");
  const partiesKey = byteArrayHex(plaintext, "parties_key", 32);
  const termsDocHash = byteArrayHex(plaintext, "terms_doc_hash", 32);
  const employerNameHash = plaintext.match(FIELD("employer_name_hash"))?.[1];
  const workerNameHash = plaintext.match(FIELD("worker_name_hash"))?.[1];
  if (!agreementId || !partiesKey || !termsDocHash || !employerNameHash || !workerNameHash) return null;
  return { kind, agreementId, partiesKey, employerAddress: employer, workerAddress: worker, employerNameHash, workerNameHash, termsDocHash, plaintext };
}

/** Every agreement record this person holds, one per agreement (a final copy wins over a pending one). */
export function parseAgreementRecords(records: unknown[], workerAddress: string): AgreementRecord[] {
  const byId = new Map<string, AgreementRecord>();
  for (const raw of records) {
    const r = parseAgreementRecord(raw, workerAddress);
    if (!r) continue;
    const seen = byId.get(r.agreementId);
    if (!seen || (seen.kind === "pending" && r.kind === "final")) byId.set(r.agreementId, r);
  }
  return [...byId.values()];
}

/** Reads the person's agreement records from Shield. */
export async function readAgreementRecords(requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>, workerAddress: string): Promise<AgreementRecord[]> {
  const records = await requestRecords(PROGRAMS.layer1.employer_agreement, true);
  return parseAgreementRecords(Array.isArray(records) ? records : [], workerAddress);
}

const OBJ_ACCEPT_TIME = 0x6008;

const u32be = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  b[0] = (v >>> 24) & 0xff;
  b[1] = (v >>> 16) & 0xff;
  b[2] = (v >>> 8) & 0xff;
  b[3] = v & 0xff;
  return b;
};

/** `[ 12u8, 255u8, … ]`: a 32-byte array as a transition input. */
export const toU8Array = (bytes: Uint8Array): string => "[ " + Array.from(bytes, (b) => `${b}u8`).join(", ") + " ]";

/** The accept-time hash for `accept_job_offer`, from the acceptance's epoch seconds. */
export function acceptTimeHash(epochSeconds: number): string {
  if (!Number.isInteger(epochSeconds) || epochSeconds < 0 || epochSeconds > 0xffff_ffff) throw new Error("The acceptance time must be a whole number of seconds");
  return toU8Array(domainHash(DOMAIN_TAGS.DOC, tlvEncode(OBJ_ACCEPT_TIME, [{ tag: 0x01, value: u32be(epochSeconds) }])));
}

export const ACCEPT = { program: PROGRAMS.layer1.employer_agreement, function: "accept_job_offer" } as const;

/** The two inputs of `employer_agreement_v4::accept_job_offer`. */
export function acceptInputs(record: Pick<AgreementRecord, "kind" | "plaintext">, epochSeconds: number): string[] {
  if (record.kind !== "pending") throw new Error("Only a pending offer can be accepted");
  return [record.plaintext, acceptTimeHash(epochSeconds)];
}
