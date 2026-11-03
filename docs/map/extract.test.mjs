// Known facts about the tree the extractor must find (docs/map/README.md). Run: node --test docs/map/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { extract, ROOT } from "./extract.mjs";

const g = extract();
const ids = new Set(g.nodes.map((n) => n.id));
const has = (from, to, kind) => g.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

test("every tracked file in both trees is a point, in a region that exists", () => {
  const hewn = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((p) => p && !p.startsWith("pnw_"));
  const chain = execFileSync("git", ["ls-files"], { cwd: `${ROOT}/pnw_mvp_v2`, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const p of hewn) assert.ok(ids.has(p), `${p} missing`);
  for (const p of chain) assert.ok(ids.has(`pnw_mvp_v2/${p}`), `pnw_mvp_v2/${p} missing`);
  const regions = new Set(g.regions.map((r) => r.id));
  for (const n of g.nodes) assert.ok(regions.has(n.region), `${n.id} in unknown region ${n.region}`);
  assert.ok(g.nodes.every((n) => n.id && n.label && n.holds !== undefined));
});

test("no edge dangles, none repeats, none points at itself", () => {
  const seen = new Set();
  for (const e of g.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from} -> ${e.to}`);
    assert.notEqual(e.from, e.to);
    assert.ok(e.class in g.classes, e.class);
    const key = `${e.from}|${e.to}|${e.kind}`;
    assert.ok(!seen.has(key), `twice: ${key}`);
    seen.add(key);
  }
});

test("TypeScript imports resolve: relative, @/ alias, workspace exports, dynamic loads, declared dependencies", () => {
  assert.ok(has("apps/business/src/chain/CloseShield.tsx", "apps/business/src/chain/close_anchor.ts", "imports"));
  assert.ok(has("apps/business/src/chain/CloseShield.tsx", "apps/business/src/books/ClosePanel.tsx", "imports"));
  assert.ok(has("apps/business/src/chain/CloseShield.tsx", "packages/wallet/src/wallet-provider.tsx", "imports"));
  assert.ok(has("apps/business/src/chain/CloseShield.tsx", "packages/ui/src/button.tsx", "imports"));
  assert.ok(has("apps/business/src/chain/CloseShield.tsx", "dep:react", "imports"));
  assert.ok(has("apps/business/src/app/settings/page.tsx", "apps/business/src/chain/ChainBackup.tsx", "loads"));
  assert.ok(has("apps/business/src/chain/close_anchor.ts", "packages/config/src/programs.ts", "imports"));
  assert.ok(has("apps/business/package.json", "packages/ledger/package.json", "depends"));
});

test("the chain: a program named by the app, a program importing another, the manifest's deployments", () => {
  assert.ok(has("apps/business/src/chain/close_anchor.ts", "pnw_mvp_v2/src/layer1/payroll_audit_log.aleo/src/main.leo", "names"));
  assert.ok(has("pnw_mvp_v2/src/layer1/hewn_credentials_v1.aleo/src/main.leo", "pnw_mvp_v2/src/layer1/employer_agreement_v5.aleo/src/main.leo", "imports"));
  assert.ok(g.edges.filter((e) => e.from === "pnw_mvp_v2/config/testnet.manifest.json" && e.kind === "deploys").length >= 15);
  // The stablecoin isn't ours: its import resolves to the stub that stands in for it offline.
  assert.ok(has("pnw_mvp_v2/src/layer1/hewn_jobs_v1.aleo/src/main.leo", "pnw_mvp_v2/src/stubs/test_usdcx_stablecoin.aleo/src/main.leo", "imports"));
});

test("documents: links, mentions, what a script reads, what a workflow runs and uses", () => {
  assert.ok(has("docs/security/DATA_FLOW.md", "docs/INVARIANTS.md", "links"));
  assert.ok(has("docs/README.md", "docs/THREAT_MODEL.md", "links"));
  assert.ok(has("CLAUDE.md", "apps/business/src/books/account.ts", "mentions"));
  assert.ok(has("scripts/check_invariants.py", "docs/INVARIANTS.md", "reads"));
  assert.ok(has(".github/workflows/ci.yml", "scripts/check_secrets.py", "runs"));
  assert.ok(has(".github/workflows/ci.yml", "dep:actions/checkout@v7", "uses"));
});

test("rules: every INV, OPS and T id is a point; a rule checks its file, answers its threats, and is cited", () => {
  for (const id of ["INV-01", "INV-24", "OPS-01", "OPS-08", "T1", "T20"]) assert.ok(ids.has(id), id);
  assert.ok(has("INV-07", "packages/vault/src/vault.test.ts", "checks"));
  assert.ok(has("INV-07", "T2", "answers"));
  assert.ok(has("OPS-04", ".github/workflows/ci.yml", "checks"));
  assert.ok(has("CLAUDE.md", "INV-07", "cites"));
  assert.ok(has("apps/business/src/books/drawing_step.ts", "INV-10", "cites"));
});

test("a file's own words describe it", () => {
  const close = g.nodes.find((n) => n.id === "apps/business/src/books/close.ts");
  assert.match(close.holds, /^Closing a period/);
  const jobs = g.nodes.find((n) => n.id === "pnw_mvp_v2/src/layer1/hewn_jobs_v1.aleo/src/main.leo");
  assert.match(jobs.holds, /^hewn_jobs_v1\.aleo: \d+ transitions, \d+ mappings\./);
  const t18 = g.nodes.find((n) => n.id === "T18");
  assert.match(t18.label, /^T18 A key leaked/);
});
