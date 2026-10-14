// ---------------------------------------------------------------------------
// A business's registered name, and what it takes to get one. Encoded exactly
// as the deployed programs read it (pnw_mvp_v2 `pnw_name_registrar_v5`):
//
//   pnw_name_registrar_v5::register_employer_name(<hash>field, <name as u128>u128, <industry>u8)
//
// Three things must hold on chain, or the transaction is rejected:
//   1. The account is approved in `employer_license_registry` (`is_verified`).
//      Only the registry's authority can approve an account (`set_verified`);
//      no licence number is checked on chain, only a commitment is stored.
//   2. The account has 1 USDCx in its PUBLIC balance (the registrar takes it
//      with `transfer_public_as_signer`) and a little ALEO for the fee.
//   3. The name is free, and the account holds no other name: one name per
//      account, either a worker's or a business's, never both.
// The same approval and name are what `create_job_offer` later asserts, so a
// business that cannot register cannot send offers either.
//
// Pure apart from the injected reads: no network, no React, no storage.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import {
  INDUSTRY_SUFFIXES,
  computeNameHash,
  queryEmployerName,
  queryEmployerVerified,
  queryNameOwner,
  queryWorkerName,
} from "@pnw/records/registry/name_registry";
import { NAME_PATTERN, NAME_RULE, nameToU128 } from "./work/registry";

export { NAME_PATTERN, NAME_RULE };

export const REGISTER_BUSINESS = { program: PROGRAMS.layer1.pnw_name_registrar, function: "register_employer_name" } as const;
export const APPROVE_BUSINESS = { program: PROGRAMS.layer1.employer_license_registry, function: "set_verified" } as const;

/**
 * The only account that may approve others: `AUTHORITY` in
 * pnw_mvp_v2/src/layer1/employer_license_registry.aleo (an immutable
 * program). The chain enforces it; the app only uses it to decide whether to
 * offer the approval screen.
 */
export const REGISTRY_AUTHORITY = "aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd";

/**
 * What `set_verified` stores beside the flag. No licence evidence is
 * collected, so this is a fixed placeholder, never a hash of anything private.
 */
export const APPROVAL_COMMITMENT = "1field";

export const isRegistryAuthority = (address: string | null | undefined): boolean => address === REGISTRY_AUTHORITY;

/** Industry codes the registrar accepts (1 to 40), for the picker. */
export const INDUSTRIES = Object.entries(INDUSTRY_SUFFIXES).map(([code, { label }]) => ({ code: Number(code), label }));

/** The three inputs of `register_employer_name`, with the hash the registry will hold. */
export function registerBusinessInputs(name: string, industryCode: number): { nameHash: string; inputs: string[] } {
  if (!NAME_PATTERN.test(name)) throw new Error(`A name is ${NAME_RULE}`);
  if (!Number.isInteger(industryCode) || industryCode < 1 || industryCode > 40) throw new Error("Choose an industry");
  const nameHash = computeNameHash(name);
  return { nameHash, inputs: [`${nameHash}field`, `${nameToU128(name)}u128`, `${industryCode}u8`] };
}

/** The three inputs of `set_verified`. Only the registry's authority can send it. */
export function approveInputs(address: string, verified: boolean): string[] {
  if (!/^aleo1[a-z0-9]{58}$/.test(address)) throw new Error("That account isn't complete: 63 characters starting aleo1");
  return [address, APPROVAL_COMMITMENT, String(verified)];
}

// ---- Where an account stands ---------------------------------------------------------------

export type RegistryReads = {
  nameOwner: (nameHash: string) => Promise<string | null>;
  workerName: (address: string) => Promise<string | null>;
  employerName: (address: string) => Promise<string | null>;
  verified: (address: string) => Promise<boolean>;
};

export const registryReads: RegistryReads = {
  nameOwner: queryNameOwner,
  workerName: queryWorkerName,
  employerName: queryEmployerName,
  verified: queryEmployerVerified,
};

export type AccountStatus =
  /** The account already holds a business name; keep it. */
  | { kind: "has-name"; nameHash: string }
  /** The account holds a worker's name, and an account holds only one name. */
  | { kind: "worker-name" }
  /** No name yet, and the registry's authority hasn't approved the account. */
  | { kind: "needs-approval" }
  /** Free to register a name. */
  | { kind: "ready" };

const bare = (field: string) => field.replace(/field$/, "").trim();

/** Reads the registry for one account. Throws if a read fails (the caller shows it and may retry). */
export async function accountStatus(address: string, reads: RegistryReads = registryReads): Promise<AccountStatus> {
  const employer = await reads.employerName(address);
  if (employer) return { kind: "has-name", nameHash: bare(employer) };
  if (await reads.workerName(address)) return { kind: "worker-name" };
  return (await reads.verified(address)) ? { kind: "ready" } : { kind: "needs-approval" };
}

export type Availability = { kind: "available" } | { kind: "taken" };

/** Whether a name is free to take. A name this account already owns counts as taken: it holds one, and `accountStatus` says so. */
export async function checkName(name: string, reads: Pick<RegistryReads, "nameOwner"> = registryReads): Promise<Availability & { nameHash: string }> {
  if (!NAME_PATTERN.test(name)) throw new Error(`A name is ${NAME_RULE}`);
  const nameHash = computeNameHash(name);
  return { kind: (await reads.nameOwner(nameHash)) ? "taken" : "available", nameHash };
}
