// The ledger core is shared by every mode, so it must stay chain-free (CLAUDE.md, "Fiat first").
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const ALLOWED_DEPS = ["@noble/hashes"];

describe("ledger boundary", () => {
  it("depends on nothing but hashing", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(ALLOWED_DEPS);
  });

  it("imports only its own modules and @noble/hashes", () => {
    const bad: string[] = [];
    for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const text = readFileSync(join(ROOT, "src", f), "utf8");
      for (const [, spec] of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        if (!spec!.startsWith("./") && !spec!.startsWith("@noble/hashes/")) bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
