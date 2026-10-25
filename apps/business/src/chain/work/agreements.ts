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
import { packedWords } from "@pnw/records/packed";
import { AGREEMENT_PROGRAMS, AGREEMENT_V4, carriesHalves, halfOf, halfToInput } from "../agreement_programs";
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
  /** The program the record came from (chain/agreement_programs.ts). */
  program: string;
  /** v5: the employer's public half from the offer, and the worker's once accepted (`04` + x + y, hex). */
  employerHalf?: string;
  workerHalf?: string;
};

const ADDRESS = (field: string) => new RegExp(`${field}:\\s*(aleo1[a-z0-9]{58})`);
const FIELD = (field: string) => new RegExp(`${field}:\\s*(\\d+)field`);

/** One record, or null if it isn't an unspent agreement record owned by this person. */
export function parseAgreementRecord(raw: unknown, workerAddress: string, program: string = AGREEMENT_V4): AgreementRecord | null {
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
  const record: AgreementRecord = { kind, agreementId, partiesKey, employerAddress: employer, workerAddress: worker, employerNameHash, workerNameHash, termsDocHash, plaintext, program };
  if (carriesHalves(program)) {
    const employerHalf = halfOf(plaintext, "employer_half");
    const workerHalf = halfOf(plaintext, "worker_half");
    if (employerHalf) record.employerHalf = employerHalf;
    if (workerHalf) record.workerHalf = workerHalf;
  }
  return record;
}

/** Every agreement record this person holds, one per agreement (a final copy wins over a pending one). */
export function parseAgreementRecords(records: unknown[], workerAddress: string, program: string = AGREEMENT_V4): AgreementRecord[] {
  const byId = new Map<string, AgreementRecord>();
  for (const raw of records) {
    const r = parseAgreementRecord(raw, workerAddress, program);
    if (!r) continue;
    const seen = byId.get(r.agreementId);
    if (!seen || (seen.kind === "pending" && r.kind === "final")) byId.set(r.agreementId, r);
  }
  return [...byId.values()];
}

/** Reads the person's agreement records from Shield, from every agreement program the app uses (an id found in a newer one wins). */
export async function readAgreementRecords(
  requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>,
  workerAddress: string,
  programs: readonly string[] = AGREEMENT_PROGRAMS,
): Promise<AgreementRecord[]> {
  const byId = new Map<string, AgreementRecord>();
  for (const program of programs) {
    const records = await requestRecords(program, true);
    for (const r of parseAgreementRecords(Array.isArray(records) ? records : [], workerAddress, program)) if (!byId.has(r.agreementId)) byId.set(r.agreementId, r);
  }
  return [...byId.values()];
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

/** The accept-time digest, from the acceptance's epoch seconds. */
function acceptTimeDigest(epochSeconds: number): Uint8Array {
  if (!Number.isInteger(epochSeconds) || epochSeconds < 0 || epochSeconds > 0xffff_ffff) throw new Error("The acceptance time must be a whole number of seconds");
  return domainHash(DOMAIN_TAGS.DOC, tlvEncode(OBJ_ACCEPT_TIME, [{ tag: 0x01, value: u32be(epochSeconds) }]));
}

/** The accept-time hash for v4's `accept_job_offer`, as `[u8; 32]`. */
export const acceptTimeHash = (epochSeconds: number): string => toU8Array(acceptTimeDigest(epochSeconds));

/** The same hash as v5's `accept_offer` takes it: two packed u128 words. */
export const acceptTimeHashPacked = (epochSeconds: number): string =>
  packedWords(Array.from(acceptTimeDigest(epochSeconds), (b) => b.toString(16).padStart(2, "0")).join(""), 2);

export const ACCEPT = { program: AGREEMENT_V4, function: "accept_job_offer" } as const;

/** The two inputs of `employer_agreement_v4::accept_job_offer`. */
export function acceptInputs(record: Pick<AgreementRecord, "kind" | "plaintext">, epochSeconds: number): string[] {
  if (record.kind !== "pending") throw new Error("Only a pending offer can be accepted");
  return [record.plaintext, acceptTimeHash(epochSeconds)];
}

/**
 * The acceptance for whichever program the offer came from: v4's two inputs, or v5's three (the
 * record, the accept-time hash packed, and this person's public half, `04` + x + y, which the
 * record then carries to the employer).
 */
export function acceptCall(record: Pick<AgreementRecord, "kind" | "plaintext" | "program">, epochSeconds: number, half?: string): { program: string; function: string; inputs: string[] } {
  if (!carriesHalves(record.program)) return { ...ACCEPT, inputs: acceptInputs(record, epochSeconds) };
  if (!half) throw new Error("Accepting this offer needs a key half");
  if (record.kind !== "pending") throw new Error("Only a pending offer can be accepted");
  return { program: record.program, function: "accept_offer", inputs: [record.plaintext, acceptTimeHashPacked(epochSeconds), halfToInput(half)] };
}
