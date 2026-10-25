import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { companyFromJson, companyToJson, emptyCompany } from "./company";
import { backupDue, markBackedUp } from "./backup_reminder";

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
});
