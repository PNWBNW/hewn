// The mailbox is shared by every mode: hashing only, no workspace deps, no
// React, and the network only ever from client.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const ALLOWED_DEPS = ["@noble/hashes"];
const NETWORK = /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/;

const sources = () => readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("mailbox boundary", () => {
  it("depends on nothing but hashing", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(ALLOWED_DEPS);
    expect(pkg.devDependencies ?? {}).toEqual({});
  });

  it("imports only its own modules and @noble/hashes", () => {
    const bad: string[] = [];
    for (const f of sources()) {
      const text = readFileSync(join(ROOT, "src", f), "utf8");
      for (const [, spec] of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        if (!spec!.startsWith("./") && !spec!.startsWith("@noble/hashes/")) bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("touches the network only in client.ts", () => {
    for (const f of sources()) {
      const text = readFileSync(join(ROOT, "src", f), "utf8");
      if (f === "client.ts") expect(text).toMatch(/\bfetch\(/);
      else expect(text, f).not.toMatch(NETWORK);
    }
  });
});
