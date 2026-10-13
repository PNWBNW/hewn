// Sales ⇄ JSON text for the vault. Amounts are written as {"$c":"12345"} (cents).
// Files saved before estimates existed open with an empty list.
import type { Sales } from "./sales";

const FORMAT = "pnw-sales";

export function salesToJson(sales: Sales): string {
  return JSON.stringify({ format: FORMAT, sales }, (_k, v) => (typeof v === "bigint" ? { $c: v.toString() } : v));
}

export function salesFromJson(text: string): Sales {
  const doc = JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$c === "string" && /^-?\d+$/.test(v.$c)
      ? BigInt(v.$c)
      : v,
  ) as { format?: string; sales?: Sales };
  if (doc?.format !== FORMAT || doc.sales?.version !== 1) throw new Error("Not sales data from this app, or a newer version");
  const { estimates = [], nextEstimate = 1, ...rest } = doc.sales as Partial<Sales> & Sales;
  return { ...rest, estimates, nextEstimate };
}
