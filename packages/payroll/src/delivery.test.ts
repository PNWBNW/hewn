// The outbox record on a paycheck: which mailbox slot its paystub went to, and when.
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks } from "@pnw/ledger";
import { type Payroll, type W4, addWorker, emptyPayroll, markPaycheckDelivery, markPaycheckSettlement, markPaystubReceived, postPayRun } from "./payroll";
import { payrollFromJson, payrollToJson } from "./serialize";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-10-16T12:00:00.000Z" };
const LOOKUP = "8a45f32884aa20563afb9535932161b51369dfddce1d952bc1e8f5341b14416e";
const delivery = { seq: 0, lookup: LOOKUP, sentAt: "2026-10-16T12:05:00.000Z" };

function setup() {
  const books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
  let payroll: Payroll = emptyPayroll();
  const ana = addWorker(payroll, { name: "Ana", payType: "salary", rate: 5_200_000n, frequency: "biweekly", w4: W4_SINGLE });
  payroll = ana.payroll;
  const ben = addWorker(payroll, { name: "Ben", payType: "hourly", rate: 2550n, frequency: "biweekly", w4: W4_SINGLE });
  payroll = ben.payroll;
  const input = {
    payDate: "2026-10-16",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-14",
    bankAccountId: bankId,
    mode: "rail" as const,
    lines: [{ workerId: ana.worker.id }, { workerId: ben.worker.id, hours: 80 }],
  };
  const posted = postPayRun(books, payroll, input, clock);
  const settled = markPaycheckSettlement(posted.payroll, posted.run.id, ana.worker.id, {
    status: "settled",
    reference: "at1transfer",
    height: 4_210_000,
    settledAt: clock.now(),
    feeMicrocredits: 51_580n,
  });
  return { payroll: settled, runId: posted.run.id, ana: ana.worker, ben: ben.worker };
}

describe("markPaycheckDelivery", () => {
  it("records the slot and time on a settled paycheck, leaving everything else alone", () => {
    const s = setup();
    const sent = markPaycheckDelivery(s.payroll, s.runId, s.ana.id, delivery);
    const [ana, ben] = sent.runs[0]!.paychecks;
    expect(ana!.delivery).toEqual(delivery);
    expect(ana!.settlement).toEqual(s.payroll.runs[0]!.paychecks[0]!.settlement);
    expect(ben!.delivery).toBeUndefined();
    expect(s.payroll.runs[0]!.paychecks[0]!.delivery).toBeUndefined(); // pure
    // Extra fields on the delivery are dropped.
    const extra = markPaycheckDelivery(s.payroll, s.runId, s.ana.id, { ...delivery, note: "x" } as never);
    expect(extra.runs[0]!.paychecks[0]!.delivery).toEqual(delivery);
  });

  it("round-trips through JSON like the other optional fields", () => {
    const s = setup();
    const sent = markPaycheckDelivery(s.payroll, s.runId, s.ana.id, delivery);
    const json = payrollToJson(sent);
    expect(json).toContain(`"delivery":{"seq":0,"lookup":"${LOOKUP}","sentAt":"2026-10-16T12:05:00.000Z"}`);
    expect(payrollFromJson(json)).toEqual(sent);
    // A paycheck never sent has no delivery key at all.
    expect(payrollFromJson(payrollToJson(s.payroll)).runs[0]!.paychecks[0]).not.toHaveProperty("delivery");
  });

  it("a resend replaces the record with a later slot, never an earlier one", () => {
    const s = setup();
    const first = markPaycheckDelivery(s.payroll, s.runId, s.ana.id, delivery);
    const again = markPaycheckDelivery(first, s.runId, s.ana.id, { seq: 3, lookup: "f".repeat(64), sentAt: "2026-10-17T09:00:00.000Z" });
    expect(again.runs[0]!.paychecks[0]!.delivery).toEqual({ seq: 3, lookup: "f".repeat(64), sentAt: "2026-10-17T09:00:00.000Z" });
    expect(() => markPaycheckDelivery(again, s.runId, s.ana.id, { ...delivery, seq: 1 })).toThrow(/earlier slot/);
    // The same slot again (a repeated attempt) is fine.
    expect(markPaycheckDelivery(again, s.runId, s.ana.id, { ...delivery, seq: 3 }).runs[0]!.paychecks[0]!.delivery?.seq).toBe(3);
  });

  it("refuses a paycheck that isn't settled, and a malformed delivery", () => {
    const s = setup();
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ben.id, delivery)).toThrow(/once the pay has settled/);
    const failed = markPaycheckSettlement(s.payroll, s.runId, s.ben.id, { status: "failed", failure: "rejected" });
    expect(() => markPaycheckDelivery(failed, s.runId, s.ben.id, delivery)).toThrow(/once the pay has settled/);
    expect(() => markPaycheckDelivery(s.payroll, "run-9", s.ana.id, delivery)).toThrow(/not found/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, "wkr-9", delivery)).toThrow(/isn't in this pay run/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ana.id, { ...delivery, seq: -1 })).toThrow(/whole number/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ana.id, { ...delivery, seq: 1.5 })).toThrow(/whole number/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ana.id, { ...delivery, lookup: "0x" + LOOKUP })).toThrow(/64 hex/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ana.id, { ...delivery, lookup: LOOKUP.toUpperCase() })).toThrow(/64 hex/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ana.id, { ...delivery, sentAt: "later" })).toThrow(/time it was sent/);
    expect(() => markPaycheckDelivery(s.payroll, s.runId, s.ana.id, null as never)).toThrow(/which slot/);
  });
});

describe("markPaystubReceived", () => {
  it("records the person's receipt for the slot that was sent, once, and survives a save", () => {
    const { payroll, runId, ana } = setup();
    const sent = markPaycheckDelivery(payroll, runId, ana.id, delivery);
    const got = markPaystubReceived(sent, runId, ana.id, 0, "2026-10-16T13:00:00.000Z");
    const check = () => got.runs[0]!.paychecks.find((p) => p.workerId === ana.id)!;
    expect(check().delivery).toEqual({ ...delivery, receivedAt: "2026-10-16T13:00:00.000Z" });
    expect(markPaystubReceived(got, runId, ana.id, 0, "2026-10-17T13:00:00.000Z")).toBe(got);
    expect(payrollFromJson(payrollToJson(got)).runs[0]!.paychecks.find((p) => p.workerId === ana.id)!.delivery!.receivedAt).toBe("2026-10-16T13:00:00.000Z");
  });

  it("ignores a receipt for another slot or an unsent paystub, and a re-send waits for its own", () => {
    const { payroll, runId, ana, ben } = setup();
    const sent = markPaycheckDelivery(payroll, runId, ana.id, delivery);
    expect(markPaystubReceived(sent, runId, ana.id, 1, "2026-10-16T13:00:00.000Z")).toBe(sent);
    expect(markPaystubReceived(sent, runId, ben.id, 0, "2026-10-16T13:00:00.000Z")).toBe(sent);
    expect(markPaystubReceived(sent, "nope", ana.id, 0, "2026-10-16T13:00:00.000Z")).toBe(sent);
    expect(() => markPaystubReceived(sent, runId, ana.id, 0, "soon")).toThrow(/time it was received/);
    const got = markPaystubReceived(sent, runId, ana.id, 0, "2026-10-16T13:00:00.000Z");
    const resent = markPaycheckDelivery(got, runId, ana.id, { ...delivery, seq: 1 });
    expect(resent.runs[0]!.paychecks.find((p) => p.workerId === ana.id)!.delivery).toEqual({ ...delivery, seq: 1 });
  });
});
