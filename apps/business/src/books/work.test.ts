import { describe, expect, it } from "vitest";
import {
  type ReceivedPaystub,
  type Terms,
  type Work,
  type WorkAgreement,
  WorkError,
  addPaystub,
  agreementFor,
  bumpWorkSeq,
  emptyWork,
  nextWorkSeq,
  openPunch,
  punch,
  markTimesheetReceived,
  setIdentity,
  updateCoworker,
  updateWorkThread,
  workThread,
  recordTimesheet,
  removePunch,
  setProfile,
  updatePunch,
  upsertAgreement,
  validateTerms,
  workFromJson,
  workToJson,
  confirmShift,
  validatePunch,
  keepConfirmedName,
  forgetConfirmedName,
} from "./work";
import { CONFIRM_AGAIN_MS, MAX_CONFIRMED_NAMES, confirmAgainDue } from "./directory";

const EMPLOYER = "aleo1" + "k".repeat(58);
const KEY = "ab".repeat(32);
const AID = "01".repeat(32);

export const TERMS: Terms = {
  version: 1,
  kind: "terms",
  agreementId: AID,
  termsText: "Framing carpenter, 40 hours a week, tools provided.",
  payType: "hourly",
  rate: "3000",
  frequency: "weekly",
  startDate: "2026-10-19",
  businessName: "Day Construction",
  offeredAt: "2026-10-14T16:00:00.000Z",
};

const agreement = (over: Partial<WorkAgreement> = {}): WorkAgreement => ({
  agreementId: AID,
  partiesKey: KEY,
  employerAddress: EMPLOYER,
  employerNameHash: "12345",
  status: "active",
  ...over,
});

const withAgreement = (): Work => upsertAgreement(emptyWork("Ana Ruiz"), agreement({ terms: TERMS, employerName: "brothers" }));

const paystub = (seq: number): ReceivedPaystub => ({
  agreementId: AID,
  seq,
  lookup: "c".repeat(64),
  receivedAt: "2026-10-16T10:00:00.000Z",
  document: { version: 1, net: "104805" },
  settlement: { transactionId: "at1" + "x".repeat(58), height: 42, feeMicrocredits: "51580" },
  businessName: "Day Construction",
  paystubHash: "d".repeat(64),
});

