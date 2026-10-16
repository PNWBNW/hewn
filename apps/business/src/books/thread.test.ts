import { describe, expect, it } from "vitest";
import {
  type Proposal,
  type ThreadItem,
  addToThread,
  answerFor,
  draftOf,
  emptyThread,
  markDelivered,
  markThreadRead,
  preview,
  revisionOf,
  unreadIn,
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
const ASKED: Proposal = { ...OFFERED, rate: "3400", startDate: "2026-11-09", letter: { ...LETTER, description: "Framing crew. Dental from day one." } };
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
      { field: "letter", label: "Offer letter", was: "Framing crew.", wants: "Framing crew. Dental from day one." },
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

describe("plain messages", () => {
  it("either side may send, and they're never empty or too long", () => {
    expect(validateMessage(msg(1, "worker", { type: "text", text: "Running 10 min late" }), "worker").body).toEqual({ type: "text", text: "Running 10 min late" });
    expect(validateMessage(msg(2, "business", { type: "text", text: "No problem" }), "business").body.type).toBe("text");
    expect(() => validateMessage(msg(3, "worker", { type: "text", text: "   " }), "worker")).toThrow(/empty/);
    expect(() => validateMessage(msg(4, "worker", { type: "text", text: "x".repeat(4001) }), "worker")).toThrow(/at most/);
    expect(() => validateMessage(msg(5, "worker", { type: "text", text: 7 }), "worker")).toThrow(/empty/);
  });

  it("count as unread until the conversation is opened, and only theirs can be read", () => {
    let t = emptyThread();
    t = addToThread(t, item(1, "worker", { type: "text", text: "Hi" }, false, 0));
    t = addToThread(t, item(2, "worker", { type: "text", text: "Are we on for Monday?" }, false, 1));
    t = addToThread(t, item(3, "business", { type: "text", text: "Yes" }, true, 0));
    expect(unreadIn(t)).toBe(2);
    const read = markThreadRead(t);
    expect(unreadIn(read)).toBe(0);
    expect(markThreadRead(read)).toBe(read);
    expect(validateThread(JSON.parse(JSON.stringify(read)))).toEqual(read);
    expect(() => validateThread({ ...read, items: [{ ...read.items.find((i) => i.mine), read: true }] })).toThrow(/Only their messages/);
  });

  it("show as received once the other side's receipt arrives, the first time only", () => {
    let t = addToThread(emptyThread(), item(1, "business", { type: "text", text: "Payday moved to Thursday" }, true, 0));
    t = markDelivered(t, 0, "2026-10-17T08:00:00.000Z");
    expect(t.items[0]!.receivedAt).toBe("2026-10-17T08:00:00.000Z");
    expect(markDelivered(t, 0, "2026-10-18T08:00:00.000Z")).toBe(t);
    expect(markDelivered(t, 5, "2026-10-18T08:00:00.000Z")).toBe(t);
    expect(() => markDelivered(t, 0, "later")).toThrow();
  });

  it("read in a list as a few words", () => {
    expect(preview(undefined)).toBe("No messages yet");
    expect(preview(item(1, "worker", { type: "text", text: "Hi" }, false, 0))).toBe("Hi");
    expect(preview(item(1, "business", { type: "text", text: "x".repeat(100) }, true, 0))).toMatch(/^You: x{79}…$/);
    expect(preview(item(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "" }, false, 0))).toBe("Asked for changes to the offer");
    expect(preview(item(1, "business", { type: "revised", agreementId: A, newAgreementId: B, note: "" }, true, 0))).toBe("You sent a revised offer");
  });

  it("don't count as answers to an offer", () => {
    let t = addToThread(emptyThread(), item(1, "worker", { type: "counter", agreementId: A, proposal: ASKED, note: "" }, false, 0));
    t = addToThread(t, item(2, "business", { type: "text", text: "Let me think about it" }, true, 0));
    expect(openCounter(t, A)?.id).toBe(id(1));
    expect(answerFor(t, A)).toBeUndefined();
    t = addToThread(t, item(3, "business", { type: "revised", agreementId: A, newAgreementId: B, note: "Here you go" }, true, 1));
    expect(revisionOf(t, B)?.body.note).toBe("Here you go");
  });
});

