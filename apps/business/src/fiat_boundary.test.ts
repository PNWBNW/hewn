// The books without the chain: the ledger core, the vault, the reports and
// payroll run with no chain package loaded, and screens outside src/chain
// carry no chain vocabulary (CLAUDE.md, "Boundaries"). Every account links
// Shield at setup since 2026-10-15 (the old "fiat first" rule is retired), but
// the books still open and work offline without it.
//
// The chain adaptor lives in src/chain and is the only code allowed to import
// a chain package or use chain words. Everything else reaches it through a
// dynamic `import("@/chain/...")`, so a user who never taps Connect never
// downloads it. The chain packages may be declared in package.json; what is
// checked is that nothing outside src/chain statically imports them.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..");
const SRC = join(APP_ROOT, "src");
const CHAIN_DIR = join(SRC, "chain") + sep;
// The terms and the privacy page say plainly what goes on chain and what the wallet does (2026-10-22).
const LEGAL_DIR = join(SRC, "legal") + sep;

const CHAIN_PACKAGES = [
  "@pnw/wallet",
  "@pnw/pnw-adapter",
  "@pnw/rail",
  "@pnw/records",
  "@pnw/config",
  "@pnw/commitments",
  "@pnw/handshake",
  "aleo-adapters",
];
const CHAIN_SCOPES = ["@provablehq/", "@/chain/"];

// `crypto.` is the browser's WebCrypto API, not chain vocabulary.
const CHAIN_WORDS = /\b(blockchain|aleo|on-?chain|crypto(currency)?(?!\.)|wallet|usdcx|fiat|token|nft)\b/i;

// Static imports only: `import x from "spec"`, `export { x } from "spec"`, `import "spec"`.
// A dynamic `import("spec")` is the one allowed door into src/chain.
const STATIC_IMPORT = /\b(?:from|import)\s+["']([^"']+)["']/g;

function sourceFiles(dir: string, { tests = false } = {}): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, { tests });
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return tests || !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const outsideChain = (files: string[]) => files.filter((f) => !f.startsWith(CHAIN_DIR));

const isChain = (spec: string) =>
  CHAIN_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`)) ||
  CHAIN_SCOPES.some((s) => spec.startsWith(s)) ||
  spec === "@/chain";

describe("fiat boundary", () => {
  it("statically imports no chain package, and nothing from src/chain, outside src/chain", () => {
    const offenders = outsideChain(sourceFiles(SRC, { tests: true })).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const specs = [...text.matchAll(STATIC_IMPORT)].map((m) => m[1]!);
      return specs.filter(isChain).map((spec) => `${relative(APP_ROOT, file)}: ${spec}`);
    });
    expect(offenders).toEqual([]);
  });

  it("shows no chain vocabulary to a fiat user", () => {
    const offenders = outsideChain(sourceFiles(SRC)).filter((f) => !f.startsWith(LEGAL_DIR)).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => CHAIN_WORDS.test(line))
        .map(({ line, n }) => `${relative(APP_ROOT, file)}:${n}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
