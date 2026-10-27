import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { companyFromJson, companyToJson, emptyCompany } from "../books/company";
import { costLine, privateFeeNote } from "./ChainBackup";

describe("backing up with the account", () => {
  it("says to turn private fees off on testnet, where Shield covers the fee (Joshua, 2026-10-27)", () => {
    expect(privateFeeNote("testnet", "private")).toMatch(/Pay network fees privately/);
    expect(privateFeeNote("testnet", "public")).toBeNull();
    expect(privateFeeNote("mainnet", "private")).toBeNull();
  });

  it("says what a backup costs before anything is signed (Joshua, 2026-10-26)", () => {
    expect(costLine({ letters: 1, fullPages: 0, fee: 0.0066, pages: [{}] as never })).toBe(
      "1 letter, 1 approval in Shield, about 0.0066 ALEO in fees (none when Shield's sponsor pays)",
    );
    expect(costLine({ letters: 1, fullPages: 2, fee: 0.1804, pages: [{}, {}, {}] as never })).toBe(
      "1 letter and 2 pages, 3 approvals in Shield, about 0.1804 ALEO in fees (none when Shield's sponsor pays)",
    );
  });

  it("keeps where the chain stands in the vault, and refuses a damaged one", () => {
    const chainBackup = { chain: 1, seq: 3, mark: { state: "a".repeat(64), entries: 12, sections: { books: "b".repeat(64), payroll: "c".repeat(64) } }, snapshotBytes: 4000, changeBytes: 900, changes: 3 };
    const c = { ...emptyCompany(createBooks({ businessName: "T", fiscalYearStartMonth: 1 })), chainBackup };
    expect(companyFromJson(companyToJson(c)).chainBackup).toEqual(chainBackup);
    const damaged = JSON.parse(companyToJson(c));
    damaged.chainBackup = JSON.stringify({ ...chainBackup, seq: -1 });
    expect(() => companyFromJson(JSON.stringify(damaged))).toThrow(/backup's place/);
  });
});
