// The agreement's `parties_key`, read from the employer's own agreement
// records in Shield. `scanAgreementRecords` (@pnw/records) surfaces the
// worker list but not the key, which the paystub delivery needs; this reads
// the same records once more for just that field, keyed by agreement id, so
// the link saved at import carries it. Private records never leave the
// session and nothing here is logged.

import { PROGRAMS } from "@pnw/config/programs";

const BYTES32 = (field: string) => new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`);

/**
 * A `[u8; N]` record field as lower-case hex, or null if absent (or not
 * `length` bytes when one is given). The agreement id is read the way
 * `scanAgreementRecords` reads it, whatever its length, so the two match.
 */
export function byteArrayHex(plaintext: string, field: string, length?: number): string | null {
  const section = plaintext.match(BYTES32(field));
  if (!section?.[1]) return null;
  const bytes = section[1].match(/\d+u8/g);
  if (!bytes || bytes.length === 0 || (length !== undefined && bytes.length !== length)) return null;
  if (bytes.some((b) => parseInt(b, 10) > 255)) return null;
  return bytes.map((b) => parseInt(b, 10).toString(16).padStart(2, "0")).join("");
}

/** agreement id (hex) → parties key (64 hex) for every unspent agreement record, pending or final. */
export function partiesKeysOf(records: unknown[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const raw of records) {
    const rec = raw as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    if (rec.spent === true) continue;
    if (rec.recordName !== "FinalAgreement" && rec.recordName !== "PendingAgreement") continue;
    const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
    const agreementId = byteArrayHex(plaintext, "agreement_id");
    const partiesKey = byteArrayHex(plaintext, "parties_key", 32);
    if (agreementId && partiesKey && !keys.has(agreementId)) keys.set(agreementId, partiesKey);
  }
  return keys;
}

/** Reads the employer's agreement records from the wallet and returns their parties keys by agreement id. */
export async function readPartiesKeys(requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>): Promise<Map<string, string>> {
  const records = await requestRecords(PROGRAMS.layer1.employer_agreement, true);
  return partiesKeysOf(Array.isArray(records) ? records : []);
}
