// Writes release.json at the root of a built bundle (README.md beside this file).
//
//   node scripts/release/manifest.mjs [bundle] [--version v1.2] [--commit <40 hex>] [--created YYYY-MM-DD]
//
// The bundle defaults to apps/business/out. The commit defaults to the checkout's, the date to that
// commit's day (UTC) and the version to the tag on it, else dev-<first 12 of the commit>: every
// input is the commit's, so two builds of one commit write the same release.json.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MANIFEST, ReleaseError, buildManifest, manifestText, parseArgs, run } from "./lib.mjs";
import { ROOT, commitDay, commitTag, headCommit } from "./git.mjs";

export const DEFAULT_BUNDLE = join(ROOT, "apps", "business", "out");

/** Fills in what wasn't given from the checkout. */
export function releaseInputs({ version, commit, created } = {}) {
  const c = commit ?? headCommit();
  if (!c) throw new ReleaseError("No commit: run this in a git checkout or pass --commit");
  const day = created ?? commitDay(c);
  if (!day) throw new ReleaseError("No release date: pass --created YYYY-MM-DD");
  return { version: version ?? commitTag(c) ?? `dev-${c.slice(0, 12)}`, commit: c, created: day };
}

/** Writes release.json into `dir` and returns the manifest. */
export function writeManifest(dir, inputs) {
  const manifest = buildManifest(dir, releaseInputs(inputs));
  writeFileSync(join(dir, MANIFEST), manifestText(manifest));
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["version", "commit", "created"] });
  if (args._.length > 1) throw new ReleaseError("Usage: manifest.mjs [bundle] [--version v1.2] [--commit <40 hex>] [--created YYYY-MM-DD]");
  const dir = resolve(args._[0] ?? DEFAULT_BUNDLE);
  const m = writeManifest(dir, { version: args.version?.at(-1), commit: args.commit?.at(-1), created: args.created?.at(-1) });
  console.log(`${MANIFEST} written: ${m.version}, commit ${m.commit}, ${Object.keys(m.files).length} files`);
  console.log(`digest ${m.digest}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
