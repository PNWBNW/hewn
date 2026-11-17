// Adds what GitHub Pages needs to the static bundle in out/ (after
// `build:static`, run by .github/workflows/pages.yml): the CNAME file naming
// the app's own domain. Refuses an address that isn't a custom https domain,
// and warns when the traction counter has no address of its own yet
// (src/security/pages.ts). Plain Node, as static_csp.mjs.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "@pnw/brand";
import { pagesPlan } from "../src/security/pages.ts";

const OUT = join(import.meta.dirname, "..", "out");
if (!existsSync(join(OUT, "index.html"))) throw new Error(`no index.html under ${OUT}: run the static build first`);

const { cname, warnings } = pagesPlan(BRAND);
writeFileSync(join(OUT, "CNAME"), `${cname}\n`);
// GitHub Actions turns a "::warning::" line into a note on the run's summary.
for (const w of warnings) console.log(`::warning::${w}`);
console.log(`pages: CNAME ${cname}`);
