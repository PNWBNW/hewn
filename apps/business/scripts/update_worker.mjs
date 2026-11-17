// Writes the update worker into the static bundle as out/sw.js (src/updates/README.md), with the
// release keys from @pnw/brand and the security headers from src/security/headers.ts. Run by the
// `build:static` script after the policy is stamped, so release.json lists sw.js like any other
// file. Plain Node runs it, as it does static_csp.mjs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseKeys } from "@pnw/brand";
import { SECURITY_HEADERS } from "../src/security/headers.ts";
import { WORKER_FILE, workerHeaders, workerScript } from "../src/updates/worker_source.ts";

const APP = join(import.meta.dirname, "..");
const OUT = join(APP, "out");

if (!existsSync(join(OUT, "index.html"))) throw new Error(`no bundle at ${OUT}: run the static build first`);
const source = readFileSync(join(APP, "src", "updates", "worker.js"), "utf8");
writeFileSync(join(OUT, WORKER_FILE), workerScript(source, releaseKeys, workerHeaders(SECURITY_HEADERS)));
console.log(`update worker written to ${WORKER_FILE}: ${releaseKeys.length} release key(s)`);
