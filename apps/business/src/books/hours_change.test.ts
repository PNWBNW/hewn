// Changing hours by agreement (books/hours_change.ts): neither side changes the other's hours on
// its own; an agreed change lands on both sides; an open one holds the shift out of pay runs.
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it } from "vitest";
import { buildTimesheet, segmentsOf, timecardPunchIds, weekShifts } from "./hours";
import { type HoursChangeBody, changeFor, hoursChanges, openShifts } from "./hours_change";
import { addHours, emptyMailbox, threadFor, updateThread, type Mailbox } from "./mailbox";
import { markPaid, unpaidHours } from "./timecard_pay";
import { type Side, type ThreadBody, ThreadError, addToThread, validateMessage } from "./thread";
import { type Work, emptyWork, punch, recordTimesheet, updatePunch, updateWorkThread, upsertAgreement, workThread } from "./work";

const AID = "01".repeat(32);
const PK = "ab".repeat(32);
const TZ = "America/Los_Angeles";
const WEEK = "2026-10-11";
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();
const NOW = new Date(local("2026-10-16", "12:00"));
const id = (n: number) => n.toString(16).padStart(32, "0");

/** Ana's Wednesday, 9 to 5. */
function workday(): Work {
  let w = upsertAgreement(emptyWork("Ana"), { agreementId: AID, partiesKey: PK, employerAddress: "aleo1" + "k".repeat(58), employerNameHash: "1", status: "active" });
  w = punch(w, AID, local("2026-10-14", "09:00"), "in1").work;
  return punch(w, AID, local("2026-10-14", "17:00"), "out1").work;
}

/** Sends the week: recorded on Ana's side, kept on the business's. */
function send(w: Work, m: Mailbox, seq = 0): { work: Work; mailbox: Mailbox } {
  const sheet = buildTimesheet(w, AID, WEEK, NOW);
  const lookup = seq.toString(16).padStart(64, "0");
  const work = recordTimesheet(w, { agreementId: AID, weekStart: WEEK, seq, lookup, totalMinutes: sheet.totalMinutes, sentAt: sheet.sentAt, punchIds: timecardPunchIds(w, AID, WEEK, NOW) });
  const mailbox = addHours(m, { agreementId: AID, seq, lookup, receivedAt: sheet.sentAt, workerId: "w1", weekStart: WEEK, entries: sheet.entries, totalMinutes: sheet.totalMinutes, sentAt: sheet.sentAt });
  return { work, mailbox };
}

/** One letter, as each side keeps it: the sender's copy and the one that arrives. */
function letter(n: number, from: Side, body: ThreadBody) {
  const msg = validateMessage({ version: 1, id: id(n), from, sentAt: `2026-10-16T2${n}:00:00.000Z`, body }, from);
  return { asSent: { ...msg, mine: true, seq: n }, asReceived: { ...msg, mine: false, seq: n } };
}
const deliver = (w: Work, m: Mailbox, l: ReturnType<typeof letter>, from: Side) => ({
  work: updateWorkThread(w, PK, (t) => addToThread(t, from === "worker" ? l.asSent : l.asReceived)),
  mailbox: updateThread(m, PK, "w1", (t) => addToThread(t, from === "business" ? l.asSent : l.asReceived)),
});

const SHIFT = { in: local("2026-10-14", "09:00"), out: local("2026-10-14", "17:00") };
const proposal = (inAt: string, outAt: string) => ({ in: inAt, out: outAt, segments: segmentsOf(inAt, outAt, TZ) });
const card = (m: Mailbox) => m.hours[0]!.entries;

