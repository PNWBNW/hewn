#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Builds the map (docs/map/README.md): checks every graph in data/, lays it
// out, and writes a static site to dist/ (the viewer, the laid-out graphs,
// three.js and the few addons the viewer imports, copied from the art
// package's dependency so the page loads nothing from any other host).
//
//   node docs/map/build.mjs            build to docs/map/dist
//   node docs/map/build.mjs --doc      rewrite the generated tables in each graph's written
//                                      companion (docs/security/DATA_FLOW.md for data-flow)
//   node docs/map/build.mjs --check    check the graphs and that each companion is current
//                                      (CI; needs no three.js)
//
// Standard library only. Fails on a dangling edge, an unknown region or
// class, a rule id that isn't in docs/INVARIANTS.md or docs/THREAT_MODEL.md,
// or a companion whose tables don't match its graph.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";
import { layout } from "./layout.mjs";
import { stillSvg } from "./still.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DATA = join(HERE, "data");
const OUT = join(HERE, "dist");
const check = process.argv.includes("--check");
const writeDoc = process.argv.includes("--doc");
/** Each graph's written companion, with the generated block between these markers. */
const COMPANION = { "data-flow": "docs/security/DATA_FLOW.md" };
const fileOf = new Map(); // graph id -> its file in data/
const MARK = (id, end) => `<!-- map:${id}:${end ? "end" : "start"} -->`;

