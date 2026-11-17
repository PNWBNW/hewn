// Builds the static bundle the way every release is built, then writes its release.json
// (README.md beside this file). Run from a clean checkout of the commit to release:
//
//   node scripts/release/build.mjs [--version v1.2] [--commit <40 hex>] [--created YYYY-MM-DD] [--allow-dirty]
//
// What makes two builds of one commit give the same bytes:
// - Next.js's build id is the commit (HEWN_BUILD_ID, read by apps/business/next.config.ts), not a
//   random one: it is in file paths and in every page.
// - The build sees only a fixed environment: no NEXT_PUBLIC_*, VERCEL_* or other setting of the
//   machine it runs on can reach the bundle; time zone and locale are fixed.
// - The previous output and Next.js's cache are removed first.
// What it can't fix from here: the Node and pnpm versions (Node 22, pnpm from package.json's
// packageManager, as CI uses) and the lockfile, which `pnpm install --frozen-lockfile` holds.

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ReleaseError, parseArgs, run } from "./lib.mjs";
import { ROOT } from "./git.mjs";
import { DEFAULT_BUNDLE, releaseInputs, writeManifest } from "./manifest.mjs";

/** The variables a build keeps from the machine: where the tools are, and how to reach the network. Nothing that reaches the bundle. */
const KEEP = ["PATH", "HOME", "USER", "TMPDIR", "PNPM_HOME", "COREPACK_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SYSTEMROOT", "CI"];

/** The environment of a release build of `commit`. */
export function buildEnv(commit, from = process.env) {
  const env = {};
  for (const name of KEEP) if (from[name] !== undefined) env[name] = from[name];
  return { ...env, HEWN_BUILD_ID: commit, TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" };
}

function dirty() {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["version", "commit", "created"], flags: ["allow-dirty"] });
  const inputs = releaseInputs({ version: args.version?.at(-1), commit: args.commit?.at(-1), created: args.created?.at(-1) });
  if (!args["allow-dirty"] && dirty()) throw new ReleaseError("The checkout has changes that aren't committed: a release is built from its commit alone. Commit or set them aside (or pass --allow-dirty for a trial build).");
  const app = join(ROOT, "apps", "business");
  rmSync(join(app, "out"), { recursive: true, force: true });
  rmSync(join(app, ".next"), { recursive: true, force: true });
  console.log(`Building ${inputs.version} (commit ${inputs.commit}) with Node ${process.version}`);
  const r = spawnSync("pnpm", ["--filter", "@pnw/business", "build:static"], { cwd: ROOT, env: buildEnv(inputs.commit), stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new ReleaseError(`The static build failed (exit ${r.status ?? r.signal})`);
  const m = writeManifest(DEFAULT_BUNDLE, inputs);
  console.log(`release.json written: ${Object.keys(m.files).length} files`);
  console.log(`digest ${m.digest}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
