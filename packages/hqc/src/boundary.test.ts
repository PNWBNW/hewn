// The package is the module and a thin wrapper: no dependency, no network (the module's bytes are
// in the package, never fetched), no console, nothing of Node's, so it runs the same in a browser.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SOURCES = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const text = (f: string) => readFileSync(join(ROOT, "src", f), "utf8");

describe("hqc boundary", () => {
  it("has the three sources it should", () => {
    expect(SOURCES.sort()).toEqual(["hqc5_wasm.ts", "index.ts", "module.ts"]);
  });

  it("depends on nothing", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.devDependencies ?? {}).toEqual({});
  });

  it("imports only its own files", () => {
    for (const f of SOURCES) {
      for (const [, spec] of text(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)) expect(spec!, f).toMatch(/^\.\/[a-z0-9_]+$/);
      expect(text(f), f).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    }
  });

  it("never fetches, streams, logs or reaches the file system", () => {
    for (const f of SOURCES) {
      expect(text(f), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|instantiateStreaming|compileStreaming|\bconsole\.|node:|localStorage|indexedDB/);
    }
  });

  it("instantiates the module with an empty import object", () => {
    expect(text("module.ts")).toMatch(/WebAssembly\.instantiate\(wasmBytes\(\), \{\}\)/);
  });
});
