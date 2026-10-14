// Payroll is chain-free (CLAUDE.md, "Fiat first"): the ledger, the tax engine, and hashing for the paystub document.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("payroll boundary", () => {
  it("depends only on the ledger, the tax engine and hashing", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies)).toEqual(["@noble/hashes", "@pnw/ledger", "@pnw/tax-engine"]);
  });
});
