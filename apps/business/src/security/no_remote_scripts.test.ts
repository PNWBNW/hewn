// No script reaches the app's pages unless it is in this repository (docs/THREAT_MODEL.md T3).
// Tag managers, A/B testing tools and other "paste a snippet" services (Optimizely, Google Tag
// Manager, Segment and the like) let whoever controls the vendor's dashboard run code in every
// page, beside the unlocked books; none of them is allowed. The one runtime addition from outside
// is Vercel Web Analytics (Joshua, 2026-10-19): aggregate page views, served from the site's own
// address by the host that already serves every file of the app.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp, buildStaticCsp } from "./headers";

const APP_ROOT = join(__dirname, "..", "..");
const SRC = join(APP_ROOT, "src");

/** Third-party packages the app's pages may run. A new one is a decision for T3, not a version bump. */
const ALLOWED_RUNTIME = ["@provablehq/sdk", "@provablehq/veil-core", "@vercel/analytics", "lucide-react", "next", "react", "react-dom"];

/** The only places the app puts HTML it built itself into a page, each escaping every word it is given. */
const RAW_HTML = [
  "src/app/out-of-the-basement/page.tsx",
  "src/cards/BusinessCardArt.tsx",
  "src/cards/PaystubCardArt.tsx",
  "src/cards/WorkerCardArt.tsx",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const files = sourceFiles(SRC).map((file) => ({ path: relative(APP_ROOT, file), text: readFileSync(file, "utf8") }));

describe("scripts in the app's pages", () => {
  it("come only from the packages T3 names", () => {
    const runtime = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@pnw/")).sort();
    expect(runtime).toEqual(ALLOWED_RUNTIME);
  });

  it("are never added as a tag or loaded from another address", () => {
    const tag = /<(script|iframe)\b|(src|href)=["'{`]*https?:\/\/[^"'`]*\.js\b/;
    const pages = files.filter((f) => f.path.endsWith(".tsx") && tag.test(f.text));
    const loaders = files.filter((f) => /["']next\/script["']/.test(f.text));
    expect([...pages, ...loaders].map((f) => f.path)).toEqual([]);
  });

  it("name no host in the security policy, on the website or in the static bundle", () => {
    const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src "))!.split(" ").slice(1);
    const sources = [
      ...scriptSrc(buildCsp({ nonce: "n" })),
      ...scriptSrc(buildStaticCsp({ scriptHashes: ["sha256-x"], apiOrigin: "https://example.test" })),
    ];
    expect(sources.filter((s) => !s.startsWith("'"))).toEqual([]);
  });

  it("put raw HTML into a page only where the app built and escaped it", () => {
    const raw = files.filter((f) => f.text.includes("dangerouslySetInnerHTML")).map((f) => f.path).sort();
    expect(raw).toEqual(RAW_HTML);
  });
});
