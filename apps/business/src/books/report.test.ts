import { describe, expect, it } from "vitest";
import { type Report, notifiesSender, reportMailto, reportText, validateReport } from "./report";
import { type ThreadItem, addToThread, emptyThread, markReported, preview, validateMessage, validateThread } from "./thread";

const ID = "ab".repeat(16);
const MSG = "cd".repeat(16);
const ACCOUNT = "aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd";

const report = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  id: ID,
  category: "scam",
  note: "  Asked me for gift cards.  ",
  reportedAt: "2026-10-20T21:00:00.000Z",
  place: "conversation",
  about: { name: "Copper Framing", account: ACCOUNT },
  message: { id: MSG, sentAt: "2026-10-20T20:00:00.000Z", text: "Send $200 in gift cards before your first shift." },
  ...over,
});

describe("a report", () => {
  it("checks out and comes back clean", () => {
    const r = validateReport(report());
    expect(r.note).toBe("Asked me for gift cards.");
    expect(r.about).toEqual({ name: "Copper Framing", account: ACCOUNT });
  });

  it("refuses what an app couldn't have made", () => {
    expect(() => validateReport(report({ category: "rude" }))).toThrow("Pick what's wrong");
    expect(() => validateReport(report({ id: "xyz" }))).toThrow("needs an id");
    expect(() => validateReport(report({ place: "board" }))).toThrow("where the message came");
    expect(() => validateReport(report({ about: { name: " " } }))).toThrow("who sent the message");
    expect(() => validateReport(report({ about: { name: "A", account: "aleo1nope" } }))).toThrow("account isn't valid");
    expect(() => validateReport(report({ message: { id: MSG, sentAt: "2026-10-20T20:00:00.000Z", text: "x".repeat(4_001) } }))).toThrow("too long");
    expect(() => validateReport(report({ note: "x".repeat(1_001) }))).toThrow("at most 1,000");
    expect(() => validateReport(report({ version: 2 }))).toThrow("version");
  });

  it("tells the sender about anything but harassment", () => {
    expect(notifiesSender("harassment")).toBe(false);
    for (const c of ["not_them", "scam", "spam", "threat", "other"] as const) expect(notifiesSender(c)).toBe(true);
  });

  it("reads as text, and as an email that names the report", () => {
    const r: Report = validateReport(report());
    const text = reportText(r);
    expect(text).toContain(`Report ${ID}`);
    expect(text).toContain("A scam or a request for money");
    expect(text).toContain(`Copper Framing (${ACCOUNT})`);
    expect(text).toContain("Note:\nAsked me for gift cards.");
    const mail = reportMailto(r, "hewnsupport@gmail.com");
    expect(mail.startsWith("mailto:hewnsupport@gmail.com?subject=")).toBe(true);
    expect(decodeURIComponent(mail.split("&body=")[1]!)).toBe(text);
  });

  it("cuts a long email short, and says the copy has the rest", () => {
    const r = validateReport(report({ message: { id: MSG, sentAt: "2026-10-20T20:00:00.000Z", text: "word ".repeat(700) } }));
    const body = decodeURIComponent(reportMailto(r, "hewnsupport@gmail.com").split("&body=")[1]!);
    expect(body.length).toBeLessThan(2_000);
    expect(body).toContain("paste the copied report");
  });
});

const theirs = (over: Partial<ThreadItem> = {}): ThreadItem => ({
  ...validateMessage({ version: 1, id: MSG, from: "business", sentAt: "2026-10-20T20:00:00.000Z", body: { type: "text", text: "Send gift cards." } }, "business"),
  mine: false,
  seq: 0,
  ...over,
});

describe("reports in a thread", () => {
  it("marks their message reported once, and keeps the mark through the vault", () => {
    const t = addToThread(emptyThread(), theirs());
    const marked = markReported(t, MSG, { category: "harassment", at: "2026-10-20T21:00:00.000Z" });
    expect(marked.items[0]!.reported).toEqual({ category: "harassment", at: "2026-10-20T21:00:00.000Z" });
    expect(markReported(marked, MSG, { category: "spam", at: "2026-10-20T22:00:00.000Z" })).toBe(marked);
    expect(validateThread(JSON.parse(JSON.stringify(marked))).items[0]!.reported?.category).toBe("harassment");
  });

  it("never marks one of mine, and the vault refuses a mark on mine", () => {
    const mine = { ...theirs(), mine: true };
    const t = addToThread(emptyThread(), mine);
    expect(markReported(t, MSG, { category: "spam", at: "2026-10-20T21:00:00.000Z" })).toBe(t);
    expect(() => validateThread({ items: [{ ...mine, reported: { category: "spam", at: "2026-10-20T21:00:00.000Z" } }], nextIn: 0, nextOut: 1 })).toThrow("Only their messages");
  });

  it("carries a notice to the sender, but never for harassment", () => {
    const notice = validateMessage({ version: 1, id: ID, from: "worker", sentAt: "2026-10-20T21:00:00.000Z", body: { type: "report_notice", messageId: MSG, category: "not_them" } }, "worker");
    expect(preview({ ...notice, mine: false, seq: 1 })).toBe("Reported your message as not sent by you");
    expect(preview({ ...notice, mine: true, seq: 1 })).toBe("You reported their message as not sent by you");
    expect(() => validateMessage({ ...notice, body: { type: "report_notice", messageId: MSG, category: "harassment" } }, "worker")).toThrow("isn't one the sender is told about");
    expect(() => validateMessage({ ...notice, body: { type: "report_notice", messageId: "nope", category: "spam" } }, "worker")).toThrow("names the message");
  });
});
