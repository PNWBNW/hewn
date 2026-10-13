// Fiat payroll is chain-free (CLAUDE.md, "Fiat first").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("payroll boundary", () => {
  it("depends only on the ledger and the tax engine", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies)).toEqual(["@pnw/ledger", "@pnw/tax-engine"]);
  });
});
