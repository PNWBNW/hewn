// ---------------------------------------------------------------------------
// A client's side of the app (docs/CUSTOMERS.md, decision 17): an account of
// its own, with its own login and portal, that holds only what a customer
// does with the businesses they hire. A person can be a worker and a customer
// as two accounts under one username; never a business with either.
//
// This first step holds only the registered name. Bills, payments and
// conversations with businesses come next. Pure: no React, no storage.
// ---------------------------------------------------------------------------

/** The name businesses find this customer by: the person's own name.hewn, registered or already theirs. */
export type CustomerName = {
  name: string;
  /** The registry's hash of the name, as a decimal field without the suffix. */
  nameHash: string;
  registeredAt: string;
};

export type CustomerSide = {
  version: 1;
  name?: CustomerName;
};

export const emptyCustomer = (): CustomerSide => ({ version: 1 });

const NAME = /^[a-z0-9_]{1,32}$/;
const FIELD = /^\d{1,78}$/;

/** Checks a customer section read from the vault; throws on anything that isn't one. */
export function validateCustomer(raw: unknown): CustomerSide {
  if (!raw || typeof raw !== "object") throw new Error("The customer section is damaged");
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error("This customer section is from a newer version");
  const out: CustomerSide = { version: 1 };
  if (r.name !== undefined) {
    const n = r.name as Record<string, unknown> | null;
    if (!n || typeof n.name !== "string" || !NAME.test(n.name) || typeof n.nameHash !== "string" || !FIELD.test(n.nameHash) || typeof n.registeredAt !== "string" || Number.isNaN(Date.parse(n.registeredAt))) {
      throw new Error("The customer's name is damaged");
    }
    out.name = { name: n.name, nameHash: n.nameHash, registeredAt: n.registeredAt };
  }
  return out;
}

/** The customer side with its name set (once, from setup). */
export function setCustomerName(side: CustomerSide, name: CustomerName): CustomerSide {
  return validateCustomer({ ...side, name });
}