const RULE = /^(?:INV|OPS)-\d{2}$|^T\d+$/;
const known = new Set([
  ...readFileSync(join(ROOT, "docs/INVARIANTS.md"), "utf8").match(/\b(?:INV|OPS)-\d{2}\b/g),
  ...readFileSync(join(ROOT, "docs/THREAT_MODEL.md"), "utf8").match(/^#{2,3} (T\d+) —/gm).map((h) => h.match(/T\d+/)[0]),
]);

function fail(msg) {
  console.error(`map: ${msg}`);
  process.exit(1);
}

/** Every graph in data/, checked. */
function graphs() {
  const out = [];
  for (const file of readdirSync(DATA).filter((f) => f.endsWith(".json")).sort()) {
    const g = JSON.parse(readFileSync(join(DATA, file), "utf8"));
    const where = `data/${file}`;
    if (!g.id || !g.title) fail(`${where}: needs an id and a title`);
    const classes = new Set(Object.keys(g.classes ?? {}));
    for (const [id, c] of Object.entries(g.classes ?? {})) if (!/^#[0-9a-f]{6}$/i.test(c.colour ?? "")) fail(`${where}: class ${id} needs a colour`);
    const regions = new Set();
    for (const r of g.regions ?? []) {
      if (regions.has(r.id)) fail(`${where}: region ${r.id} twice`);
      if (!Array.isArray(r.at) || r.at.length !== 3) fail(`${where}: region ${r.id} needs 'at': [x, y, z]`);
      if (!/^#[0-9a-f]{6}$/i.test(r.colour ?? "")) fail(`${where}: region ${r.id} needs a colour`);
      regions.add(r.id);
    }
    const nodes = new Set();
    for (const n of g.nodes ?? []) {
      if (nodes.has(n.id)) fail(`${where}: node ${n.id} twice`);
      if (!regions.has(n.region)) fail(`${where}: node ${n.id} is in an unknown region ${n.region}`);
      if (!classes.has(n.class)) fail(`${where}: node ${n.id} has an unknown class ${n.class}`);
      if (!n.label) fail(`${where}: node ${n.id} needs a label`);
      checkRules(where, n.id, n.rules);
      nodes.add(n.id);
    }
    for (const e of g.edges ?? []) {
      for (const end of [e.from, e.to]) if (!nodes.has(end)) fail(`${where}: edge ${e.from} -> ${e.to} names an unknown node ${end}`);
      if (!classes.has(e.class)) fail(`${where}: edge ${e.from} -> ${e.to} has an unknown class ${e.class}`);
      if (!e.what) fail(`${where}: edge ${e.from} -> ${e.to} needs 'what' crosses it`);
      checkRules(where, `${e.from} -> ${e.to}`, e.rules);
    }
    fileOf.set(g.id, file);
    out.push(g);
  }
  if (out.length === 0) fail("no graphs in data/");
  // The whole tree, read from the files themselves (extract.mjs); it fails if the submodule is missing.
  out.push(extract());
  return out;
}

function checkRules(where, who, rules) {
  for (const id of rules ?? []) {
    if (!RULE.test(id)) fail(`${where}: ${who} cites ${id}, which isn't an INV, OPS or T id`);
    if (!known.has(id)) fail(`${where}: ${who} cites ${id}, which isn't in INVARIANTS.md or THREAT_MODEL.md`);
  }
}

/** The commit the map is built from, for the footer. */
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Copies three.js and, from the addons the viewer imports, everything they import in turn. */
function vendor(out) {
  // three's package exports hide package.json; resolve the module entry and walk up to the package.
  const require = createRequire(join(ROOT, "packages/art/package.json"));
  const three = resolve(dirname(require.resolve("three")), "..");
  const build = join(three, "build");
  mkdirSync(join(out, "vendor"), { recursive: true });
  for (const f of ["three.module.js", "three.core.js"]) cpSync(join(build, f), join(out, "vendor", f));
  const jsm = join(three, "examples", "jsm");
  const viewer = readFileSync(join(HERE, "map.js"), "utf8");
  const queue = [...viewer.matchAll(/from\s+["']three\/addons\/([^"']+)["']/g)].map((m) => m[1]);
  const seen = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = join(jsm, rel);
    if (!existsSync(src)) fail(`addon ${rel} isn't in three's examples/jsm`);
    const dst = join(out, "vendor", "addons", rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
    for (const m of readFileSync(src, "utf8").matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      queue.push(relative(jsm, resolve(dirname(src), m[1])));
    }
  }
  return { version: JSON.parse(readFileSync(join(three, "package.json"), "utf8")).version, files: seen.size + 2 };
}

/** The companion's generated part: the points by region, the flows, and a diagram GitHub draws. */
function companion(g) {
  const link = (id) => `[${id}](${id.startsWith("T") ? "../THREAT_MODEL.md" : "../INVARIANTS.md"})`;
  const rules = (r) => (r ?? []).map(link).join(" ");
  const cls = (c) => g.classes[c].label;
  const mid = (id) => id.replace(/\./g, "_");
  const label = (n) => n.label.replace(/"/g, "'");
  const out = [MARK(g.id), "", "_Generated from `docs/map/data/" + fileOf.get(g.id) + "` by `node docs/map/build.mjs --doc`; CI checks it is current. Edit the data, not this block._", ""];
  out.push("### Where the data lives", "");
  for (const r of g.regions) {
    out.push(`#### ${r.name}`, "", r.description, "", "| Point | Kind | Class | What it holds | Rules |", "|---|---|---|---|---|");
    for (const n of g.nodes.filter((n) => n.region === r.id)) out.push(`| ${n.label} | ${n.kind} | ${cls(n.class)} | ${n.holds} | ${rules(n.rules)} |`);
    out.push("");
  }
  const name = new Map(g.nodes.map((n) => [n.id, n.label]));
  out.push("### What crosses between them", "", "| From | To | What crosses | Class | Rules |", "|---|---|---|---|---|");
  for (const e of g.edges) out.push(`| ${name.get(e.from)} | ${name.get(e.to)} | ${e.what} | ${cls(e.class)} | ${rules(e.rules)} |`);
  out.push("", "### The same, drawn", "", "Lines are labelled with the class of what crosses them.", "", "```mermaid", "flowchart LR");
  for (const r of g.regions) {
    out.push(`  subgraph ${r.id}["${r.name}"]`);
    for (const n of g.nodes.filter((n) => n.region === r.id)) out.push(`    ${mid(n.id)}["${label(n)}"]`);
    out.push("  end");
  }
  for (const e of g.edges) out.push(`  ${mid(e.from)} -->|${cls(e.class).toLowerCase()}| ${mid(e.to)}`);
  out.push("```", "", MARK(g.id, true));
  return out.join("\n");
}

/** Puts the generated block into the companion, or says whether it is already there. */
function syncCompanion(g) {
  const rel = COMPANION[g.id];
  if (!rel) return;
  const path = join(ROOT, rel);
  if (!existsSync(path)) fail(`${rel} (the written companion of ${g.id}) doesn't exist`);
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(MARK(g.id)), end = text.indexOf(MARK(g.id, true));
  if (start < 0 || end < 0) fail(`${rel} needs the markers ${MARK(g.id)} and ${MARK(g.id, true)}`);
  const block = companion(g);
  const current = text.slice(start, end + MARK(g.id, true).length);
  if (current === block) return;
  if (!writeDoc) fail(`${rel} is out of date: run node docs/map/build.mjs --doc`);
  writeFileSync(path, text.slice(0, start) + block + text.slice(end + MARK(g.id, true).length));
  console.log(`map: wrote the generated tables into ${rel}`);
}

const all = graphs();
for (const g of all) syncCompanion(g);
if (check || writeDoc) {
  console.log(`map check: PASS - ${all.map((g) => `${g.id} (${g.nodes.length} nodes, ${g.edges.length} edges, ${g.regions.length} regions)`).join("; ")}`);
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "data"), { recursive: true });
const views = [];
const built = { commit: commit(), built: new Date().toISOString().slice(0, 10) };
for (const g of all) {
  const laid = layout(g, { iterations: g.nodes.length > 400 ? 160 : 320 });
  writeFileSync(join(OUT, "data", `${g.id}.json`), JSON.stringify({ ...g, nodes: laid.nodes, regions: laid.regions }));
  writeFileSync(join(OUT, `still-${g.id}.svg`), stillSvg(g, laid, built));
  views.push({ id: g.id, title: g.title, nodes: laid.nodes.length, edges: g.edges.length });
}
// The README's picture is the whole tree.
cpSync(join(OUT, "still-project.svg"), join(OUT, "still.svg"));
for (const f of ["index.html", "map.css", "map.js", "layout.mjs", "bodies.mjs"]) cpSync(join(HERE, f), join(OUT, f));
const three = vendor(OUT);
const project = all.find((g) => g.id === "project");
writeFileSync(join(OUT, "meta.json"), JSON.stringify({ ...built, views, three: three.version, submodule: project?.submodule ?? null }));
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`map: built ${views.map((v) => `${v.id} (${v.nodes} nodes, ${v.edges} edges)`).join("; ")} with three ${three.version} (${three.files} files) into ${relative(ROOT, OUT)}`);
