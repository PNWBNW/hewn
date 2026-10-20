// Phase 9's second exit criterion, end to end: a confirmed on-call week and one callout pay the
// agreed on-call amount and the callout minimum at the overtime rate on the next run.

import { describe, expect, it } from "vitest";
import { addWorker, emptyPayroll, previewPayRun } from "@pnw/payroll";
import { addHours, emptyMailbox } from "./mailbox";
import { emptySchedule, unpaidOnCallDates, type ScheduleWeek } from "./schedule";
import { type Thread, addToThread, emptyThread, validateMessage } from "./thread";
import { hoursText, unpaidHours } from "./timecard_pay";
import { defaultWorkWeek, payRulesOf } from "./work_week";

const W4 = { filingStatus: "single" as const, dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const AGREEMENT = "ab".repeat(32);
const id = (n: number) => n.toString(16).padStart(32, "0");

describe("on call and a callout, on the next run", () => {
  it("pays $25 a confirmed on-call day and a 1-hour callout as the 2-hour minimum at 1.5×", () => {
    // The offer: $22.50 an hour, time and a half, $25 a day on call, callouts at least 2 hours.
    const rules = payRulesOf({ ...defaultWorkWeek("UTC"), onCallPay: "2500", calloutMinimumHours: 2 });
    const added = addWorker(emptyPayroll(), { name: "Ana", payType: "hourly", rate: 2250n, frequency: "weekly", w4: W4 });
    const worker = added.worker;

    // The week: Monday and Tuesday 8-hour shifts, on call Tuesday to Thursday; published and confirmed.
    const week: ScheduleWeek = {
      weekStart: "2026-10-25",
      days: [
        { date: "2026-10-26", shifts: [{ start: "08:00", end: "16:00" }], onCall: false },
        { date: "2026-10-27", shifts: [{ start: "08:00", end: "16:00" }], onCall: true },
        { date: "2026-10-28", shifts: [], onCall: true },
        { date: "2026-10-29", shifts: [], onCall: true },
      ],
    };
    const msg = (n: number, from: "business" | "worker", body: unknown, mine: boolean) => ({
      ...validateMessage({ version: 1, id: id(n), from, sentAt: `2026-10-2${n}T10:00:00.000Z`, body }, from),
      mine,
      seq: n,
    });
    let thread: Thread = addToThread(emptyThread(), msg(1, "business", { type: "schedule", week, note: "" }, true));
    thread = addToThread(thread, msg(2, "worker", { type: "schedule_answer", scheduleId: id(1), weekStart: week.weekStart, answer: "confirmed", note: "" }, false));

    // The timecard: the two shifts, and a 1-hour callout Wednesday night.
    const at = (date: string, from: string, to: string, minutes: number, callout = false) => ({
      date,
      in: `${date}T${from}:00.000Z`,
      out: `${date}T${to}:00.000Z`,
      minutes,
      ...(callout ? { callout: true as const } : {}),
    });
    const entries = [at("2026-10-26", "08:00", "16:00", 480), at("2026-10-27", "08:00", "16:00", 480), at("2026-10-28", "21:00", "22:00", 60, true)];
    const mailbox = addHours(emptyMailbox(), {
      agreementId: AGREEMENT,
      seq: 0,
      lookup: "cd".repeat(32),
      receivedAt: "2026-10-30T09:00:00.000Z",
      workerId: worker.id,
      weekStart: week.weekStart,
      entries,
      totalMinutes: 1020,
      sentAt: "2026-10-30T08:00:00.000Z",
    });

    const period = { start: "2026-10-25", end: "2026-10-31" };
    const cards = unpaidHours(mailbox, worker.id, period.start, period.end, rules);
    const onCallDates = unpaidOnCallDates(thread, emptySchedule(), worker.id, period.start, period.end);
    expect(cards).toMatchObject({ regularMinutes: 960, overtimeMinutes: 0, calloutPaidMinutes: 120 });
    expect(onCallDates).toEqual(["2026-10-27", "2026-10-28", "2026-10-29"]);

    const [paycheck] = previewPayRun(added.payroll, {
      payDate: "2026-10-30",
      periodStart: period.start,
      periodEnd: period.end,
      bankAccountId: "unused",
      lines: [
        {
          workerId: worker.id,
          hours: Number(hoursText(cards.regularMinutes)),
          callout: { hours: Number(hoursText(cards.calloutPaidMinutes)), rate: rules.overtimeRate },
          onCall: { days: onCallDates.length, perDay: rules.onCallPayCents },
        },
      ],
    });
    // 16 h × $22.50 = $360; callout 2 h × $33.75 = $67.50; on call 3 × $25 = $75.
    expect(paycheck).toMatchObject({ hours: 16, calloutHours: 2, calloutRate: 1.5, onCallDays: 3, onCallPay: 7_500n, gross: 50_250n });
  });
});
