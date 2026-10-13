// The vault is shared by every mode: no dependencies, no network, no chain code.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

describe("vault boundary", () => {
  it("has no runtime dependencies", () => {
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies ?? {}).toEqual({});
  });

  it("never touches the network", () => {
    for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const text = readFileSync(join(ROOT, "src", f), "utf8");
      expect(text, f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
    }
  });
});
