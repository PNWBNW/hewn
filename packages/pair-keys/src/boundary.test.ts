// The pair keys are cryptography only: no network, no chain package, nothing logged, and only the
// dependencies this package declares on purpose (README.md: why each, and its age).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SOURCES = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const text = (f: string) => readFileSync(join(ROOT, "src", f), "utf8");

describe("pair-keys boundary", () => {
  it("depends on the two noble libraries, pinned, and the vault's word list only", () => {
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies).toEqual({ "@noble/hashes": "2.4.0", "@noble/post-quantum": "0.7.1", "@pnw/vault": "workspace:*" });
  });

  it("imports nothing else, and from the vault only its word list", () => {
    for (const f of SOURCES) {
      for (const [, spec] of text(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        expect(spec!, f).toMatch(/^(\.\/[a-z_]+|@noble\/hashes\/(hkdf|sha2)\.js|@noble\/post-quantum\/ml-kem\.js|@pnw\/vault\/passphrase-words)$/);
      }
    }
  });

  it("never touches the network or the console", () => {
    for (const f of SOURCES) {
      expect(text(f), f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|\bconsole\./);
    }
  });
});