describe("the messages", () => {
  it("check the shift, the proposed times and their days, and the note", () => {
    const body = { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "16:30")), note: "Gate log says 4:30." };
    expect(validateMessage({ version: 1, id: id(1), from: "business", sentAt: "2026-10-16T20:00:00.000Z", body }, "business").body).toEqual(body);
    const bad = (b: Record<string, unknown>, from: Side = "business") => () => validateMessage({ version: 1, id: id(1), from, sentAt: "2026-10-16T20:00:00.000Z", body: { ...body, ...b } }, from);
    expect(bad({ note: " " })).toThrow(/what's wrong/);
    expect(bad({ shift: { in: SHIFT.out, out: SHIFT.in } })).toThrow(/end after it starts/);
    expect(bad({ shift: { in: SHIFT.in, out: local("2026-10-16", "09:00") } })).toThrow(/36 hours/);
    expect(bad({ proposed: { ...body.proposed, segments: [] } })).toThrow(/its days/);
    expect(bad({ proposed: { ...body.proposed, segments: [{ ...body.proposed.segments[0]!, minutes: 1 }] } })).toThrow(/doesn't add up/);
    expect(bad({ proposed: { ...body.proposed, out: local("2026-10-14", "18:00") } })).toThrow(/don't cover it/);
    // The person asks only with the times they'd like; the business may ask without.
    expect(bad({ proposed: undefined }, "worker")).toThrow(ThreadError);
    expect(() => validateMessage({ version: 1, id: id(1), from: "business", sentAt: "2026-10-16T20:00:00.000Z", body: { ...body, proposed: undefined } }, "business")).not.toThrow();
    // Keeping hours as they are says why.
    const answer = (note: string) => () => validateMessage({ version: 1, id: id(2), from: "worker", sentAt: "2026-10-16T20:00:00.000Z", body: { type: "hours_change_answer", changeId: id(1), answer: "declined", note } }, "worker");
    expect(answer("")).toThrow(/why/);
    expect(answer("I was there till 5.")).not.toThrow();
  });

  it("split a proposed shift past midnight into its days", () => {
    expect(segmentsOf(local("2026-10-14", "22:00"), local("2026-10-15", "02:00"), TZ).map((s) => [s.date, s.minutes])).toEqual([["2026-10-14", 120], ["2026-10-15", 120]]);
  });
});

describe("the person's own edits", () => {
  it("show on the timecard with what the shift was, and an edit back leaves no mark", () => {
    const edited = updatePunch(workday(), "out1", { at: local("2026-10-14", "18:00") });
    expect(buildTimesheet(edited, AID, WEEK, NOW).entries[0]).toMatchObject({ minutes: 540, was: SHIFT, change: "edited" });
    const again = updatePunch(edited, "out1", { at: local("2026-10-14", "18:30") });
    expect(again.punches.find((p) => p.id === "out1")!.was).toBe(SHIFT.out); // the first time it had
    const back = updatePunch(again, "out1", { at: SHIFT.out });
    expect(buildTimesheet(back, AID, WEEK, NOW).entries[0]!.was).toBeUndefined();
  });
});

describe("the business questions a sent shift", () => {
  it("changes nothing until the person agrees, then both sides show the agreed times", () => {
    let { work, mailbox } = send(workday(), emptyMailbox());
    const ask = letter(1, "business", { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "16:30")), note: "Gate log says 4:30." } as HoursChangeBody);
    ({ work, mailbox } = deliver(work, mailbox, ask, "business"));

    // Nothing moved on either side, and the shift waits out of the pay run.
    expect(card(mailbox)).toMatchObject([{ in: SHIFT.in, out: SHIFT.out, minutes: 480 }]);
    expect(work.punches.find((p) => p.id === "out1")!.at).toBe(SHIFT.out);
    const changes = hoursChanges(threadFor(mailbox, PK));
    expect(openShifts(changes)).toEqual([SHIFT]);
    expect(unpaidHours(mailbox, "w1", WEEK, "2026-10-17", undefined, openShifts(changes)).minutes).toBe(0);
    expect(unpaidHours(mailbox, "w1", WEEK, "2026-10-17").minutes).toBe(480); // paid as sent, if the business chooses

    // Ana agrees: her punches move, and so does the business's card when her answer arrives.
    const yes = letter(2, "worker", { type: "hours_change_answer", changeId: id(1), answer: "accepted", note: "" });
    ({ work, mailbox } = deliver(work, mailbox, yes, "worker"));
    expect(work.punches.find((p) => p.id === "out1")).toMatchObject({ at: local("2026-10-14", "16:30"), was: SHIFT.out, agreed: true });
    expect(weekShifts(work, AID, WEEK, NOW)[0]).toMatchObject({ minutes: 450, sent: true, change: "agreed", was: SHIFT });
    expect(card(mailbox)).toEqual([{ date: "2026-10-14", in: SHIFT.in, out: local("2026-10-14", "16:30"), minutes: 450, was: SHIFT, change: "agreed" }]);
    expect(changeFor(hoursChanges(threadFor(mailbox, PK)), AID, SHIFT)!.answer).toMatchObject({ answer: "accepted" });
    expect(unpaidHours(mailbox, "w1", WEEK, "2026-10-17", undefined, openShifts(hoursChanges(threadFor(mailbox, PK)))).minutes).toBe(450);

    // Reading the conversation again changes nothing more.
    const again = updateThread(mailbox, PK, "w1", (t) => t);
    expect(again.hours).toEqual(mailbox.hours);
    expect(updateWorkThread(work, PK, (t) => t).punches).toEqual(work.punches);
  });

  it("keeps the hours when the person keeps them as sent", () => {
    let { work, mailbox } = send(workday(), emptyMailbox());
    ({ work, mailbox } = deliver(work, mailbox, letter(1, "business", { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "16:30")), note: "4:30?" } as HoursChangeBody), "business"));
    ({ work, mailbox } = deliver(work, mailbox, letter(2, "worker", { type: "hours_change_answer", changeId: id(1), answer: "declined", note: "I stayed to lock up." }), "worker"));
    expect(card(mailbox)).toMatchObject([{ out: SHIFT.out, minutes: 480 }]);
    expect(work.punches.find((p) => p.id === "out1")!.at).toBe(SHIFT.out);
    expect(openShifts(hoursChanges(threadFor(mailbox, PK)))).toEqual([]);
  });

  it("leaves a shift already paid as paid", () => {
    let { work, mailbox } = send(workday(), emptyMailbox());
    ({ work, mailbox } = deliver(work, mailbox, letter(1, "business", { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "16:30")), note: "4:30?" } as HoursChangeBody), "business"));
    mailbox = markPaid(mailbox, unpaidHours(mailbox, "w1", WEEK, "2026-10-17").shifts, "run1", "2026-10-17");
    ({ work, mailbox } = deliver(work, mailbox, letter(2, "worker", { type: "hours_change_answer", changeId: id(1), answer: "accepted", note: "" }), "worker"));
    expect(card(mailbox)).toMatchObject([{ out: SHIFT.out, minutes: 480, paid: { runId: "run1" } }]);
  });

  it("only counts an answer from the other side", () => {
    let { work, mailbox } = send(workday(), emptyMailbox());
    ({ work, mailbox } = deliver(work, mailbox, letter(1, "business", { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "16:30")), note: "4:30?" } as HoursChangeBody), "business"));
    // The business can't answer its own question.
    mailbox = updateThread(mailbox, PK, "w1", (t) => addToThread(t, letter(2, "business", { type: "hours_change_answer", changeId: id(1), answer: "accepted", note: "" }).asSent));
    expect(card(mailbox)).toMatchObject([{ out: SHIFT.out }]);
    expect(openShifts(hoursChanges(threadFor(mailbox, PK)))).toEqual([SHIFT]);
  });
});

