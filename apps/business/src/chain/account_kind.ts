// ---------------------------------------------------------------------------
// One kind of account per Shield account (Joshua, 2026-10-15): a wallet that
// holds a business's books can't also hold a person's, and the other way
// round. Money in one wallet is one pot; a business's books and a person's pay
// sharing it would mix business and personal money. A person's two accounts,
// a worker and a customer, are both personal money: they may share a Shield
// account and its name (2026-10-26, docs/CUSTOMERS.md). A business runs its
// own Shield account and its own username.
//
// The registry is where a wallet's kind shows: every account registers a
// name, and the registry keeps a business's and a worker's primary name in
// separate mappings. This reads the other kind's mapping before a wallet is
// linked or a name registered. It refuses when it can't tell (the registry
// unreachable), so the rule can't be skipped by being offline.
//
// The registry itself doesn't enforce this yet; the mainnet registrar will.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";
import type { Role } from "@/books/work";

/** A registry mapping entry for an account: the name hash, or null when there is none. Throws when the registry can't be read. */
export type MappingRead = (mapping: string, address: string) => Promise<string | null>;

export class AccountKindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountKindError";
  }
}

/** Reads `<mapping>[address]` from the name registry; a 404 or `0field` is "none", anything else that fails throws. */
export function registryRead(endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): MappingRead {
  const base = endpoint.replace(/\/+$/, "");
  return async (mapping, address) => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/program/${PROGRAMS.layer1.pnw_name_registry}/mapping/${mapping}/${address}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AccountKindError("Couldn't reach the registry to check this account. Check your connection and try again.");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new AccountKindError(`Couldn't check this account on the registry (it answered ${res.status}). Try again.`);
    const data: unknown = await res.json();
    if (data === null) return null;
    if (typeof data !== "string") throw new AccountKindError("The registry sent something unexpected. Try again.");
    const cleaned = data.replace(/\.(private|public)$/, "").trim();
    return cleaned === "0field" || cleaned === "0" ? null : cleaned;
  };
}

// A customer's name is a person's name on the registry, like a worker's: the chain doesn't say which.
const OTHER: Record<Role, { mapping: string; kind: string }> = {
  business: { mapping: "worker_primary_name_of", kind: "a person's" },
  worker: { mapping: "employer_primary_name_of", kind: "a business's" },
  customer: { mapping: "employer_primary_name_of", kind: "a business's" },
};

const FOR: Record<Role, string> = { business: "your business", worker: "your work as a worker", customer: "your account as a customer" };

/** Why this wallet can't hold a `role` account (it already holds the other kind), or null when it can. Throws when the registry can't be read. */
export async function kindConflict(role: Role, address: string, read: MappingRead = registryRead()): Promise<string | null> {
  const other = OTHER[role];
  if (!(await read(other.mapping, address))) return null;
  return (
    `This Shield account already holds ${other.kind} name, and one Shield account holds one kind of account. ` +
    `Add another account in Shield (or use another wallet) for ${FOR[role]}, and link that one.`
  );
}

/** Throws the reason when this wallet already holds the other kind of account. */
export async function assertKindFree(role: Role, address: string, read?: MappingRead): Promise<void> {
  const conflict = await kindConflict(role, address, read);
  if (conflict) throw new AccountKindError(conflict);
}
