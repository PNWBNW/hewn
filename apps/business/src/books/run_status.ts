// ---------------------------------------------------------------------------
// Where a pay run's payments stand, in the words Pay runs and a paystub use.
//
// A paycheck with no net pay has nothing to send: on the rail one whose
// withholding takes all of its pay is settled as it posts (@pnw/payroll), and
// one with no gross, or one an earlier build posted pending, stays pending and
// waits on nothing all the same, so none keeps a run from reading Paid. Pure.
// ---------------------------------------------------------------------------

import { type Paycheck, type PayRun, awaitsPayment } from "@pnw/payroll";
import { shortAddress } from "./rail";

/** "Paid", or how far along a run paid on the rail is. */
export function paymentStatus(run: Pick<PayRun, "paychecks">): string {
  const owed = run.paychecks.filter(awaitsPayment);
  if (owed.length === 0) return "Paid";
  const failed = owed.filter((p) => p.settlement.status === "failed").length;
  const parts = [`Settling… ${run.paychecks.length - owed.length} of ${run.paychecks.length}`];
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** A rail run with people still to pay offers Continue (some sent or not yet tried) or Retry (only failures left). */
export function nextStep(run: Pick<PayRun, "mode" | "paychecks">): "Continue" | "Retry" | null {
  if (run.mode !== "rail") return null;
  const open = run.paychecks.filter(awaitsPayment);
  if (open.length === 0) return null;
  return open.every((p) => p.settlement.status === "failed") ? "Retry" : "Continue";
}

/** A rail paycheck whose payment went out and settled: its paystub is marked paid on the rail and can be sent. */
export const paidOnRail = (run: Pick<PayRun, "mode">, p: Pick<Paycheck, "net" | "settlement">): boolean =>
  run.mode === "rail" && p.settlement.status === "settled" && p.net > 0n;

/** The paystub's Paid line: how the net pay moved, or why it hasn't yet. */
export function paidLine(run: Pick<PayRun, "mode">, p: Pick<Paycheck, "net" | "settlement">): string {
  const s = p.settlement;
  if (run.mode === "rail" && p.net === 0n && !s.reference) return "Nothing to send";
  if (s.status === "settled") {
    if (run.mode === "rail") return s.reference ? `On the rail · ${shortAddress(s.reference)}` : "On the rail";
    return s.reference ? `${s.reference}` : "by bank";
  }
  if (s.status === "failed") return s.failure ? `Payment failed: ${s.failure}` : "Payment failed";
  return "Not yet paid";
}
