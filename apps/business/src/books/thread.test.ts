import { describe, expect, it } from "vitest";
import {
  type Proposal,
  type ThreadItem,
  addToThread,
  answerFor,
  draftOf,
  emptyThread,
  openCounter,
  proposalChanges,
  proposalFromDraft,
  proposalOf,
  revisedFrom,
  skipIncoming,
  syncTermsText,
  validateMessage,
  validateProposal,
  validateThread,
} from "./thread";

const A = "aa".repeat(32);
const B = "bb".repeat(32);
const LETTER = { description: "Framing crew.", requirements: "", handbook: "", other: "" };
const OFFERED: Proposal = { payType: "hourly", rate: "3000", frequency: "biweekly", startDate: "2026-11-02", termsText: "Carpenter. Pay: $30.00 an hour, paid every two weeks. Starts November 2, 2026.", letter: LETTER };
const ASKED: Proposal = { ...OFFERED, rate: "3400", startDate: "2026-11-09", letter: { ...LETTER, other: "Dental from day one." } };
const id = (n: number) => n.toString(16).padStart(32, "0");

const msg = (n: number, from: "business" | "worker", body: unknown, at = `2026-10-16T1${n}:00:00.000Z`) => ({ version: 1, id: id(n), from, sentAt: at, body });
const item = (n: number, from: "business" | "worker", body: unknown, mine: boolean, seq: number): ThreadItem => ({ ...(msg(n, from, body) as ThreadItem), mine, seq });

describe("thread messages", () => {
  it("are checked field by field, and each side may only send its own kinds", () => {
    const counter = msg(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "Could we do 34?" });
    expect(validateMessage(counter, "worker").body).toEqual({ type: "counter", agreementId: A, proposal: ASKED, note: "Could we do 34?" });
    expect(() => validateMessage(counter, "business")).toThrow(/wrong side/);
    expect(() => validateMessage(msg(2, "business", { type: "counter", agreementId: A, proposal: ASKED, note: "" }), "business")).toThrow(/can't send/);
    expect(() => validateMessage(msg(3, "worker", { type: "stands", agreementId: A, note: "" }), "worker")).toThrow(/can't send/);
    expect(validateMessage(msg(4, "business", { type: "revised", agreementId: A, newAgreementId: B, note: "Met you halfway." }), "business").body.type).toBe("revised");
  });

  it("refuse anything malformed", () => {
    const ok = msg(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "" });
    for (const bad of [
      { ...ok, version: 2 },
      { ...ok, id: "short" },
      { ...ok, sentAt: "later" },
      { ...ok, body: { ...ok.body as object, type: "hello" } },
      { ...ok, body: { type: "counter", agreementId: "nope", proposal: ASKED, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: ASKED, note: "x".repeat(2001) } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, rate: "-5" }, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, rate: "30.00" }, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, payType: "daily" }, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, frequency: "yearly" }, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, startDate: "soon" }, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, termsText: "  " }, note: "" } },
      { ...ok, body: { type: "counter", agreementId: A, proposal: { ...ASKED, letter: { description: 1 } }, note: "" } },
      "a message",
    ]) {
      expect(() => validateMessage(bad, "worker")).toThrow();
    }
    expect(validateProposal({ ...ASKED, extra: "dropped" })).toEqual(ASKED);
  });
});

describe("a thread", () => {
  it("keeps a message once, and moves each side's slot past what it has", () => {
    let t = emptyThread();
    t = addToThread(t, item(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "" }, false, 0));
    t = addToThread(t, item(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "" }, false, 0));
    t = addToThread(t, item(2, "business", { type: "stands", agreementId: A, note: "Budget's set." }, true, 0));
    expect(t.items).toHaveLength(2);
    expect(t.nextIn).toBe(1);
    expect(t.nextOut).toBe(1);
    expect(skipIncoming(t, 4).nextIn).toBe(5);
    expect(validateThread(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(() => validateThread({ ...t, nextIn: -1 })).toThrow();
  });

  it("knows which request is still waiting, how it was answered, and which offer a revision replaced", () => {
    let t = emptyThread();
    t = addToThread(t, item(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "" }, false, 0));
    expect(openCounter(t, A)?.id).toBe(id(1));
    expect(openCounter(t, B)).toBeUndefined();
    t = addToThread(t, item(2, "business", { type: "revised", agreementId: A, newAgreementId: B, note: "" }, true, 0));
    expect(openCounter(t, A)).toBeUndefined();
    expect(answerFor(t, A)?.body.type).toBe("revised");
    expect(revisedFrom(t, B)).toBe(A);
    t = addToThread(t, item(3, "worker", { type: "counter", agreementId: B, proposal: ASKED, note: "One more thing" }, false, 1));
    expect(openCounter(t, B)?.id).toBe(id(3));
    t = addToThread(t, item(4, "business", { type: "stands", agreementId: B, note: "" }, true, 1));
    expect(openCounter(t, B)).toBeUndefined();
    expect(answerFor(t, B)?.body.type).toBe("stands");
  });
});

describe("what a counter-offer changes", () => {
  it("lists each changed field as was → wants, in the offer's order", () => {
    expect(proposalChanges(OFFERED, ASKED)).toEqual([
      { field: "rate", label: "Pay", was: "$30.00 an hour", wants: "$34.00 an hour" },
      { field: "startDate", label: "Start date", was: "2026-11-02", wants: "2026-11-09" },
      { field: "letter.other", label: "Anything else", was: "", wants: "Dental from day one." },
    ]);
    expect(proposalChanges(OFFERED, OFFERED)).toEqual([]);
    expect(proposalChanges(OFFERED, { ...OFFERED, payType: "salary", rate: "6500000", frequency: "monthly" }).map((c) => c.wants)).toEqual(["$65,000.00 a year", "Every month"]);
  });

  it("starts from the offer's terms, and keeps the written pay and start date in step", () => {
    expect(proposalOf({ payType: "hourly", rate: "3000", frequency: "biweekly", startDate: "2026-11-02", termsText: "x" }).letter).toEqual({ description: "", requirements: "", handbook: "", other: "" });
    const text = syncTermsText(OFFERED.termsText, OFFERED, ASKED);
    expect(text).toBe("Carpenter. Pay: $34.00 an hour, paid every two weeks. Starts November 9, 2026.");
    expect(syncTermsText("Our own words.", OFFERED, ASKED)).toBe("Our own words.");
  });

  it("comes from a form with the pay typed in dollars", () => {
    const d = draftOf(OFFERED);
    expect(d.rateText).toBe("30.00");
    expect(proposalFromDraft({ ...d, rateText: "34.5" })).toEqual({ proposal: { ...OFFERED, rate: "3450" } });
    expect(proposalFromDraft({ ...d, rateText: "lots" })).toEqual({ problem: expect.stringMatching(/amount/) });
    expect(proposalFromDraft({ ...d, rateText: "0" })).toEqual({ problem: expect.stringMatching(/more than zero/) });
    expect(proposalFromDraft({ ...d, termsText: " " })).toEqual({ problem: expect.stringMatching(/empty/) });
    expect(proposalFromDraft({ ...d, startDate: "" })).toEqual({ problem: expect.stringMatching(/start date/) });
  });
});
