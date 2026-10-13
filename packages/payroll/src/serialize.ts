// Payroll ⇄ JSON text for the vault. Amounts are written as {"$c":"12345"} (cents).
import type { Payroll } from "./payroll";

const FORMAT = "pnw-payroll";

export function payrollToJson(payroll: Payroll): string {
  return JSON.stringify({ format: FORMAT, payroll }, (_k, v) => (typeof v === "bigint" ? { $c: v.toString() } : v));
}

export function payrollFromJson(text: string): Payroll {
  const doc = JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$c === "string" && /^-?\d+$/.test(v.$c)
      ? BigInt(v.$c)
      : v,
  ) as { format?: string; payroll?: Payroll };
  if (doc?.format !== FORMAT || doc.payroll?.version !== 1) throw new Error("Not payroll data from this app, or a newer version");
  return doc.payroll;
}
