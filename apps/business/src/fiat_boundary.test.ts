// Fiat first: the business app must run with no wallet, no network and no
// chain package loaded (CLAUDE.md, "Boundaries"). And a fiat user never sees
// chain vocabulary until they choose to turn anchoring on (BUILD_PLAN.md,
// Phase 1 headless mode). These checks fail the build if either slips.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..");
const SRC = join(APP_ROOT, "src");

const CHAIN_PACKAGES = [
  "@pnw/wallet",
  "@pnw/pnw-adapter",
  "@pnw/coordinator",
  "@pnw/records",
  "aleo-adapters",
];
const CHAIN_SCOPES = ["@provablehq/"];

const CHAIN_WORDS = /\b(blockchain|aleo|on-?chain|crypto(currency)?|wallet|usdcx|fiat|token|nft)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const isChain = (spec: string) =>
  CHAIN_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`)) ||
  CHAIN_SCOPES.some((s) => spec.startsWith(s));

describe("fiat boundary", () => {
  it("declares no chain package as a dependency", () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter(isChain)).toEqual([]);
  });

  it("imports no chain package from source", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
      return specs.filter(isChain).map((spec) => `${relative(APP_ROOT, file)}: ${spec}`);
    });
    expect(offenders).toEqual([]);
  });

  it("shows no chain vocabulary to a fiat user", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => CHAIN_WORDS.test(line))
        .map(({ line, n }) => `${relative(APP_ROOT, file)}:${n}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
