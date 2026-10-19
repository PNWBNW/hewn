// The marketing site is a brochure. It carries the brand, the shared security
// policy and the UI tokens, and nothing else: no ledger, no vault, no chain
// package, no third-party script. Its security policy names no host at all.
// The one runtime addition is Vercel Web Analytics (Joshua, 2026-10-19):
// aggregate page views, no cookies, served from the site's own address.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp } from "@pnw/security/headers";

const APP_ROOT = join(__dirname, "..");
const SRC = join(APP_ROOT, "src");

const ALLOWED_WORKSPACE = ["@pnw/brand", "@pnw/security", "@pnw/ui"];
const ALLOWED_THIRD_PARTY = ["@vercel/analytics", "lucide-react", "next", "react", "react-dom"];

const CHAIN_PACKAGES = ["@pnw/wallet", "@pnw/pnw-adapter", "@pnw/rail", "@pnw/records", "@pnw/config", "@pnw/commitments"];
const CHAIN_SCOPES = ["@provablehq/", "aleo-adapters"];

const STATIC_IMPORT = /\b(?:from|import)\s+["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("site boundary", () => {
  it("declares only the brand, security and ui workspace packages", () => {
    const workspace = Object.keys(pkg.dependencies).filter((d) => d.startsWith("@pnw/")).sort();
    expect(workspace).toEqual(ALLOWED_WORKSPACE);
  });

  it("declares no chain package and no third-party runtime dependency beyond the app's own", () => {
    const runtime = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@pnw/")).sort();
    expect(runtime).toEqual(ALLOWED_THIRD_PARTY);
    for (const dep of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
      expect(CHAIN_PACKAGES).not.toContain(dep);
      expect(CHAIN_SCOPES.some((s) => dep.startsWith(s))).toBe(false);
    }
  });

  it("imports nothing outside the declared packages, Next.js, React and its own files", () => {
    const allowed = new Set([...ALLOWED_WORKSPACE, ...ALLOWED_THIRD_PARTY, "vitest"]);
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const specs = [...readFileSync(file, "utf8").matchAll(STATIC_IMPORT)].map((m) => m[1]!);
      return specs
        .filter((spec) => !spec.startsWith("./") && !spec.startsWith("@/") && !spec.startsWith("node:"))
        .filter((spec) => !allowed.has(spec) && ![...allowed].some((a) => spec.startsWith(`${a}/`)))
        .map((spec) => `${relative(APP_ROOT, file)}: ${spec}`);
    });
    expect(offenders).toEqual([]);
  });

  it("loads no external script, style, font or frame in its pages", () => {
    const external = /(src|href)=["']https?:\/\//;
    const offenders = sourceFiles(SRC).filter((file) => file.endsWith(".tsx") && external.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("site security policy", () => {
  const directives = Object.fromEntries(
    buildCsp({ nonce: "n" })
      .split("; ")
      .map((d) => {
        const [name, ...values] = d.split(" ");
        return [name!, values];
      }),
  );

  it("talks to its own origin and no other host", () => {
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(buildCsp({ nonce: "n" })).not.toMatch(/https?:\/\//);
  });

  it("runs only nonced scripts, with no eval of any kind", () => {
    expect(directives["script-src"]).toEqual(["'self'", "'nonce-n'", "'strict-dynamic'"]);
  });

  it("allows no inline styles, fonts or frames from anywhere else", () => {
    expect(directives["style-src"]).toEqual(["'self'", "'nonce-n'"]);
    expect(directives["font-src"]).toEqual(["'self'"]);
    expect(directives["frame-src"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
  });
});