describe("the person asks for a revision of a shift not sent yet", () => {
  it("moves their punches once the business accepts, and the timecard says it was agreed", () => {
    let work = workday();
    let mailbox = emptyMailbox();
    const ask = letter(1, "worker", { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "17:45")), note: "Forgot to clock out; left at 5:45." } as HoursChangeBody);
    ({ work, mailbox } = deliver(work, mailbox, ask, "worker"));
    expect(work.punches.find((p) => p.id === "out1")!.at).toBe(SHIFT.out); // waiting
    ({ work, mailbox } = deliver(work, mailbox, letter(2, "business", { type: "hours_change_answer", changeId: id(1), answer: "accepted", note: "" }), "business"));
    expect(work.punches.find((p) => p.id === "out1")).toMatchObject({ at: local("2026-10-14", "17:45"), agreed: true });
    expect(mailbox.hours).toEqual([]); // nothing on the business's cards until it's sent
    const sent = send(work, mailbox);
    expect(card(sent.mailbox)).toMatchObject([{ minutes: 525, was: SHIFT, change: "agreed" }]);
    expect(workThread(sent.work, PK)!.items).toHaveLength(2);
  });

  it("ignores an agreed change that would make shifts overlap", () => {
    let work = punch(punch(workday(), AID, local("2026-10-14", "18:00"), "in2").work, AID, local("2026-10-14", "20:00"), "out2").work;
    let mailbox = emptyMailbox();
    ({ work, mailbox } = deliver(work, mailbox, letter(1, "worker", { type: "hours_change", agreementId: AID, shift: SHIFT, proposed: proposal(SHIFT.in, local("2026-10-14", "19:00")), note: "Late." } as HoursChangeBody), "worker"));
    ({ work, mailbox } = deliver(work, mailbox, letter(2, "business", { type: "hours_change_answer", changeId: id(1), answer: "accepted", note: "" }), "business"));
    expect(work.punches.find((p) => p.id === "out1")!.at).toBe(SHIFT.out);
  });
});