describe("work file", () => {
  it("round-trips everything through JSON", () => {
    let w = withAgreement();
    w = setProfile(w, { nameHash: "777", name: "ana_ruiz", profileAnchored: true, registeredAt: "2026-10-14T12:00:00.000Z" });
    w = punch(w, AID, "2026-10-14T15:00:00.000Z", "p1").work;
    w = punch(w, AID, "2026-10-14T19:30:00.000Z", "p2").work;
    w = recordTimesheet(w, { agreementId: AID, weekStart: "2026-10-12", seq: 0, lookup: "e".repeat(64), totalMinutes: 270, sentAt: "2026-10-17T00:00:00.000Z" });
    w = addPaystub(w, paystub(0));
    expect(workFromJson(workToJson(w))).toEqual(w);
    expect(w.mailboxSeq[AID]).toEqual({ timesheet: 1, paystub: 1 });
  });

  it("starts empty with a name", () => {
    expect(emptyWork("Ana")).toEqual({ version: 1, displayName: "Ana", agreements: [], punches: [], timesheets: [], paystubs: [], mailboxSeq: {} });
    expect(workFromJson(workToJson(emptyWork("Ana")))).toEqual(emptyWork("Ana"));
  });

  it("refuses a broken file", () => {
    expect(() => workFromJson(JSON.stringify({ version: 2 }))).toThrow(WorkError);
    expect(() => workFromJson(JSON.stringify({ ...emptyWork("A"), agreements: [{ agreementId: "zz" }] }))).toThrow(WorkError);
    expect(() => workFromJson(JSON.stringify({ ...emptyWork("A"), punches: [{ id: "p", agreementId: AID, at: "yesterday", kind: "in" }] }))).toThrow(/date/);
    expect(() => workFromJson(JSON.stringify({ ...emptyWork("A"), mailboxSeq: { [AID]: { w4: 1 } } }))).toThrow(/Unknown mailbox/);
    expect(() => upsertAgreement(emptyWork("A"), agreement({ partiesKey: "abc" }))).toThrow(/64 hex/);
    expect(() => upsertAgreement(emptyWork("A"), agreement({ status: "signed" as never }))).toThrow(/status/);
  });

  it("validates terms field by field", () => {
    expect(validateTerms(TERMS)).toEqual(TERMS);
    expect(() => validateTerms({ ...TERMS, kind: "offer" })).toThrow(WorkError);
    expect(() => validateTerms({ ...TERMS, rate: "30.00" })).toThrow(/cents/);
    expect(() => validateTerms({ ...TERMS, frequency: "fortnightly" })).toThrow(/frequency/);
    expect(() => validateTerms({ ...TERMS, startDate: "19/10/2026" })).toThrow(/YYYY-MM-DD/);
  });

  it("merges an agreement onto an earlier copy, keeping its terms and name", () => {
    const w = withAgreement();
    const again = upsertAgreement(w, agreement({ status: "paused" }));
    expect(again.agreements).toHaveLength(1);
    expect(again.agreements[0]).toMatchObject({ status: "paused", terms: TERMS, employerName: "brothers" });
  });

  it("keeps mailbox slots per agreement and never moves them backwards", () => {
    let w = withAgreement();
    expect(nextWorkSeq(w, AID, "paystub")).toBe(0);
    w = bumpWorkSeq(w, AID, "paystub", 3);
    expect(nextWorkSeq(w, AID, "paystub")).toBe(4);
    w = bumpWorkSeq(w, AID, "paystub", 1);
    expect(nextWorkSeq(w, AID, "paystub")).toBe(4);
    expect(() => bumpWorkSeq(w, "ff", "paystub", 0)).toThrow(/No agreement/);
  });

  it("keeps one paystub per slot", () => {
    let w = addPaystub(withAgreement(), paystub(0));
    w = addPaystub(w, { ...paystub(0), paystubHash: "e".repeat(64) });
    expect(w.paystubs).toHaveLength(1);
    expect(w.paystubs[0]!.paystubHash).toBe("d".repeat(64));
    expect(nextWorkSeq(w, AID, "paystub")).toBe(1);
    expect(() => addPaystub(w, { ...paystub(1), paystubHash: "nope" })).toThrow(/64 hex/);
  });

  it("replaces a week sent again", () => {
    const sent = { agreementId: AID, weekStart: "2026-10-12", seq: 0, lookup: "e".repeat(64), totalMinutes: 270, sentAt: "2026-10-17T00:00:00.000Z" };
    let w = recordTimesheet(withAgreement(), sent);
    w = recordTimesheet(w, { ...sent, seq: 1, lookup: "f".repeat(64), totalMinutes: 300 });
    expect(w.timesheets).toHaveLength(1);
    expect(w.timesheets[0]!.totalMinutes).toBe(300);
    expect(nextWorkSeq(w, AID, "timesheet")).toBe(2);
  });

  it("keeps the employer's receipt for a sent week, once, through a save; a week sent again waits for its own", () => {
    const sent = { agreementId: AID, weekStart: "2026-10-12", seq: 0, lookup: "e".repeat(64), totalMinutes: 270, sentAt: "2026-10-17T00:00:00.000Z" };
    const w = recordTimesheet(withAgreement(), sent);
    const got = markTimesheetReceived(w, AID, 0, "2026-10-17T09:00:00.000Z");
    expect(got.timesheets[0]!.receivedAt).toBe("2026-10-17T09:00:00.000Z");
    expect(markTimesheetReceived(got, AID, 0, "2026-10-18T09:00:00.000Z")).toBe(got);
    expect(markTimesheetReceived(w, AID, 5, "2026-10-17T09:00:00.000Z")).toBe(w);
    expect(() => markTimesheetReceived(w, AID, 0, "soon")).toThrow();
    expect(workFromJson(workToJson(got)).timesheets[0]!.receivedAt).toBe("2026-10-17T09:00:00.000Z");
    expect(recordTimesheet(got, { ...sent, seq: 1, lookup: "f".repeat(64) }).timesheets[0]).not.toHaveProperty("receivedAt");
  });
});

