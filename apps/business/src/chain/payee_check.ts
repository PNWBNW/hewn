// ---------------------------------------------------------------------------
// Each person's agreement, checked before a pay run asks Shield to pay them.
//
// A person is paid at the account the books hold for them (books/rail.ts
// `payableLinks`). Before a run asks Shield to sign any payment (Pay now,
// Continue, Retry, and the run after Pay again: every press goes through the
// pay panel's one `start`), each person it may ask for is checked against
// their agreement:
//
//   1. The business's own FinalAgreement for the link's agreement id, unspent,
//      read from Shield once per run from every agreement program
//      (agreement_programs.ts), names this account as the employer and the
//      link's account, exactly, as the worker. Every unspent copy for that id
//      must say so.
//   2. The agreement is still active on chain: `agreement_status` under its
//      id, in the program the record came from, reads ACTIVE (1u8 in v4 and
//      in v5). Ending a v4 agreement changes only that mapping (the records
//      stay as they were); v5 sets it on every pause, resume and end, beside
//      `pair_status` under the pair tag, which always holds the same value.
//
// Anyone who doesn't pass is held: the run asks Shield for nobody held
// (@pnw/rail `held`), pays everyone else, and the pay panel says why on that
// person's line (`holdMessage`). A read that fails holds them too: nothing is
// paid on an agreement that couldn't be checked. Program names come from
// @pnw/config through agreement_programs.ts; a status is read through the
// generated decoder of its program. Nothing here logs an address, a record or
// an id.
// ---------------------------------------------------------------------------

import { type RailNetwork, isNotFound, outstanding } from "@pnw/rail";
import { byteWords, packedWords } from "@pnw/records/packed";
import type { RailLink } from "../books/rail";
import { AGREEMENT_PROGRAMS, AGREEMENT_V4, AGREEMENT_V5 } from "./agreement_programs";
import { decodeAgreementRecord } from "./agreement_records";
import { toAgreementStatusMappingValue as v4Status } from "./generated/employer_agreement_v4";
import { toAgreementStatusMappingValue as v5Status } from "./generated/employer_agreement_v5";
import { bareHex } from "./offer";
import type { ReleaseRun } from "./release";

/** Why a person is held: the agreement doesn't name this account and theirs (or none was found), it isn't active, or it couldn't be read. */
export type HoldReason = "mismatch" | "inactive" | "unchecked";

/** What a person is checked by: the account the run would pay and the agreement the link was made under. */
export type Payee = Pick<RailLink, "address" | "agreementId">;

export type PayeeCheckInput = {
  /** Team member id → the link the run pays them by. */
  payees: ReadonlyMap<string, Payee>;
  /** The account paying: the employer every agreement must name. */
  account: string;
  /** Shield's `requestRecords`, called once per agreement program. */
  requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>;
  /** The explorer, for each agreement's status. */
  network: RailNetwork;
};

/** `STATUS_ACTIVE` in employer_agreement_v4 and employer_agreement_v5 alike. */
const ACTIVE = 1;

const statusKey = (program: string, id: string): string => (program === AGREEMENT_V5 ? packedWords(id, 2) : byteWords(id));
const decodeStatus = (program: string, raw: string): number => (program === AGREEMENT_V5 ? v5Status(raw) : v4Status(raw));
const versionOf = (program: string): 4 | 5 | null => (program === AGREEMENT_V5 ? 5 : program === AGREEMENT_V4 ? 4 : null);

type Final = { program: string; employerAddress: string | null; workerAddress: string | null };

/** Every unspent FinalAgreement among the records, by agreement id, with the program it came from. */
function finalsById(byProgram: readonly (readonly [string, readonly unknown[]])[]): Map<string, Final[]> {
  const out = new Map<string, Final[]>();
  for (const [program, records] of byProgram) {
    for (const raw of records) {
      const rec = raw as Record<string, unknown> | null;
      if (!rec || typeof rec !== "object" || rec.spent === true || rec.recordName !== "FinalAgreement") continue;
      const d = decodeAgreementRecord(raw);
      if (!d || d.name !== "FinalAgreement" || d.version !== versionOf(program)) continue;
      const list = out.get(d.agreementId) ?? [];
      list.push({ program, employerAddress: d.employerAddress, workerAddress: d.workerAddress });
      out.set(d.agreementId, list);
    }
  }
  return out;
}

/** The agreement's status on chain: active, not (no entry, or any other status), or unknown (the read failed). */
async function statusOf(network: RailNetwork, program: string, id: string): Promise<"active" | "inactive" | "unchecked"> {
  let raw: unknown;
  try {
    raw = await network.fetchJson(`program/${program}/mapping/agreement_status/${encodeURIComponent(statusKey(program, id))}`);
  } catch (e) {
    return isNotFound(e) ? "inactive" : "unchecked";
  }
  if (raw === null || raw === undefined) return "inactive";
  if (typeof raw !== "string") return "unchecked";
  try {
    return decodeStatus(program, raw) === ACTIVE ? "active" : "inactive";
  } catch {
    return "unchecked";
  }
}

/**
 * Checks each payee against their agreement (see the header) and returns the ones to hold, with why.
 * Never throws: whatever can't be read holds the people it was read for.
 */
export async function checkPayees({ payees, account, requestRecords, network }: PayeeCheckInput): Promise<Map<string, HoldReason>> {
  const held = new Map<string, HoldReason>();
  if (payees.size === 0) return held;
  const byProgram: (readonly [string, unknown[]])[] = [];
  for (const program of AGREEMENT_PROGRAMS) {
    let found: unknown;
    try {
      found = await requestRecords(program, true);
    } catch {
      found = null;
    }
    if (!Array.isArray(found)) {
      for (const workerId of payees.keys()) held.set(workerId, "unchecked");
      return held;
    }
    byProgram.push([program, found]);
  }
  const finals = finalsById(byProgram);
  const reads: Promise<void>[] = [];
  for (const [workerId, link] of payees) {
    const id = bareHex(link.agreementId);
    const copies = finals.get(id) ?? [];
    const program = copies[0]?.program;
    const matches = copies.length > 0 && copies.every((f) => f.program === program && f.employerAddress === account && f.workerAddress === link.address);
    if (!program || !matches) {
      held.set(workerId, "mismatch");
      continue;
    }
    reads.push(
      statusOf(network, program, id).then((status) => {
        if (status !== "active") held.set(workerId, status);
      }),
    );
  }
  await Promise.all(reads);
  return held;
}

/**
 * The people a press of the pay panel may ask Shield to pay, by the link the run pays them by:
 * everyone the run still owes but one whose payment Shield already took (that one is followed, never
 * asked again). Only people with a payable link are here; the queue refuses a run with anyone else.
 */
export function payeesToCheck(run: ReleaseRun, links: ReadonlyMap<string, Payee>): Map<string, Payee> {
  const out = new Map<string, Payee>();
  for (const p of outstanding(run)) {
    if (p.settlement.status === "pending" && p.settlement.reference) continue;
    const link = links.get(p.workerId);
    if (link) out.set(p.workerId, { address: link.address, agreementId: link.agreementId });
  }
  return out;
}

/** What the pay panel says on a held person's line. */
export function holdMessage(name: string, reason: HoldReason): string {
  switch (reason) {
    case "mismatch":
      return `${name}'s agreement doesn't match the address in the books`;
    case "inactive":
      return `${name}'s agreement is no longer active`;
    case "unchecked":
      return `${name}'s agreement couldn't be checked, so they weren't paid; try again in a moment`;
  }
}
