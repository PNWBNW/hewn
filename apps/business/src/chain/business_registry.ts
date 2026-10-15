// ---------------------------------------------------------------------------
// A business's registered name, and what it takes to get one. Encoded exactly
// as the deployed program reads it (pnw_mvp_v2 `pnw_name_registrar_v5`,
// edition 1, live since 2026-10-15):
//
//   pnw_name_registrar_v5::register_employer_free(<hash>field, <name as u128>u128, <industry>u8)
//
// Free, and no approval: anyone can register. What still must hold on chain:
// the name is free, and the account holds no other name (one name per
// account, either a worker's or a business's, never both). The older
// `register_employer_name` (1 USDCx and the license registry's approval)
// stays on chain, unused.
//
// Pure apart from the injected reads: no network, no React, no storage.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import { INDUSTRY_SUFFIXES, computeNameHash, queryEmployerName, queryNameOwner, queryWorkerName } from "@pnw/records/registry/name_registry";
import { NAME_PATTERN, NAME_RULE, nameToU128 } from "./work/registry";

export { NAME_PATTERN, NAME_RULE };

export const REGISTER_BUSINESS = { program: PROGRAMS.layer1.pnw_name_registrar, function: "register_employer_free" } as const;

/** Industry codes the registrar accepts (1 to 40), for the picker. */
export const INDUSTRIES = Object.entries(INDUSTRY_SUFFIXES).map(([code, { label }]) => ({ code: Number(code), label }));

/** The three inputs of `register_employer_free`, with the hash the registry will hold. */
export function registerBusinessInputs(name: string, industryCode: number): { nameHash: string; inputs: string[] } {
  if (!NAME_PATTERN.test(name)) throw new Error(`A name is ${NAME_RULE}`);
  if (!Number.isInteger(industryCode) || industryCode < 1 || industryCode > 40) throw new Error("Choose an industry");
  const nameHash = computeNameHash(name);
  return { nameHash, inputs: [`${nameHash}field`, `${nameToU128(name)}u128`, `${industryCode}u8`] };
}

// ---- Where an account stands ---------------------------------------------------------------

export type RegistryReads = {
  nameOwner: (nameHash: string) => Promise<string | null>;
  workerName: (address: string) => Promise<string | null>;
  employerName: (address: string) => Promise<string | null>;
};

export const registryReads: RegistryReads = {
  nameOwner: queryNameOwner,
  workerName: queryWorkerName,
  employerName: queryEmployerName,
};

export type AccountStatus =
  /** The account already holds a business name; keep it. */
  | { kind: "has-name"; nameHash: string }
  /** The account holds a worker's name, and an account holds only one name. */
  | { kind: "worker-name" }
  /** Free to register a name. */
  | { kind: "ready" };

const bare = (field: string) => field.replace(/field$/, "").trim();

/** Reads the registry for one account. Throws if a read fails (the caller shows it and may retry). */
export async function accountStatus(address: string, reads: RegistryReads = registryReads): Promise<AccountStatus> {
  const employer = await reads.employerName(address);
  if (employer) return { kind: "has-name", nameHash: bare(employer) };
  if (await reads.workerName(address)) return { kind: "worker-name" };
  return { kind: "ready" };
}

export type Availability = { kind: "available" } | { kind: "taken" };

/** Whether a name is free to take. A name this account already owns counts as taken: it holds one, and `accountStatus` says so. */
export async function checkName(name: string, reads: Pick<RegistryReads, "nameOwner"> = registryReads): Promise<Availability & { nameHash: string }> {
  if (!NAME_PATTERN.test(name)) throw new Error(`A name is ${NAME_RULE}`);
  const nameHash = computeNameHash(name);
  return { kind: (await reads.nameOwner(nameHash)) ? "taken" : "available", nameHash };
}
