// Payroll ⇄ JSON text for the vault. Amounts are written as {"$c":"12345"} (cents);
// a settlement's network fee, which is in microcredits rather than cents, is
// written as a plain decimal string. Runs saved before settlement existed were
// all paid outside the app, so they load as external and settled (no
// reference, no paystub hash).
import type { PayRun, Payroll } from "./payroll";

const FORMAT = "pnw-payroll";

const FEE_KEY = "feeMicrocredits";

export function payrollToJson(payroll: Payroll): string {
  return JSON.stringify({ format: FORMAT, payroll }, (k, v) => (typeof v === "bigint" ? (k === FEE_KEY ? v.toString() : { $c: v.toString() }) : v));
}

function upgradeRun(run: PayRun): PayRun {
  return {
    ...run,
    mode: run.mode ?? "external",
    paychecks: run.paychecks.map((p) => (p.settlement ? p : { ...p, settlement: { status: "settled" } })),
  };
}

export function payrollFromJson(text: string): Payroll {
  const doc = JSON.parse(text, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$c === "string" && /^-?\d+$/.test(v.$c)
      ? BigInt(v.$c)
      : k === FEE_KEY && typeof v === "string" && /^\d+$/.test(v)
        ? BigInt(v)
        : v,
  ) as { format?: string; payroll?: Payroll };
  if (doc?.format !== FORMAT || doc.payroll?.version !== 1) throw new Error("Not payroll data from this app, or a newer version");
  return { ...doc.payroll, runs: doc.payroll.runs.map(upgradeRun) };
}
