import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "../books/thread";
import { applicantKey, applicationItem, applicationLookup, businessKey, newHiringKey, packApplication, unpackApplication } from "./applications";
import { PAGE_BYTES } from "./letters";

const message = (postingId: string, extra: Partial<Extract<ThreadMessage["body"], { type: "application" }>> = {}): ThreadMessage => ({
  version: 1,
  id: "a".repeat(32),
  from: "worker",
  sentAt: "2026-10-19T12:00:00.000Z",
  body: { type: "application", postingId, name: "kufre", nameHash: "123456", message: "I'd like to apply.", resume: "KUFRE\nSoftware programmer, 4 years.", ...extra },
});

describe("the application key", () => {
  it("is the same from both sides, and different for another applicant or posting", async () => {
    const hiring = await newHiringKey();
    const a = await applicantKey(hiring.publicKey, "42");
    expect(a.partiesKey).toMatch(/^[0-9a-f]{64}$/);
    expect(await businessKey(hiring, a.oneTimePublicKey, "42")).toBe(a.partiesKey);
    const b = await applicantKey(hiring.publicKey, "42");
    expect(b.partiesKey).not.toBe(a.partiesKey);
    expect(await businessKey(hiring, a.oneTimePublicKey, "43")).not.toBe(a.partiesKey);
    const other = await newHiringKey();
    expect(await businessKey(other, a.oneTimePublicKey, "42")).not.toBe(a.partiesKey);
  });
  it("refuses a bad key or posting id", async () => {
    const hiring = await newHiringKey();
    await expect(applicantKey("04ab", "42")).rejects.toThrow(/hiring key/);
    await expect(applicantKey(hiring.publicKey, "0")).rejects.toThrow(/posting id/);
    await expect(businessKey(hiring, "nope", "42")).rejects.toThrow(/applicant's key/);
  });
  it("addresses every application to a posting at one lookup", async () => {
    expect(await applicationLookup("42")).toMatch(/^[0-9a-f]{64}$/);
    expect(await applicationLookup("42")).toBe(await applicationLookup("42"));
    expect(await applicationLookup("43")).not.toBe(await applicationLookup("42"));
    await expect(applicationLookup("x")).rejects.toThrow(/posting id/);
  });
});

describe("an application letter", () => {
  it("opens for the business with the posting's key, and for nobody else", async () => {
    const hiring = await newHiringKey();
    const { partiesKey, oneTimePublicKey } = await applicantKey(hiring.publicKey, "42");
    const parcel = await packApplication(partiesKey, oneTimePublicKey, message("42"));
    expect(parcel.length).toBeLessThanOrEqual(PAGE_BYTES);
    const opened = await unpackApplication(hiring, "42", parcel);
    expect(opened.partiesKey).toBe(partiesKey);
    expect(opened.oneTimePublicKey).toBe(oneTimePublicKey);
    expect(opened.message).toEqual(message("42"));
    await expect(unpackApplication(await newHiringKey(), "42", parcel)).rejects.toThrow(/couldn't be opened/);
    await expect(unpackApplication(hiring, "43", parcel)).rejects.toThrow(/couldn't be opened/);
    const tampered = new Uint8Array(parcel);
    tampered.set([tampered[tampered.length - 1]! ^ 1], tampered.length - 1);
    await expect(unpackApplication(hiring, "42", tampered)).rejects.toThrow(/couldn't be opened/);
    await expect(unpackApplication(hiring, "42", parcel.subarray(0, 40))).rejects.toThrow(/isn't an application/);
  });
  it("carries a long resume, deflated, and refuses what still won't fit", async () => {
    const hiring = await newHiringKey();
    const { partiesKey, oneTimePublicKey } = await applicantKey(hiring.publicKey, "42");
    const resume = "Cooked, cleaned, closed. ".repeat(580); // 14,500 chars
    const parcel = await packApplication(partiesKey, oneTimePublicKey, message("42", { resume }));
    expect((await unpackApplication(hiring, "42", parcel)).message.body.resume).toBe(resume.trim());
    let s = "";
    for (let i = 0; i < 9000; i++) s += String.fromCharCode(0x4e00 + ((i * 7919) % 20000));
    await expect(packApplication(partiesKey, oneTimePublicKey, message("42", { resume: s }))).rejects.toThrow(/too long/);
  });
  it("only packs an application from the person's side", async () => {
    const hiring = await newHiringKey();
    const { partiesKey, oneTimePublicKey } = await applicantKey(hiring.publicKey, "42");
    await expect(packApplication(partiesKey, oneTimePublicKey, { ...message("42"), body: { type: "text", text: "hi" } })).rejects.toThrow(/isn't an application/);
    await expect(packApplication(partiesKey, oneTimePublicKey, { ...message("42"), from: "business" })).rejects.toThrow(/isn't an application/);
  });
  it("is slot 0 of the person's side in the thread", () => {
    expect(applicationItem(message("42"), true)).toEqual({ ...message("42"), mine: true, seq: 0 });
    expect(applicationItem(message("42"), false, "2026-10-19T13:00:00.000Z").receivedAt).toBe("2026-10-19T13:00:00.000Z");
  });
});
