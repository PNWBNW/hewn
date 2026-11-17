// The release digest on Aleo (README.md beside this file). The write is anchor_event on the
// deployed payroll_audit_log, signed in the operator's Shield wallet (INV-11): this script only
// prints what to sign and reads the result back. It never signs or sends anything.
//
//   node scripts/release/anchor.mjs literal <digest | bundle | release.json>
//   node scripts/release/anchor.mjs check   <digest | bundle | release.json> [--endpoint <explorer>]
//
// `literal` prints the program, the function and the `[u8; 32]` input. `check` reads
// audit_event_height for the digest and prints the block it was anchored in; it exits 1 when
// the digest isn't anchored.

import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AUDIT_LOG_PROGRAM, DEFAULT_ENDPOINT, MANIFEST, ReleaseError, anchorHeight, anchorUrl, parseArgs, parseManifest, run, u8Literal } from "./lib.mjs";

/** The digest a command names: 64 hex, or the one in a bundle's (or a path's) release.json. */
export function digestOf(target) {
  if (/^[0-9a-f]{64}$/.test(target)) return target;
  const path = resolve(target);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) throw new ReleaseError(`Not a digest (64 hex) and nothing at ${path}`);
  const file = stat.isDirectory() ? join(path, MANIFEST) : path;
  try {
    return parseManifest(readFileSync(file, "utf8")).digest;
  } catch (e) {
    if (e instanceof ReleaseError) throw e;
    throw new ReleaseError(`No ${MANIFEST} at ${file}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["endpoint"] });
  const [command, target, ...rest] = args._;
  if (!["literal", "check"].includes(command) || !target || rest.length > 0) throw new ReleaseError("Usage: anchor.mjs literal|check <digest | bundle | release.json> [--endpoint <explorer>]");
  const digest = digestOf(target);
  if (command === "literal") {
    console.log(`Program   ${AUDIT_LOG_PROGRAM}`);
    console.log("Function  anchor_event");
    console.log("Fee       public");
    console.log(`Input     ${u8Literal(digest)}`);
    return 0;
  }
  const endpoint = args.endpoint?.at(-1) ?? DEFAULT_ENDPOINT;
  const height = await anchorHeight(endpoint, AUDIT_LOG_PROGRAM, digest);
  if (height === null) {
    console.error(`Not anchored: ${digest}`);
    console.error(`(read ${anchorUrl(endpoint, AUDIT_LOG_PROGRAM, digest)})`);
    return 1;
  }
  console.log(`Anchored in block ${height}: ${digest}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
