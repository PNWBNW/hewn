// Compares two builds: two bundle directories, or a directory and a release.json (README.md
// beside this file). Exits 1 and names each file that differs when they aren't the same release.
//
//   node scripts/release/compare.mjs <bundle or release.json> <bundle or release.json>
//
// CI runs it on its two builds; the operator runs it on a local build and CI's artifact before
// signing. A directory is hashed as it stands (its release.json, if any, is not trusted for it).

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ReleaseError, compareFiles, filesDigest, hashBundle, parseArgs, parseManifest, run } from "./lib.mjs";

/** The files object of a bundle directory (hashed) or a release.json (as listed, after its own checks). */
export function filesOf(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) throw new ReleaseError(`Nothing at ${path}`);
  return stat.isDirectory() ? hashBundle(path) : parseManifest(readFileSync(path, "utf8")).files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length !== 2) throw new ReleaseError("Usage: compare.mjs <bundle or release.json> <bundle or release.json>");
  const [pa, pb] = args._.map((p) => resolve(p));
  const a = filesOf(pa);
  const b = filesOf(pb);
  const da = filesDigest(a);
  const db = filesDigest(b);
  console.log(`${pa}: digest ${da}, ${Object.keys(a).length} files`);
  console.log(`${pb}: digest ${db}, ${Object.keys(b).length} files`);
  if (da === db) {
    console.log("Same release.");
    return 0;
  }
  const diff = compareFiles(a, b, { complete: true });
  console.error(`Different builds (${diff.length} files):`);
  for (const line of diff.slice(0, 200)) console.error(`  ${line.replace(/^missing:/, "only in the first:").replace(/^not in the release:/, "only in the second:")}`);
  if (diff.length > 200) console.error(`  … and ${diff.length - 200} more`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
