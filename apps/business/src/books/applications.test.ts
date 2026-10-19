import { describe, expect, it } from "vitest";
import { type Application, addApplication, applicationFor, applicationStatus, emptyWork, updateWorkThread, workFromJson, workToJson } from "./work";
import { type ThreadItem, validateMessage } from "./thread";

const KEY = "ab".repeat(32);
const app: Application = { postingId: "42", employerNameHash: "777", employerName: "dayco", employerAddress: "aleo1" + "q".repeat(58), title: "Line cook", partiesKey: KEY, sentAt: "2026-10-19T12:00:00.000Z" };
const item = (from: "worker" | "business", body: ThreadItem["body"], seq: number, mine: boolean): ThreadItem => ({ ...validateMessage({ version: 1, id: `${seq}`.padStart(32, "0"), from, sentAt: `2026-10-19T12:0${seq}:00.000Z`, body }, from), mine, seq });

describe("application messages", () => {
  it("come from the person, with a name, a posting and a resume; statuses from the business", () => {
    const body = { type: "application", postingId: "42", name: " kufre ", nameHash: "1", message: " hi ", resume: " My resume. " } as const;
    expect(validateMessage({ version: 1, id: "a".repeat(32), from: "worker", sentAt: "2026-10-19T12:00:00.000Z", body }, "worker").body).toEqual({ ...body, name: "kufre", message: "hi", resume: "My resume." });
    expect(() => validateMessage({ version: 1, id: "a".repeat(32), from: "business", sentAt: "2026-10-19T12:00:00.000Z", body }, "business")).toThrow(/can't send/);
    expect(() => validateMessage({ version: 1, id: "a".repeat(32), from: "worker", sentAt: "2026-10-19T12:00:00.000Z", body: { ...body, resume: " " } }, "worker")).toThrow(/needs a resume/);
    expect(() => validateMessage({ version: 1, id: "a".repeat(32), from: "worker", sentAt: "2026-10-19T12:00:00.000Z", body: { ...body, postingId: "0" } }, "worker")).toThrow(/name its posting/);
    expect(() => validateMessage({ version: 1, id: "a".repeat(32), from: "worker", sentAt: "2026-10-19T12:00:00.000Z", body: { ...body, resume: "x".repeat(15_001) } }, "worker")).toThrow(/at most 15,000/);
    const status = { type: "application_status", postingId: "42", status: "interviewing" } as const;
    expect(validateMessage({ version: 1, id: "b".repeat(32), from: "business", sentAt: "2026-10-19T12:00:00.000Z", body: status }, "business").body).toEqual(status);
    expect(() => validateMessage({ version: 1, id: "b".repeat(32), from: "worker", sentAt: "2026-10-19T12:00:00.000Z", body: status }, "worker")).toThrow(/can't send/);
    expect(() => validateMessage({ version: 1, id: "b".repeat(32), from: "business", sentAt: "2026-10-19T12:00:00.000Z", body: { ...status, status: "ghosted" } }, "business")).toThrow(/isn't one this app knows/);
  });
});

describe("the person's applications", () => {
  it("are kept one per posting, newest first, and survive the vault", () => {
    let work = addApplication(emptyWork("Kufre"), app);
    work = addApplication(work, { ...app, postingId: "43", title: "Dishwasher", sentAt: "2026-10-20T12:00:00.000Z" });
    work = addApplication(work, { ...app, title: "Line cook (nights)" });
    expect(work.applications?.map((a) => [a.postingId, a.title])).toEqual([
      ["43", "Dishwasher"],
      ["42", "Line cook (nights)"],
    ]);
    expect(workFromJson(workToJson(work))).toEqual(work);
    expect(applicationFor(work, "42")?.title).toBe("Line cook (nights)");
    expect(() => workFromJson(JSON.stringify({ ...work, applications: [{ ...app, partiesKey: "short" }] }))).toThrow(/needs its key/);
    expect(() => workFromJson(JSON.stringify({ ...work, applications: [app, app] }))).toThrow(/listed twice/);
  });
  it("read their status from the business's latest word in the thread", () => {
    let work = addApplication(emptyWork("Kufre"), app);
    expect(applicationStatus(work, app)).toBe("applied");
    const application = item("worker", { type: "application", postingId: "42", name: "kufre", nameHash: "1", message: "", resume: "r" }, 0, true);
    work = updateWorkThread(work, KEY, (t) => ({ ...t, items: [application], nextOut: 1 }));
    expect(applicationStatus(work, app)).toBe("applied");
    const seen = item("business", { type: "application_status", postingId: "42", status: "seen" }, 0, false);
    const interviewing = item("business", { type: "application_status", postingId: "42", status: "interviewing" }, 1, false);
    work = updateWorkThread(work, KEY, (t) => ({ ...t, items: [...t.items, seen, interviewing], nextIn: 2 }));
    expect(applicationStatus(work, app)).toBe("interviewing");
    expect(workThreadNext(work)).toEqual({ nextIn: 2, nextOut: 1 });
  });
});

const workThreadNext = (w: ReturnType<typeof emptyWork>) => ({ nextIn: w.threads?.[KEY]?.nextIn, nextOut: w.threads?.[KEY]?.nextOut });
