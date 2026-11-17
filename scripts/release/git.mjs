// What a release takes from the checkout: the commit, its date and its tag. Each can be passed
// instead (--commit, --created, --version), for a copy with no git.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..", "..");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, TZ: "UTC" } }).trim();
  } catch {
    return null;
  }
}

/** The checked-out commit, or null outside a git checkout. */
export const headCommit = () => {
  const c = git(["rev-parse", "HEAD"]);
  return c && /^[0-9a-f]{40}$/.test(c) ? c : null;
};

/** The day the commit was made, in UTC, so every build of it writes the same date. */
export const commitDay = (commit) => git(["show", "-s", "--format=%cd", "--date=format-local:%Y-%m-%d", commit]);

/** The tag on the commit (v1.2), if exactly one tag points at it. */
export function commitTag(commit) {
  const tags = (git(["tag", "--points-at", commit]) ?? "").split("\n").filter(Boolean);
  return tags.length === 1 ? tags[0] : null;
}
