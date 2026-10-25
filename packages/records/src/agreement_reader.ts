/**
 * Agreement Record Reader
 *
 * Surfaces the active worker list by scanning on-chain agreement records
 * owned by the employer's wallet.
 *
 * The only path is the wallet adapter's requestRecords() → parse FinalAgreement
 * and PendingAgreement records → return WorkerRecords. (The old localStorage
 * fallback is gone: a package never reads browser storage, and localStorage is
 * not a book of record.)
 */

import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import type { Address, Bytes32 } from "@pnw/commitments/aleo_types";
import type { WorkerRecord } from "./types/worker";
import { queryWorkerName, queryNamePlaintext } from "./registry/name_registry";
import { arrayFieldHex, byteWords, packedWords } from "./packed";

/** Agreement status from on-chain state. `withdrawn` is v5's own status for an offer taken back before acceptance. */
export type AgreementStatus = "active" | "paused" | "terminated" | "withdrawn";

// v4: 0 pending, 1 active, 2 paused, 3 terminated (4 superseded is left unmapped).
// v5: 0 pending, 1 active, 2 paused, 3 ended, 4 withdrawn.
const STATUS_MAP: Record<string, AgreementStatus> = {
  "0u8": "active",   // PENDING maps to active for display (offer sent)
  "1u8": "active",   // ACTIVE
  "2u8": "paused",   // PAUSED
  "3u8": "terminated", // TERMINATED (v4) / ENDED (v5)
};
const STATUS_MAP_V5: Record<string, AgreementStatus> = { ...STATUS_MAP, "4u8": "withdrawn" };

/** The agreement id as the program's mapping key: v5 packs it as two u128 words, v4 as 32 bytes. */
function statusKey(agreementIdHex: string, programId: string): string {
  return programId === PROGRAMS.layer1.employer_agreement_v5 ? packedWords(agreementIdHex, 2) : byteWords(agreementIdHex);
}

/**
 * Parse a FinalAgreement or PendingAgreement record plaintext into a WorkerRecord.
 * Returns null if the record doesn't match or is spent.
 */
function parseAgreementRecord(
  record: Record<string, unknown>,
  employerAddress: Address,
): WorkerRecord | null {
  try {
    const plaintext = typeof record.recordPlaintext === "string" ? record.recordPlaintext : null;
    const recordName = typeof record.recordName === "string" ? record.recordName : null;
    const spent = typeof record.spent === "boolean" ? record.spent : false;

    if (!plaintext) return null;
    if (spent) return null;

    // Accept FinalAgreement (accepted), PendingAgreement (sent, awaiting acceptance) and, from
    // employer_agreement_v5, SentOffer (the employer's own copy of a pending offer).
    const isFinal = recordName === "FinalAgreement";
    const isPending = recordName === "PendingAgreement" || recordName === "SentOffer";
    if (!isFinal && !isPending) return null;

    // Parse fields from the record plaintext
    const workerAddrMatch = plaintext.match(/worker_address:\s*(aleo1[a-z0-9]+)/);
    const empAddrMatch = plaintext.match(/employer_address:\s*(aleo1[a-z0-9]+)/);
    const wrkHashMatch = plaintext.match(/worker_name_hash:\s*(\d+)field/);

    // For employer-owned records, verify this is their agreement
    if (empAddrMatch?.[1] && empAddrMatch[1] !== employerAddress) return null;

    // Must have a worker address
    if (!workerAddrMatch?.[1]) return null;

    // The agreement id as hex: 32 bytes in v4's records, two packed u128 words in v5's.
    const agreementId = arrayFieldHex(plaintext, "agreement_id") ?? "";
    if (!agreementId) return null;

    // Determine status: FinalAgreement = active, PendingAgreement = active (pending acceptance)
    const status: AgreementStatus = "active";

    return {
      worker_addr: workerAddrMatch[1],
      worker_name_hash: wrkHashMatch?.[1] ?? "",
      agreement_id: agreementId,
      status,
      display_name: undefined, // Will be resolved by reverse name lookup
    };
  } catch {
    return null;
  }
}

/**
 * Scan wallet for agreement records using the wallet adapter.
 * This is the primary method — reads actual on-chain records owned by the employer.
 *
 * @param requestRecords - Wallet adapter's requestRecords function
 * @param employerAddress - Employer's Aleo address
 * @returns Array of worker records from on-chain agreement records
 */
export async function scanAgreementRecords(
  requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>,
  employerAddress: Address,
  /** Every agreement program to read, newest first; the first record found for an agreement wins. */
  programs: readonly string[] = [PROGRAMS.layer1.employer_agreement],
): Promise<WorkerRecord[]> {
  try {
    console.log("[PNW] Scanning wallet for agreement records...");
    const records: unknown[] = [];
    for (const program of programs) {
      const found = await requestRecords(program, true);
      if (Array.isArray(found)) records.push(...found);
    }
    console.log("[PNW] Agreement records from wallet:", records.length);

    const workers: WorkerRecord[] = [];
    const seenAgreements = new Set<string>();

    for (const rec of records) {
      const worker = parseAgreementRecord(rec as Record<string, unknown>, employerAddress);
      if (worker && !seenAgreements.has(worker.agreement_id)) {
        seenAgreements.add(worker.agreement_id);
        workers.push(worker);
      }
    }

    console.log("[PNW] Parsed worker records:", workers.length);

    // Resolve registered names, all at once; each lookup is best-effort.
    // display_name is the bare registered name (the suffix shown next to it
    // is the app's choice), or undefined when the worker has none.
    await Promise.allSettled(
      workers.map(async (worker) => {
        const nameHash = await queryWorkerName(worker.worker_addr);
        if (!nameHash) return;
        const cleanHash = nameHash.replace(/field$/, "").trim();
        if (!worker.worker_name_hash) worker.worker_name_hash = cleanHash;
        const plaintext = await queryNamePlaintext(cleanHash);
        if (plaintext) worker.display_name = plaintext;
      }),
    );

    return workers;
  } catch (error) {
    console.warn("[PNW] Wallet record scan failed:", error);
    return [];
  }
}

