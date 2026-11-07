#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Vercel's "Ignored Build Step" for both projects (apps/business/vercel.json,
// apps/site/vercel.json): decides whether a push deploys. Vercel runs it before
// installing anything; exit 0 skips the build, exit 1 builds.
//
// The rule (Joshua, 2026-11-06: deploy only when we mean to, once per batch):
//   - main (production) deploys only on a release: a merge whose title (the
//     commit's first line) says `[deploy]`. Merges without it pile up and go
//     out together with the next release.
//   - A release builds a project only when something it is built from changed
//     since that project's last deployment: its own folder, the packages it
//     uses, the lockfile or the workspace files. A release of app changes
//     doesn't rebuild the marketing site.
//   - Every other branch (a preview) is skipped unless the pushed commit's
//     title says `[preview]`.
// Only the title counts, so a commit body can mention the tokens freely. When
// it can't tell what changed since the last deployment, a release builds: a
// wasted build is cheaper than a missed one.
//
// Standard library only. Usage, from a project's root directory:
//   node ../../scripts/vercel_ignore.mjs <path prefix> [<path prefix> ...]
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

export const BUILD = 1;
export const SKIP = 0;

/** The commit's title: its first line, lower-cased. */
const titleOf = (message = "") => message.split("\n", 1)[0].toLowerCase();

/**
 * The decision, from what Vercel says about the push. `changed` is the list
 * of files changed since the project's last deployment (paths from the
 * repository root), or null when that couldn't be read.
 */
export function decide({ env, message = "", changed, watched }) {
  const title = titleOf(message);
  if (env !== "production") {
    return title.includes("[preview]")
      ? { exit: BUILD, why: "the commit asks for a preview" }
      : { exit: SKIP, why: "previews build only on request ([preview] in the commit's title)" };
  }
  if (!title.includes("[deploy]")) return { exit: SKIP, why: "not a release; main deploys when a merge's title says [deploy]" };
  if (changed === null) return { exit: BUILD, why: "a release, and what changed since the last deployment couldn't be read, so building to be safe" };
  const hit = changed.find((f) => watched.some((w) => f === w || f.startsWith(w.endsWith("/") ? w : `${w}/`)));
  return hit
    ? { exit: BUILD, why: `a release, and ${hit} changed since the last deployment` }
    : { exit: SKIP, why: `a release, but nothing this project is built from changed since its last deployment (${changed.length} file${changed.length === 1 ? "" : "s"}, none under ${watched.join(", ")})` };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * The files changed since this project's last deployment (Vercel's
 * VERCEL_GIT_PREVIOUS_SHA). Null when there was none, or when that commit
 * isn't in Vercel's shallow clone: with releases batched, the parent commit
 * alone could miss changes, so the caller builds.
 */
export function changedFiles(cwd, previous) {
  if (!previous) return null;
  try {
    const root = git(["rev-parse", "--show-toplevel"], cwd);
    git(["cat-file", "-e", `${previous}^{commit}`], root);
    const out = git(["diff", "--name-only", previous, "HEAD"], root);
    return out ? out.split("\n") : [];
  } catch {
    return null;
  }
}

function main() {
  const watched = process.argv.slice(2);
  if (watched.length === 0) {
    console.log("vercel_ignore: no paths given, building");
    process.exit(BUILD);
  }
  const env = process.env.VERCEL_ENV ?? "";
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  const release = env === "production" && titleOf(message).includes("[deploy]");
  const decision = decide({
    env,
    message,
    changed: release ? changedFiles(process.cwd(), process.env.VERCEL_GIT_PREVIOUS_SHA) : [],
    watched,
  });
  console.log(`vercel_ignore: ${decision.exit === BUILD ? "building" : "skipping"}: ${decision.why}`);
  process.exit(decision.exit);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
