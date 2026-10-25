// ---------------------------------------------------------------------------
// A business's side of its connections with customers (books/connections.ts):
// which customer record a connection belongs to, and adding the customer
// when one asks first. Pure.
// ---------------------------------------------------------------------------

import { addCustomer } from "@pnw/sales";
import type { Company } from "./company";
import { type Connection, type Connections, linkCustomer } from "./connections";
import { setRegistered } from "./rail";

/** The customer whose registered account is `address`, if the business has one. */
export function customerAt(company: Pick<Company, "rail" | "sales">, address: string): string | undefined {
  const link = company.rail?.partyLinks?.find((p) => p.kind === "customer" && p.address === address);
  return link && company.sales.customers.some((c) => c.id === link.id) ? link.id : undefined;
}

/** Each connection tied to its customer record where one matches its account (a customer added by name before they said hello). */
export function linkKnownCustomers(company: Company, conns: Connections): Connections {
  let next = conns;
  for (const c of Object.values(conns)) {
    if (c.customerId) continue;
    const id = customerAt(company, c.address);
    if (id) next = linkCustomer(next, c.address, id);
  }
  return next;
}

/**
 * A customer who asked first, added to the books under their registered name (the business can
 * rename them), with their account recorded and the connection tied to them. Returns the id.
 */
export function addAskingCustomer(company: Company, conn: Pick<Connection, "address" | "name" | "nameHash">): { company: Company; customerId: string } {
  const existing = customerAt(company, conn.address);
  if (existing) return { company: { ...company, clients: linkCustomer(company.clients ?? {}, conn.address, existing) }, customerId: existing };
  if (!company.rail) throw new Error("Link Shield first");
  const added = addCustomer(company.sales, { name: conn.name });
  const rail = setRegistered(company.rail, "customer", added.customer.id, { address: conn.address, nameHash: conn.nameHash, name: conn.name });
  const clients = company.clients?.[conn.address] ? linkCustomer(company.clients, conn.address, added.customer.id) : company.clients;
  return { company: { ...company, sales: added.sales, rail, ...(clients ? { clients } : {}) }, customerId: added.customer.id };
}