/**
 * Query a single agreement's status from on-chain mapping.
 */
async function queryAgreementStatusInternal(
  agreementIdHex: string,
  programId: string,
): Promise<AgreementStatus | null> {
  const endpoint = ENV.ALEO_ENDPOINT;

  try {
    const key = statusKey(agreementIdHex, programId);
    const url = `${endpoint}/program/${programId}/mapping/agreement_status/${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = await response.text();
    const clean = data.replace(/"/g, "").trim();
    return (programId === PROGRAMS.layer1.employer_agreement_v5 ? STATUS_MAP_V5 : STATUS_MAP)[clean] ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh a single agreement's status from chain.
 */
export async function checkAgreementStatus(
  agreementId: Bytes32,
  programId: string = PROGRAMS.layer1.employer_agreement,
): Promise<AgreementStatus | null> {
  return queryAgreementStatusInternal(agreementId, programId);
}

// ---------------------------------------------------------------------------
// Credential auth material lookup
// ---------------------------------------------------------------------------

/**
 * Authorization material extracted from an employer's FinalAgreement
 * record, passed to credential_nft_v3::mint_credential_nft to prove
 * the caller is authorized to issue credentials for a specific worker.
 */
export type CredentialAuthMaterial = {
  agreement_id: Bytes32;        // hex, "0x..." prefixed
  parties_key: Bytes32;         // hex, "0x..." prefixed
  employer_name_hash: string;   // decimal field element
  worker_name_hash: string;     // decimal field element
};

/**
 * Scan the connected employer's wallet for a FinalAgreement record
 * whose `worker_address` matches the given worker, and return the
 * four credential_nft_v3 authorization fields.
 *
 * Returns null if no matching active agreement is found.
 *
 * @param requestRecords - Wallet adapter's requestRecords function
 * @param employerAddress - Connected employer wallet
 * @param targetWorkerAddress - Worker the credential is being issued to
 */
export async function fetchCredentialAuthForWorker(
  requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>,
  employerAddress: Address,
  targetWorkerAddress: Address,
): Promise<CredentialAuthMaterial | null> {
  try {
    const records = await requestRecords(
      PROGRAMS.layer1.employer_agreement,
      true,
    );
    if (!Array.isArray(records)) return null;

    for (const raw of records) {
      const rec = raw as Record<string, unknown>;
      const plaintext =
        typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : null;
      const recordName =
        typeof rec.recordName === "string" ? rec.recordName : null;
      const spent = typeof rec.spent === "boolean" ? rec.spent : false;

      if (!plaintext) continue;
      if (spent) continue;
      // Only accept FinalAgreement records for issuing credentials —
      // PendingAgreement is pre-acceptance and not authorized.
      if (recordName !== "FinalAgreement") continue;

      // Match this record to the target worker
      const workerAddrMatch = plaintext.match(
        /worker_address:\s*(aleo1[a-z0-9]+)/,
      );
      if (!workerAddrMatch?.[1]) continue;
      if (workerAddrMatch[1] !== targetWorkerAddress) continue;

      // Confirm the record is owned by the expected employer
      const empAddrMatch = plaintext.match(
        /employer_address:\s*(aleo1[a-z0-9]+)/,
      );
      if (!empAddrMatch?.[1] || empAddrMatch[1] !== employerAddress) continue;

      // Extract agreement_id as hex
      const agreementIdHex = extractByteArrayHex(plaintext, "agreement_id");
      const partiesKeyHex = extractByteArrayHex(plaintext, "parties_key");
      if (!agreementIdHex || !partiesKeyHex) continue;

      // Extract the two name hashes (decimal field elements)
      const empHashMatch = plaintext.match(
        /employer_name_hash:\s*(\d+)field/,
      );
      const wrkHashMatch = plaintext.match(
        /worker_name_hash:\s*(\d+)field/,
      );
      if (!empHashMatch?.[1] || !wrkHashMatch?.[1]) continue;

      return {
        agreement_id: ("0x" + agreementIdHex) as Bytes32,
        parties_key: ("0x" + partiesKeyHex) as Bytes32,
        employer_name_hash: empHashMatch[1],
        worker_name_hash: wrkHashMatch[1],
      };
    }

    return null;
  } catch (error) {
    console.warn("[PNW] fetchCredentialAuthForWorker failed:", error);
    return null;
  }
}

/**
 * Helper — pull a 32-byte array field (v4's `[u8; 32]`, or v5's two packed
 * u128 words) out of a record plaintext as a 64-char hex string (no prefix).
 */
function extractByteArrayHex(plaintext: string, fieldName: string): string | null {
  return arrayFieldHex(plaintext, fieldName);
}
