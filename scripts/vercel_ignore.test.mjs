// Run: node --test scripts/vercel_ignore.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD, SKIP, changedFiles, decide } from "./vercel_ignore.mjs";

const APP = ["apps/business", "packages", "pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml"];
const SITE = ["apps/site", "packages/brand", "packages/security", "packages/ui", "pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml"];
const RELEASE = "pay: the run screen, batched with three more [deploy] (#310)";

test("main skips every merge that isn't a release, app changes or not", () => {
  assert.equal(decide({ env: "production", message: "pay: the run screen (#305)", changed: ["apps/business/src/app/page.tsx"], watched: APP }).exit, SKIP);
  assert.equal(decide({ env: "production", message: "docs: a note (#306)", changed: ["docs/x.md"], watched: APP }).exit, SKIP);
});

test("a release builds what changed since the last deployment, the batch included", () => {
  const batch = ["apps/business/src/app/payroll/page.tsx", "packages/ledger/src/post.ts", "docs/x.md"];
  assert.equal(decide({ env: "production", message: RELEASE, changed: batch, watched: APP }).exit, BUILD);
  assert.equal(decide({ env: "production", message: RELEASE, changed: ["pnpm-lock.yaml"], watched: APP }).exit, BUILD);
});

test("a release skips a project nothing of which changed", () => {
  assert.equal(decide({ env: "production", message: RELEASE, changed: ["docs/x.md", "progress/2026-11-06.md"], watched: APP }).exit, SKIP);
  assert.equal(decide({ env: "production", message: RELEASE, changed: ["apps/business/a.ts", "packages/ledger/b.ts"], watched: SITE }).exit, SKIP);
  assert.equal(decide({ env: "production", message: RELEASE, changed: ["packages/brand/src/index.ts"], watched: SITE }).exit, BUILD);
});

test("a prefix matches whole folders only", () => {
  assert.equal(decide({ env: "production", message: RELEASE, changed: ["apps/business-old/x.ts"], watched: APP }).exit, SKIP);
  assert.equal(decide({ env: "production", message: RELEASE, changed: ["packages-notes.md"], watched: APP }).exit, SKIP);
});

test("a release that can't read what changed builds", () => {
  assert.equal(decide({ env: "production", message: RELEASE, changed: null, watched: APP }).exit, BUILD);
});

test("only the title counts: a body that mentions the tokens doesn't release or preview", () => {
  const body = "ci: deploy rule (#304)\n\nmain deploys when a merge's title says [deploy]; previews need [preview].";
  assert.equal(decide({ env: "production", message: body, changed: ["apps/business/vercel.json"], watched: APP }).exit, SKIP);
  assert.equal(decide({ env: "preview", message: body, changed: [], watched: APP }).exit, SKIP);
  assert.equal(decide({ env: "production", message: "x [Deploy]", changed: ["apps/business/a.ts"], watched: APP }).exit, BUILD);
});

test("previews are skipped unless the commit's title asks", () => {
  assert.equal(decide({ env: "preview", message: "docs: a note", changed: [], watched: APP }).exit, SKIP);
  assert.equal(decide({ env: "preview", message: "wallet: adapters 1.5 [preview]", changed: [], watched: APP }).exit, BUILD);
  assert.equal(decide({ env: "preview", message: "a branch commit [deploy]", changed: [], watched: APP }).exit, SKIP);
});

test("changedFiles reads the diff since the last deployment, or gives up", () => {
  const dir = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "apps/business"), { recursive: true });
  writeFileSync(join(dir, "apps/business/a.ts"), "1");
  g("add", "-A"); g("commit", "-qm", "one");
  const deployed = g("rev-parse", "HEAD");
  writeFileSync(join(dir, "README.md"), "2");
  g("add", "-A"); g("commit", "-qm", "two");
  writeFileSync(join(dir, "apps/business/a.ts"), "3");
  g("add", "-A"); g("commit", "-qm", "three [deploy]");
  assert.deepEqual(changedFiles(join(dir, "apps/business"), deployed).sort(), ["README.md", "apps/business/a.ts"]);
  assert.equal(changedFiles(dir, undefined), null, "no previous deployment");
  assert.equal(changedFiles(dir, "0000000000000000000000000000000000000000"), null, "previous deployment not in the clone");
  assert.equal(changedFiles(tmpdir(), deployed), null, "not a repository");
});
