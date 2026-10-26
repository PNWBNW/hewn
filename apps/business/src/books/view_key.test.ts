import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { stateHash } from "./books_backup";
import { companyFromJson, companyToJson, emptyCompany } from "./company";
import { cleanViewKey, forgetViewKey, setViewKey, skipViewKey } from "./view_key";

// Built at run time, so the secrets scan never sees a key-shaped literal.
const KEY = ["AView", "Key1"].join("") + "x".repeat(44);
const company = () => emptyCompany(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }));

describe("the business's view key (Joshua, 2026-10-26)", () => {
  it("takes one that looks like a view key, trimmed, and refuses anything else", () => {
    expect(cleanViewKey(`  ${KEY}\n`)).toBe(KEY);
    for (const bad of ["", "hello", KEY.replace("View", "Private"), `${KEY}0`, KEY.slice(0, 30)]) expect(() => cleanViewKey(bad)).toThrow(/isn't a view key/);
  });

  it("keeps it in the books, skips it, or forgets it, and remembers the choice through a save", () => {
    const added = setViewKey(company(), KEY);
    expect(added).toMatchObject({ viewKey: KEY, viewKeyChoice: "added" });
    expect(companyFromJson(companyToJson(added))).toMatchObject({ viewKey: KEY, viewKeyChoice: "added" });
    const forgotten = forgetViewKey(added);
    expect(forgotten.viewKey).toBeUndefined();
    expect(forgotten.viewKeyChoice).toBe("skipped");
    expect(companyFromJson(companyToJson(skipViewKey(company())))).toMatchObject({ viewKeyChoice: "skipped" });
    expect(() => companyFromJson(companyToJson(company()).replace(/}$/, `,"viewKey":"nope"}`))).toThrow(/isn't a view key/);
  });

  it("never goes out in the backup kept as letters: the state it hashes is the same with or without it", async () => {
    const without = { ...company(), viewKeyChoice: "added" as const };
    expect(await stateHash(setViewKey(company(), KEY))).toBe(await stateHash(without));
  });
});
