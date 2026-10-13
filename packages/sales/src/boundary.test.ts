// Sales and purchases are chain-free (CLAUDE.md, "Fiat first").
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

describe("sales boundary", () => {
  it("depends only on the ledger", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies)).toEqual(["@pnw/ledger"]);
  });

  it("uses payroll only in tests (the project profitability check)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.devDependencies).filter((d) => d.startsWith("@pnw/"))).toEqual(["@pnw/payroll"]);
  });

  it("imports only its own modules and the ledger", () => {
    const bad: string[] = [];
    for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const text = readFileSync(join(ROOT, "src", f), "utf8");
      for (const [, spec] of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        if (!spec!.startsWith("./") && spec !== "@pnw/ledger") bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
