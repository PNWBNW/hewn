import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { companyFromJson, companyToJson, emptyCompany } from "./company";
import { backupDue, dueHeadline, markBackedUp } from "./backup_reminder";

const books = () => emptyCompany(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }));
const at = (iso: string) => new Date(iso);

describe("reminding to save a backup", () => {
  it("asks for one when none was ever saved", () => {
    expect(backupDue(books(), at("2026-10-26T12:00:00Z"))).toEqual({ due: true, reason: "never" });
  });

  it("is quiet for a week after a backup, then asks again", () => {
    const c = markBackedUp(books(), "2026-10-20T12:00:00.000Z");
    expect(backupDue(c, at("2026-10-26T12:00:00Z"))).toEqual({ due: false });
    expect(backupDue(c, at("2026-10-27T11:59:59Z"))).toEqual({ due: false });
    expect(backupDue(c, at("2026-10-27T12:00:00Z"))).toEqual({ due: true, reason: "stale", days: 7 });
  });

  it("keeps the time in the vault's file, and ignores a damaged one", () => {
    const c = markBackedUp(books(), "2026-10-26T09:30:00.000Z");
    expect(companyFromJson(companyToJson(c)).backedUpAt).toBe("2026-10-26T09:30:00.000Z");
    expect(companyFromJson(companyToJson(books())).backedUpAt).toBeUndefined();
    const damaged = JSON.parse(companyToJson(c));
    damaged.backedUpAt = "not a date";
    expect(companyFromJson(JSON.stringify(damaged)).backedUpAt).toBeUndefined();
  });

  it("asks again after a pay run, and when a month is closed (Joshua, 2026-10-26)", () => {
    let c = markBackedUp(books(), "2026-10-26T09:00:00.000Z");
    const now = at("2026-10-26T12:00:00Z");
    expect(backupDue(c, now)).toEqual({ due: false });
    // A run's entry posted after the backup.
    const entry = { id: "je-1", postedAt: "2026-10-26T10:00:00.000Z" } as never;
    c = { ...c, books: { ...c.books, entries: [entry] }, payroll: { ...c.payroll, runs: [{ entryIds: ["je-1"] } as never] } };
    expect(backupDue(c, now)).toEqual({ due: true, reason: "pay_run" });
    expect(backupDue({ ...c, backedUpAt: "2026-10-26T11:00:00.000Z" }, now)).toEqual({ due: false });
    // A month closed after the backup.
    const closed = { ...c, backedUpAt: "2026-10-26T11:00:00.000Z", books: { ...c.books, events: [{ kind: "closed", through: "2026-10", at: "2026-10-26T11:30:00.000Z" }] } } as typeof c;
    expect(backupDue(closed, now)).toEqual({ due: true, reason: "closed", through: "2026-10" });
    expect(dueHeadline({ due: true, reason: "closed", through: "2026-10" })).toBe("You closed 2026-10 since your last backup");
    expect(dueHeadline({ due: true, reason: "pay_run" })).toBe("You ran payroll since your last backup");
  });
});
