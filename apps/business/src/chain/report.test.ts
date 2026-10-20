import { describe, expect, it } from "vitest";
import { type Report, validateReport } from "../books/report";
import { LETTERS_PROGRAM, LETTER_FIELDS, PAGE_FIELDS, letterCall } from "./letters";
import { openReports, packReport, reportLookup, unpackReport } from "./report";

const ACCOUNT = "aleo1s8t86aza932zah3mv5knclvnn5zy4gedpl5a4wn5h2yrt08mxqzsw5amdd";
const REPORTER = `aleo1${"q".repeat(58)}`;

const make = (id: string, text = "Send gift cards.", reportedAt = "2026-10-20T21:00:00.000Z"): Report =>
  validateReport({
    version: 1,
    id,
    category: "scam",
    note: "",
    reportedAt,
    place: "conversation",
    about: { name: "Copper Framing" },
    message: { id: "cd".repeat(16), sentAt: "2026-10-20T20:00:00.000Z", text },
  });

/** A record as Shield returns it, from the call the app would make. */
function recordOf(inputs: string[], fn: string, extra: Record<string, unknown> = {}) {
  const page = fn === "send_page";
  return { recordName: page ? "Page" : "Letter", recordPlaintext: `{ owner: ${ACCOUNT}.private, lookup: ${inputs[1]!.replace(/u128/g, "u128.private")}, ${page ? "page" : "parcel"}: ${inputs[2]!.replace(/field/g, "field.private")} }`, ...extra };
}

describe("reports as letters", () => {
  it("gets a lookup of its own for every report", async () => {
    const a = await reportLookup("ab".repeat(16));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await reportLookup("ab".repeat(16))).toBe(a);
    expect(await reportLookup("ac".repeat(16))).not.toBe(a);
    await expect(reportLookup("nope")).rejects.toThrow("needs an id");
  });

  it("comes back out of its letter whole", async () => {
    const r = make("ab".repeat(16));
    const lookup = await reportLookup(r.id);
    expect(await unpackReport(lookup, await packReport(r))).toEqual(r);
  });

  it("is ignored under someone else's lookup, or when it isn't a report", async () => {
    const r = make("ab".repeat(16));
    const parcel = await packReport(r);
    expect(await unpackReport(await reportLookup("ac".repeat(16)), parcel)).toBeNull();
    expect(await unpackReport(await reportLookup(r.id), new TextEncoder().encode('{"version":1}'))).toBeNull();
    const broken = parcel.slice();
    broken[broken.length - 1] = broken.at(-1)! ^ 0xff;
    expect(await unpackReport(await reportLookup(r.id), broken)).toBeNull();
  });

  it("goes as a page when the message is long", async () => {
    const long = make("ab".repeat(16), Array.from({ length: 400 }, (_, i) => `w${i * 7919}`).join(" "));
    const call = letterCall(ACCOUNT, await reportLookup(long.id), await packReport(long));
    expect(call.program).toBe(LETTERS_PROGRAM);
    expect(call.function).toBe("send_page");
  });

  it("are read from the account's letters, newest first, with who sent each", async () => {
    const older = make("ab".repeat(16), "First.", "2026-10-19T09:00:00.000Z");
    const newer = make("ac".repeat(16), "Second.", "2026-10-20T09:00:00.000Z");
    const recs: unknown[] = [];
    for (const r of [older, newer]) {
      const call = letterCall(ACCOUNT, await reportLookup(r.id), await packReport(r));
      recs.push(recordOf(call.inputs, call.function, { sender: REPORTER, transactionId: "at1x" }));
    }
    // An ordinary letter in the same account is skipped.
    const plain = letterCall(ACCOUNT, "11".repeat(32), new Uint8Array([1, 2, 3]));
    recs.push(recordOf(plain.inputs, plain.function));
    const got = await openReports(async (program) => (program === LETTERS_PROGRAM ? recs : []));
    expect(got.map((g) => g.report.id)).toEqual([newer.id, older.id]);
    expect(got[0]).toMatchObject({ reporter: REPORTER, transactionId: "at1x" });
    expect(LETTER_FIELDS).toBeLessThan(PAGE_FIELDS);
  });
});
