// The agreement's `parties_key`, read from the employer's own agreement
// records in Shield. `scanAgreementRecords` (@pnw/records) surfaces the
// worker list but not the key, which the paystub delivery needs; this reads
// the same records once more for just that field, keyed by agreement id, so
// the link saved at import carries it. Private records never leave the
// session and nothing here is logged.

import { arrayFieldHex } from "@pnw/records/packed";
import { AGREEMENT_PROGRAMS } from "./agreement_programs";

/**
 * A record's array field as lower-case hex: v4's `[u8; N]` bytes or v5's packed `u128` words
 * (@pnw/records `packed`), or null if absent (or not `length` bytes when one is given). The
 * agreement id is read the way `scanAgreementRecords` reads it, so the two match.
 */
export const byteArrayHex = (plaintext: string, field: string, length?: number): string | null => arrayFieldHex(plaintext, field, length);

/** agreement id (hex) → parties key (64 hex) for every unspent agreement record, pending or final. */
export function partiesKeysOf(records: unknown[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const raw of records) {
    const rec = raw as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    if (rec.spent === true) continue;
    // v5's SentOffer is the employer's copy of a pending offer (chain/agreement_programs.ts).
    if (rec.recordName !== "FinalAgreement" && rec.recordName !== "PendingAgreement" && rec.recordName !== "SentOffer") continue;
    const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
    const agreementId = byteArrayHex(plaintext, "agreement_id");
    const partiesKey = byteArrayHex(plaintext, "parties_key", 32);
    if (agreementId && partiesKey && !keys.has(agreementId)) keys.set(agreementId, partiesKey);
  }
  return keys;
}

/** Reads the employer's agreement records from every agreement program and returns their parties keys by agreement id (a newer program's record wins). */
export async function readPartiesKeys(requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>, programs: readonly string[] = AGREEMENT_PROGRAMS): Promise<Map<string, string>> {
  const records: unknown[] = [];
  for (const program of programs) {
    const found = await requestRecords(program, true);
    if (Array.isArray(found)) records.push(...found);
  }
  return partiesKeysOf(records);
}