describe("punches", () => {
  it("alternate in and out", () => {
    let w = withAgreement();
    expect(openPunch(w, AID)).toBeUndefined();
    const first = punch(w, AID, "2026-10-14T15:00:00.000Z", "p1");
    expect(first.punch.kind).toBe("in");
    w = first.work;
    expect(openPunch(w, AID)?.id).toBe("p1");
    const second = punch(w, AID, "2026-10-14T19:30:00.000Z", "p2");
    expect(second.punch.kind).toBe("out");
    expect(openPunch(second.work, AID)).toBeUndefined();
  });

  it("refuses to clock against an agreement that isn't active", () => {
    const w = upsertAgreement(emptyWork("A"), agreement({ status: "pending" }));
    expect(() => punch(w, AID)).toThrow(/isn't active/);
    expect(() => punch(w, "ff")).toThrow(/No agreement/);
  });

  it("rejects overlapping and out-of-order punches, on edit too", () => {
    let w = withAgreement();
    w = punch(w, AID, "2026-10-14T15:00:00.000Z", "p1").work;
    w = punch(w, AID, "2026-10-14T19:30:00.000Z", "p2").work;
    // Moving the out before the in puts an out first.
    expect(() => updatePunch(w, "p2", { at: "2026-10-14T14:00:00.000Z" })).toThrow(/overlap/);
    // A new in before the out of the last shift.
    expect(() => punch(w, AID, "2026-10-14T18:00:00.000Z", "p3")).toThrow(/overlap/);
    // Same time twice.
    expect(() => punch(w, AID, "2026-10-14T19:30:00.000Z", "p3")).toThrow(/same time/);
    // A later shift can't be dragged over an earlier one.
    w = punch(w, AID, "2026-10-14T20:00:00.000Z", "p3").work;
    expect(() => updatePunch(w, "p3", { at: "2026-10-14T16:00:00.000Z" })).toThrow(/overlap/);
    // But moving it within its own gap is fine.
    expect(updatePunch(w, "p3", { at: "2026-10-14T19:45:00.000Z" }).punches.find((p) => p.id === "p3")?.at).toBe("2026-10-14T19:45:00.000Z");
  });

  it("removes a lone out, and takes the other end of a shift with an in", () => {
    let w = withAgreement();
    w = punch(w, AID, "2026-10-14T15:00:00.000Z", "p1").work;
    w = punch(w, AID, "2026-10-14T19:30:00.000Z", "p2").work;
    const reopened = removePunch(w, "p2");
    expect(reopened.punches.map((p) => p.id)).toEqual(["p1"]);
    expect(openPunch(reopened, AID)?.id).toBe("p1");
    const gone = removePunch(w, "p1");
    expect(gone.punches).toEqual([]);
    expect(() => removePunch(w, "nope")).toThrow(/No punch/);
  });

  it("keeps agreements apart: a shift with one employer doesn't block another", () => {
    const other = agreement({ agreementId: "02".repeat(32), partiesKey: "cd".repeat(32) });
    let w = upsertAgreement(withAgreement(), other);
    w = punch(w, AID, "2026-10-14T15:00:00.000Z", "p1").work;
    expect(punch(w, other.agreementId, "2026-10-14T16:00:00.000Z", "p2").punch.kind).toBe("in");
  });
});

describe("an offer letter in the person's vault", () => {
  const sha = "b".repeat(64);
  const v2 = {
    ...TERMS,
    version: 2 as const,
    expiresAt: "2026-10-21T16:00:00.000Z",
    letter: { description: "Framing.", requirements: "", handbook: "Steel toes.", other: "" },
    files: [{ name: "contract.pdf", type: "application/pdf", size: 300_000, sha256: sha, chunks: 2 }],
  };
  const ref = { attachmentId: "att-1", sha256: sha, type: "application/pdf", size: 300_000, name: "contract.pdf" };

  it("keeps the letter, and the files' saved copies once they're in", () => {
    expect(validateTerms(v2)).toEqual(v2);
    const agreement = { agreementId: "ab".repeat(32), partiesKey: "cd".repeat(32), employerAddress: "aleo1" + "q".repeat(58), employerNameHash: "1", status: "pending" as const, terms: v2, files: [ref] };
    const w = upsertAgreement(emptyWork("Ana"), agreement);
    expect(agreementFor(w, agreement.agreementId)!.files).toEqual([ref]);
    // A later sighting without files keeps the ones already saved.
    const { files: _f, ...seenAgain } = agreement;
    expect(agreementFor(upsertAgreement(w, { ...seenAgain, status: "active" }), agreement.agreementId)!.files).toEqual([ref]);
  });

  it("refuses files that aren't the letter's, a broken letter, or files without a letter", () => {
    const agreement = { agreementId: "ab".repeat(32), partiesKey: "cd".repeat(32), employerAddress: "aleo1" + "q".repeat(58), employerNameHash: "1", status: "pending" as const };
    expect(() => upsertAgreement(emptyWork("Ana"), { ...agreement, terms: v2, files: [{ ...ref, size: 1 }] })).toThrow(WorkError);
    expect(() => upsertAgreement(emptyWork("Ana"), { ...agreement, terms: TERMS, files: [ref] })).toThrow(/need the offer letter/);
    expect(() => validateTerms({ ...v2, letter: { description: 1 } })).toThrow(WorkError);
    expect(() => validateTerms({ ...v2, files: [{ ...v2.files[0], chunks: 9 }] })).toThrow(/piece count/);
  });
});

describe("threads in the person's vault", () => {
  it("are kept per employer by parties key and survive a save", async () => {
    const { addToThread } = await import("./thread");
    const key = "ab".repeat(32);
    const item = { version: 1 as const, id: "2".repeat(32), from: "business" as const, sentAt: "2026-10-16T18:00:00.000Z", body: { type: "stands" as const, agreementId: "aa".repeat(32), note: "Kept." }, mine: false, seq: 0 };
    const w = updateWorkThread(withAgreement(), key, (t) => addToThread(t, item));
    expect(workThread(w, key)?.nextIn).toBe(1);
    expect(workFromJson(workToJson(w))).toEqual(w);
    expect(() => updateWorkThread(w, "nope", (t) => t)).toThrow(/parties key/);
  });
});

describe("coworkers in the person's vault", () => {
  it("keep a key pair per business and a conversation per coworker, through a save", async () => {
    const { addToThread } = await import("./thread");
    const biz = "ab".repeat(32);
    const theirs = "04" + "c".repeat(128);
    const id = { publicKey: "04" + "a".repeat(128), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" }, createdAt: "2026-10-16T10:00:00.000Z", listed: true, name: "Ana" };
    const item = { version: 1 as const, id: "5".repeat(32), from: "worker" as const, sentAt: "2026-10-16T18:00:00.000Z", body: { type: "text" as const, text: "Lunch?" }, mine: true, seq: 0 };
    let w = setIdentity(withAgreement(), biz, id);
    w = updateCoworker(w, theirs, { businessKey: biz, name: "Bo" }, (t) => ({ ...t, ...addToThread(t, item) }));
    expect(w.coworkers?.[theirs]).toMatchObject({ businessKey: biz, name: "Bo", nextOut: 1 });
    expect(workFromJson(workToJson(w))).toEqual(w);
    expect(() => setIdentity(w, "nope", id)).toThrow();
  });
});

describe("coworkers' names as the chain confirmed them", () => {
  const ana = "aleo1" + "a".repeat(58);
  const at = "2026-10-23T09:00:00.000Z";

  it("are kept by account through a save, and forgotten", () => {
    const w = keepConfirmedName(withAgreement(), ana, "ana_w", at);
    expect(w.confirmedNames).toEqual({ [ana]: { name: "ana_w", checkedAt: at } });
    expect(workFromJson(workToJson(w))).toEqual(w);
    const gone = forgetConfirmedName(w, ana);
    expect(gone.confirmedNames).toBeUndefined();
    expect(forgetConfirmedName(gone, ana)).toBe(gone);
  });

  it("hold only registered names under accounts", () => {
    const w = withAgreement();
    expect(() => keepConfirmedName(w, "not-an-account", "ana_w", at)).toThrow(WorkError);
    for (const bad of ["Ana", "an", "ana w", "a".repeat(17), ""]) expect(() => keepConfirmedName(w, ana, bad, at), bad).toThrow(WorkError);
    expect(() => keepConfirmedName(w, ana, "ana_w", "yesterday")).toThrow(WorkError);
  });

  it("are asked about again after a day, or when never asked, or stamped in the future", () => {
    const now = Date.parse(at);
    expect(confirmAgainDue(undefined, now)).toBe(true);
    expect(confirmAgainDue({ name: "ana_w", checkedAt: at }, now + CONFIRM_AGAIN_MS - 1)).toBe(false);
    expect(confirmAgainDue({ name: "ana_w", checkedAt: at }, now + CONFIRM_AGAIN_MS)).toBe(true);
    expect(confirmAgainDue({ name: "ana_w", checkedAt: at }, now - 1)).toBe(true);
  });

  it("drop the longest unchecked past the limit, never the one just kept", () => {
    const account = (i: number) => "aleo1" + String(i).padStart(58, "x");
    const names = Object.fromEntries(Array.from({ length: MAX_CONFIRMED_NAMES }, (_, i) => [account(i), { name: "ana_w", checkedAt: new Date(Date.parse(at) + i * 1000).toISOString() }]));
    const w = keepConfirmedName({ ...withAgreement(), confirmedNames: names }, ana, "new_one", "2026-10-01T00:00:00.000Z");
    expect(Object.keys(w.confirmedNames!)).toHaveLength(MAX_CONFIRMED_NAMES);
    expect(w.confirmedNames![ana]?.name).toBe("new_one");
    expect(w.confirmedNames![account(0)]).toBeUndefined();
  });
});

describe("confirming a long shift", () => {
  it("marks the clock-out, only a clock-out, survives a save, and is dropped when the shift moves", () => {
    let w = withAgreement();
    w = punch(w, AID, "2026-10-14T13:00:00.000Z", "p1").work;
    w = punch(w, AID, "2026-10-15T03:00:00.000Z", "p2").work;
    expect(() => confirmShift(w, "p1")).toThrow(/Only a clock-out/);
    expect(() => confirmShift(w, "nope")).toThrow(/No punch/);
    const c = confirmShift(w, "p2");
    expect(c.punches.find((p) => p.id === "p2")).toEqual({ id: "p2", agreementId: AID, at: "2026-10-15T03:00:00.000Z", kind: "out", confirmed: true });
    expect(confirmShift(c, "p2")).toEqual(c);
    expect(workFromJson(workToJson(c)).punches.find((p) => p.id === "p2")?.confirmed).toBe(true);
    expect(validatePunch({ id: "x", agreementId: AID, at: "2026-10-15T03:00:00.000Z", kind: "out", confirmed: false })).not.toHaveProperty("confirmed");
    expect(validatePunch({ id: "x", agreementId: AID, at: "2026-10-15T03:00:00.000Z", kind: "in", confirmed: true })).not.toHaveProperty("confirmed");
    expect(() => validatePunch({ id: "x", agreementId: AID, at: "2026-10-15T03:00:00.000Z", kind: "out", confirmed: "yes" })).toThrow(/Confirmed/);
    expect(updatePunch(c, "p2", { at: "2026-10-15T04:00:00.000Z" }).punches.find((p) => p.id === "p2")).not.toHaveProperty("confirmed");
    expect(updatePunch(c, "p1", { at: "2026-10-14T12:00:00.000Z" }).punches.find((p) => p.id === "p2")).not.toHaveProperty("confirmed");
  });
});
