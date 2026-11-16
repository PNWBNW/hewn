import { describe, expect, it } from "vitest";
import type { Paycheck, PayRun, Settlement } from "@pnw/payroll";
import { nextStep, paidLine, paidOnRail, paymentStatus } from "./run_status";

const TX = "at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw";
const settled: Settlement = { status: "settled", reference: TX, height: 4_210_000, settledAt: "2026-10-17T09:00:00.000Z" };
const pending: Settlement = { status: "pending" };
const failed: Settlement = { status: "failed", failure: "rejected" };
/** A paycheck with only what these read: who, the net pay, and where its payment stands. */
const check = (workerId: string, net: bigint, settlement: Settlement) => ({ workerId, net, settlement }) as Paycheck;
const run = (mode: PayRun["mode"], ...paychecks: Paycheck[]) => ({ mode, paychecks }) as PayRun;

describe("a pay run's status in Pay runs", () => {
  it("reads Paid for a rail run whose only unsettled paycheck has nothing to pay, settled as it posted or left pending by an older build", () => {
    expect(paymentStatus(run("rail", check("w1", 5000n, settled), check("w2", 0n, { status: "settled", settledAt: "2026-10-16T12:00:00.000Z" })))).toBe("Paid");
    expect(paymentStatus(run("rail", check("w1", 5000n, settled), check("w2", 0n, pending)))).toBe("Paid");
    expect(nextStep(run("rail", check("w1", 5000n, settled), check("w2", 0n, pending)))).toBeNull();
  });

  it("counts a paycheck with nothing to pay as done while others still settle", () => {
    const r = run("rail", check("w1", 0n, pending), check("w2", 5000n, settled), check("w3", 5000n, pending));
    expect(paymentStatus(r)).toBe("Settling… 2 of 3");
    expect(nextStep(r)).toBe("Continue");
  });

  it("isn't Paid while a paycheck with something to pay is pending or failed", () => {
    expect(paymentStatus(run("rail", check("w1", 5000n, pending)))).toBe("Settling… 0 of 1");
    const r = run("rail", check("w1", 5000n, failed), check("w2", 5000n, settled), check("w3", 0n, pending));
    expect(paymentStatus(r)).toBe("Settling… 2 of 3 · 1 failed");
    expect(nextStep(r)).toBe("Retry");
  });

  it("reads Paid for a run paid outside the app, which offers no next step", () => {
    const r = run("external", check("w1", 5000n, { status: "settled", reference: "BATCH-7" }), check("w2", 0n, { status: "settled" }));
    expect(paymentStatus(r)).toBe("Paid");
    expect(nextStep(r)).toBeNull();
  });
});

describe("the Paid line on a paystub", () => {
  it("says there is nothing to send for a rail paycheck with nothing to pay, and doesn't mark it paid on the rail", () => {
    for (const s of [{ status: "settled", settledAt: "2026-10-16T12:00:00.000Z" }, pending] as Settlement[]) {
      const r = run("rail", check("w1", 0n, s));
      expect(paidLine(r, r.paychecks[0]!)).toBe("Nothing to send");
      expect(paidOnRail(r, r.paychecks[0]!)).toBe(false);
    }
  });

  it("is unchanged for every paycheck with something to pay", () => {
    const rail = run("rail", check("w1", 5000n, settled), check("w2", 5000n, failed), check("w3", 5000n, pending), check("w4", 5000n, { status: "settled" }));
    expect(rail.paychecks.map((p) => paidLine(rail, p))).toEqual(["On the rail · at1yphn8n…9ltw", "Payment failed: rejected", "Not yet paid", "On the rail"]);
    expect(rail.paychecks.map((p) => paidOnRail(rail, p))).toEqual([true, false, false, true]);
    const bank = run("external", check("w1", 5000n, { status: "settled", reference: "BATCH-7" }), check("w2", 0n, { status: "settled" }));
    expect(bank.paychecks.map((p) => paidLine(bank, p))).toEqual(["BATCH-7", "by bank"]);
    expect(bank.paychecks.map((p) => paidOnRail(bank, p))).toEqual([false, false]);
  });
});
