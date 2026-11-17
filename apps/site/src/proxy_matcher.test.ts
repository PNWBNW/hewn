// The security policy is set per request by `src/proxy.ts`, so it reaches a
// page only if the proxy runs for that address. These tests compile the
// proxy's matcher the way `next build` does and check which addresses it
// covers: every page, the not-found page included, and only the framework's
// own built files, the image endpoint and the favicon left out.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

type Matcher = { source: string; missing?: unknown[] };
type Compiled = Matcher & { regexp: string };

// The build's own compiler (next/dist/build/analysis/get-page-static-info.js,
// `getMiddlewareMatchers`). It is exported by the module but not typed, so it
// is loaded with require and given its signature here.
const require = createRequire(import.meta.url);
const { getMiddlewareMatchers } = require("next/dist/build/analysis/get-page-static-info.js") as {
  getMiddlewareMatchers: (matcher: Matcher | Matcher[], nextConfig: Record<string, unknown>) => Compiled[];
};

// The compiler also reads basePath and i18n from next.config; this app sets
// neither, so an empty config compiles exactly what the build compiles.
const nextConfigSource = readFileSync(join(__dirname, "..", "next.config.ts"), "utf8");

const compiled = getMiddlewareMatchers(config.matcher, {});
const covered = (path: string) => compiled.some((m) => new RegExp(m.regexp).test(path));

describe("proxy matcher (the security policy's reach)", () => {
  it("is compiled with the same options as the build", () => {
    expect(nextConfigSource).not.toMatch(/\bbasePath\b/);
    expect(nextConfigSource).not.toMatch(/\bi18n\b/);
  });

  it.each([
    "/",
    "/privacy",
    "/nothere",
    "/favicon.icon",
    "/faviconXico",
    "/_next/imagex",
    "/_next/staticfoo",
    "/favicon.ico/x",
  ])("runs for %s", (path) => {
    expect(covered(path)).toBe(true);
  });

  it.each(["/_next/static/chunks/a.js", "/_next/static/css/app.css", "/_next/image", "/favicon.ico"])(
    "leaves out the asset %s",
    (path) => {
      expect(covered(path)).toBe(false);
    },
  );

  it("still skips prefetches", () => {
    for (const m of config.matcher) {
      expect(m.missing).toEqual([
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ]);
    }
  });
});