describe("channel messages in a thread", () => {
  it("only the business sends them, with a real key", () => {
    const ok = { type: "channel", channelId: "c".repeat(16), name: "Everyone", epoch: 0, key: "1".repeat(64) };
    expect(validateMessage(msg(1, "business", ok), "business").body).toEqual(ok);
    expect(() => validateMessage(msg(2, "worker", ok), "worker")).toThrow(/can't send/);
    expect(() => validateMessage(msg(3, "business", { ...ok, key: "short" }), "business")).toThrow(/64 hex/);
    expect(() => validateMessage(msg(4, "business", { ...ok, channelId: "x" }), "business")).toThrow(/id/);
    expect(() => validateMessage(msg(5, "business", { ...ok, name: "" }), "business")).toThrow(/name/);
    expect(validateMessage(msg(6, "business", { type: "channel_left", channelId: "c".repeat(16), name: "Everyone" }), "business").body.type).toBe("channel_left");
    expect(preview(item(7, "business", ok, false, 0))).toBe("Added you to “Everyone”");
  });
});

describe("directory messages in a thread", () => {
  it("the person joins and leaves; the business passes on names and keys", () => {
    const key = "04" + "a".repeat(128);
    expect(validateMessage(msg(1, "worker", { type: "directory_join", name: " Ana ", publicKey: key }), "worker").body).toEqual({ type: "directory_join", name: "Ana", publicKey: key });
    expect(() => validateMessage(msg(2, "business", { type: "directory_join", name: "Ana", publicKey: key }), "business")).toThrow(/can't send/);
    expect(() => validateMessage(msg(3, "worker", { type: "directory_join", name: "Ana", publicKey: "04abc" }), "worker")).toThrow(/P-256/);
    expect(validateMessage(msg(4, "worker", { type: "directory_leave" }), "worker").body).toEqual({ type: "directory_leave" });
    expect(validateMessage(msg(5, "business", { type: "directory", entries: [{ name: "Ana", publicKey: key }] }), "business").body.type).toBe("directory");
    expect(() => validateMessage(msg(6, "business", { type: "directory", entries: [{ name: "Ana", publicKey: key }, { name: "Again", publicKey: key }] }), "business")).toThrow(/twice/);
    expect(() => validateMessage(msg(7, "worker", { type: "directory", entries: [] }), "worker")).toThrow(/can't send/);
  });
});

describe("group messages in a thread", () => {
  const a = "04" + "a".repeat(128);
  const b = "04" + "b".repeat(128);
  it("need an admin who is in the group, 2 to 25 people, and a real group id", () => {
    const ok = { type: "group", groupId: "1".repeat(16), name: "Lunch", admin: a, members: [{ name: "A", publicKey: a }, { name: "B", publicKey: b }] };
    expect(validateMessage(msg(1, "worker", ok), "worker").body.type).toBe("group");
    expect(() => validateMessage(msg(2, "worker", { ...ok, admin: "04" + "c".repeat(128) }), "worker")).toThrow(/admin/);
    expect(() => validateMessage(msg(3, "worker", { ...ok, members: [{ name: "A", publicKey: a }] }), "worker")).toThrow(/2 to 25/);
    expect(() => validateMessage(msg(4, "worker", { ...ok, members: [{ name: "A", publicKey: a }, { name: "A again", publicKey: a }] }), "worker")).toThrow(/twice/);
    expect(validateMessage(msg(5, "business", { type: "group_text", groupId: "1".repeat(16), text: "hi" }), "business").body.type).toBe("group_text");
    expect(() => validateMessage(msg(6, "worker", { type: "group_text", groupId: "x", text: "hi" }), "worker")).toThrow(/group/);
  });
});
