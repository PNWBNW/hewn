// Stamps the static bundle's security policy into every exported page
// (src/security/static_csp.ts). Run after `HEWN_STATIC=1 next build`, by the
// `build:static` script. Plain Node runs it: the TypeScript it imports is
// stripped of types on load (Node 22.18+), and the imports name their files
// in full, as Node needs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "@pnw/brand";
import { buildStaticCsp } from "../src/security/headers.ts";
import { stampStaticCsp } from "../src/security/static_csp.ts";

const OUT = join(import.meta.dirname, "..", "out");

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "_next" ? [] : pages(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

const apiOrigin = new URL(BRAND.appUrl).origin;
const files = pages(OUT);
if (files.length === 0) throw new Error(`no pages under ${OUT}: run the static build first`);
for (const file of files) {
  const html = readFileSync(file, "utf8");
  writeFileSync(file, await stampStaticCsp(html, (scriptHashes) => buildStaticCsp({ scriptHashes, apiOrigin })));
}
console.log(`static policy stamped into ${files.length} pages; server pieces at ${apiOrigin}`);
