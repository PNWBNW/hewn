// ---------------------------------------------------------------------------
// The whole tree as a graph (docs/map/README.md, the `project` view): every
// file git tracks in Hewn and in the Leo programs' repository (the
// `pnw_mvp_v2` submodule) is a point; every edge is a fact read from a file:
//
//   imports   a TypeScript or JavaScript file's static imports, resolved to the file
//   loads     a dynamic `import("…")`: code that loads only when needed
//   depends   a package.json's dependency on another workspace package, or a third party
//   links     a Markdown link to a file in the tree
//   mentions  a path in backticks in a document, when that file exists
//   reads     a path a Python script names, when that file exists
//   runs      a file a workflow step runs
//   uses      an action a workflow uses
//   imports   (Leo) `import x.aleo;` in a program, resolved to its main.leo
//   names     a TypeScript file naming a program through `PROGRAMS.<group>.<key>`
//   deploys   the chain manifest recording a program as deployed
//   checks    a rule's check (the Check cell in docs/INVARIANTS.md)
//   answers   a rule's threats (the Threats cell)
//   cites     a file citing a rule or threat id
//
// Nothing is guessed: an edge exists only when the target resolves to a
// tracked file (or a declared dependency), and the extractor fails if the
// submodule is missing rather than drawing a map with a hole in it. Standard
// library only; `git ls-files` is the one command it runs.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
const SUB = "pnw_mvp_v2";
const RETIRED = "pnw_employment_portal_v1";

// ---- Regions: where a file sits, by its path. First match wins. -------------------
const REGIONS = [
  { id: "screens", name: "Screens", description: "The app's pages: what a business, a worker or a customer sees.", colour: "#f5f0e3", at: [-190, 70, 50], prefixes: ["apps/business/src/app/"] },
  { id: "books", name: "Books code", description: "The app's own side of the books: accounts, review, close, backups. Imports nothing of the chain.", colour: "#f8d084", at: [-80, 120, 0], prefixes: ["apps/business/src/books/"] },
  { id: "chain", name: "Chain code", description: "The app's chain side: Shield, letters, records, cards. Loads only on the pages that need it.", colour: "#18dccb", at: [90, 60, 30], prefixes: ["apps/business/src/chain/"] },
  { id: "app", name: "App shell", description: "The rest of the app: the shell, security headers, cards, legal pages, traction, its config and brand copies.", colour: "#d8cfa8", at: [-130, -10, -70], prefixes: ["apps/business/"] },
  { id: "site", name: "Site", description: "The marketing site.", colour: "#c9c3b3", at: [-230, -50, 90], prefixes: ["apps/site/"] },
  { id: "core", name: "Core packages", description: "The double-entry core and what posts to it: ledger, sales, payroll, the tax engine, commitments.", colour: "#f8d084", at: [20, 150, -40], prefixes: ["packages/ledger/", "packages/sales/", "packages/payroll/", "packages/tax-engine/", "packages/commitments/"] },
  { id: "vault", name: "Vault", description: "The encrypted vault and the security headers.", colour: "#f5f0e3", at: [0, 60, 90], prefixes: ["packages/vault/", "packages/security/"] },
  { id: "chainpkgs", name: "Chain packages", description: "The packages that reach the chain: wallet, adapter, rail, records, mailbox, handshake, manifest, config.", colour: "#9fe3d8", at: [160, 110, -40], prefixes: ["packages/wallet/", "packages/pnw-adapter/", "packages/rail/", "packages/records/", "packages/mailbox/", "packages/handshake/", "packages/manifest/", "packages/config/"] },
  { id: "design", name: "Art, brand, UI", description: "The renderer behind the cards, the brand in one place, the UI primitives, the source art.", colour: "#e8c3a0", at: [-60, -70, -100], prefixes: ["packages/art/", "packages/brand/", "packages/ui/", "brand/", "docs/art/"] },
  { id: "programs", name: "Leo programs", description: "The programs on Aleo: names, agreements, letters, jobs, cards, credentials, payroll, anchors; the stubs; the archive.", colour: "#7cc8b8", at: [270, 10, -20], prefixes: [`${SUB}/src/`] },
  { id: "chainrepo", name: "Chain repository", description: "The rest of the programs' repository: its docs, manifest, scenarios, scripts, workflows and the old planning layer.", colour: "#8fb8ad", at: [240, -90, 50], prefixes: [`${SUB}/`] },
  { id: "rules", name: "Rules", description: "Every invariant, operating rule and threat, as a point: what it checks, what it answers, who cites it.", colour: "#18dccb", at: [10, -60, 110], prefixes: [] },
  { id: "docs", name: "Documents", description: "The design documents, the plan, the guides, the root pages.", colour: "#f8d084", at: [70, -140, -50], prefixes: ["docs/", "README.md", "CLAUDE.md", "BUILD_PLAN.md", "CONTRIBUTING.md", "SECURITY.md", "dev_testing_guide.md", "LICENSE", "packages/README.md"] },
  { id: "progress", name: "Progress log", description: "One file per day of work, and the generated index.", colour: "#c9c3b3", at: [140, -180, 40], prefixes: ["progress/", "PROGRESS.md"] },
  { id: "checks", name: "Scripts and CI", description: "The checks that run on every pull request, the workflows, the workspace's configuration.", colour: "#7f93b3", at: [-20, -200, 0], prefixes: ["scripts/", ".github/"] },
  { id: "deps", name: "Dependencies", description: "Third-party packages and actions the tree declares, and the programs on chain it imports but doesn't own.", colour: "#8a9ab0", at: [-170, -150, -70], prefixes: [] },
  { id: "archive", name: "Archive", description: "What was retired and kept for the record.", colour: "#6f7a8a", at: [-260, -120, -20], prefixes: ["archive/", "packages/coordinator/"] },
  { id: "config", name: "Workspace", description: "The root: package manifests, the lockfile, the test and ignore configuration.", colour: "#7f93b3", at: [-60, -130, 60], prefixes: [""] },
];

export const CLASSES = {
  code: { label: "Code", description: "Imports and loads between source files, and package dependencies.", colour: "#f5f0e3" },
  docs: { label: "Documents", description: "Links and mentions between documents and files; what a script reads.", colour: "#f8d084" },
  rules: { label: "Rules", description: "A rule's check, the threats it answers, and who cites it.", colour: "#18dccb" },
  chain: { label: "Chain", description: "A program imported by another, named by the app, or recorded as deployed.", colour: "#9fe3d8" },
  tooling: { label: "Tooling", description: "What a workflow runs or uses.", colour: "#7f93b3" },
};
const CLASS_OF = { imports: "code", loads: "code", depends: "code", links: "docs", mentions: "docs", reads: "docs", runs: "tooling", uses: "tooling", names: "chain", deploys: "chain", checks: "rules", answers: "rules", cites: "rules" };

const KIND_OF_EXT = { ts: "code", tsx: "code", mjs: "code", js: "code", cjs: "code", css: "style", md: "doc", json: "data", yml: "workflow", yaml: "workflow", py: "script", sh: "script", leo: "leo", jl: "code", png: "image", jpg: "image", webp: "image", ico: "image", svg: "image", pdf: "document", txt: "text", html: "page", toml: "config", lock: "config", example: "config" };

for (const r of REGIONS) r.at = r.at.map((v) => Math.round(v * 2.2)); // room for the big lobes
const regionOf = (path) => REGIONS.find((r) => r.prefixes.some((p) => path.startsWith(p)))?.id ?? "config";
const ext = (path) => (path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "");
const kindOf = (path) => {
  if (/\.test\.[mc]?[jt]sx?$/.test(path) || path.includes("/tests/")) return "test";
  if (path.endsWith("package.json")) return "manifest";
  if (path.endsWith("SHA256SUMS")) return "data";
  return KIND_OF_EXT[ext(path)] ?? "file";
};
const TEXT = new Set(["code", "style", "doc", "data", "workflow", "script", "leo", "text", "page", "config", "test", "manifest"]);

/** Every tracked file, as repo-relative posix paths, in Hewn and in the submodule. */
function tracked() {
  const list = (cwd, prefix) =>
    execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\0")
      .filter(Boolean)
      .map((p) => prefix + p);
  const hewn = list(ROOT, "").filter((p) => p !== SUB && p !== RETIRED);
  if (!existsSync(join(ROOT, SUB, "CLAUDE.md"))) throw new Error(`the ${SUB} submodule isn't checked out: git submodule update --init ${SUB}`);
  return [...hewn, ...list(join(ROOT, SUB), `${SUB}/`)].sort();
}

/** The first comment or paragraph of a file, as its own words for what it is. */
function describe(path, text, kind) {
  const first = (lines) => lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 260);
  if (kind === "image") return `${ext(path).toUpperCase()} image, ${size(path)}`;
  if (kind === "document" || !TEXT.has(kind)) return `${ext(path).toUpperCase() || "File"}, ${size(path)}`;
  const lines = text.split("\n");
  if (path.endsWith(".md")) {
    const h = lines.find((l) => /^#\s/.test(l))?.replace(/^#\s+/, "") ?? "";
    const i = lines.findIndex((l) => /^#\s/.test(l));
    const para = [];
    for (const l of lines.slice(i + 1)) {
      if (para.length && l.trim() === "") break;
      if (l.trim() === "" || l.startsWith("#") || l.startsWith("<") || l.startsWith("|") || l.startsWith("```")) continue;
      para.push(l.trim());
    }
    return first([h ? `${h}.` : "", ...para]);
  }
  if (path.endsWith(".leo")) {
    const program = text.match(/^program\s+([\w.]+)\s*{/m)?.[1];
    const transitions = (text.match(/^\s*(?:async\s+)?(?:transition|fn)\s+\w+/gm) ?? []).length;
    const mappings = (text.match(/^\s*mapping\s+\w+/gm) ?? []).length;
    const head = first(comments(lines, "//"));
    return [program ? `${program}: ${transitions} transitions, ${mappings} mappings.` : "", head].filter(Boolean).join(" ").slice(0, 260);
  }
  if (path.endsWith(".py")) {
    const doc = text.match(/^(?:#![^\n]*\n)?\s*(?:"""|''')([\s\S]*?)(?:"""|''')/);
    if (doc) return first(doc[1].trim().split("\n\n")[0].split("\n"));
    return first(comments(lines, "#"));
  }
  if (/\.(ya?ml|sh)$/.test(path)) {
    const name = text.match(/^name:\s*(.+)$/m)?.[1];
    return first([name ? `${name}.` : "", ...comments(lines, "#")]);
  }
  if (path.endsWith("package.json")) {
    try {
      const p = JSON.parse(text);
      return first([`${p.name ?? "package"}${p.description ? `: ${p.description}` : ""}`]);
    } catch {
      return "A package manifest.";
    }
  }
  if (path.endsWith(".json")) return `JSON, ${size(path)}.`;
  const block = text.match(/^\s*(?:"use client";\s*)?\/\*\*?([\s\S]*?)\*\//);
  if (block && text.indexOf(block[0]) < 40) return first(block[1].split("\n").map((l) => l.replace(/^\s*\*\s?/, "")));
  return first(comments(lines, "//"));
}
function comments(lines, mark) {
  const out = [];
  let started = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (l === "" || /^"use client";?$/.test(l) || l.startsWith("#!")) {
      if (started && l === "") break;
      continue;
    }
    if (!l.startsWith(mark)) {
      if (started) break;
      continue;
    }
    const body = l.slice(mark.length).trim();
    if (/^[-=]{3,}$/.test(body)) {
      if (started) break;
      continue;
    }
    started = true;
    if (body) out.push(body);
    if (out.length > 6) break;
  }
  return out;
}
function size(path) {
  const b = statSync(join(ROOT, path)).size;
  return b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

// ---- Resolution ----------------------------------------------------------------
const SRC_EXTS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"];
function resolveFile(set, base) {
  if (set.has(base) && !base.endsWith("/")) return base;
  for (const e of SRC_EXTS) if (set.has(base + e)) return base + e;
  for (const e of SRC_EXTS) if (set.has(posix.join(base, "index" + e))) return posix.join(base, "index" + e);
  const js = base.match(/^(.*)\.js$/);
  if (js) for (const e of [".ts", ".tsx"]) if (set.has(js[1] + e)) return js[1] + e;
  return null;
}

/** The nearest package.json above a path, and its declared dependencies. */
function packageOf(path, set, cache) {
  let dir = posix.dirname(path);
  for (;;) {
    const p = dir === "." ? "package.json" : `${dir}/package.json`;
    if (set.has(p)) {
      if (!cache.has(p)) {
        try {
          const j = JSON.parse(readFileSync(join(ROOT, p), "utf8"));
          cache.set(p, { path: p, name: j.name, exports: j.exports ?? null, deps: { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}), ...(j.peerDependencies ?? {}) } });
        } catch {
          cache.set(p, { path: p, name: null, exports: null, deps: {} });
        }
      }
      return cache.get(p);
    }
    if (dir === "." || dir === "") return null;
    dir = posix.dirname(dir);
  }
}

export function extract() {
  const files = tracked();
  const set = new Set(files);
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const edge = (from, to, kind) => {
    if (from === to) return;
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind, class: CLASS_OF[kind] });
  };
  const deps = new Map(); // id -> node
  const dep = (name, what) => {
    const id = `dep:${name}`;
    if (!deps.has(id)) deps.set(id, { id, region: "deps", label: name, kind: "dependency", class: "code", holds: what });
    return id;
  };
  const pkgCache = new Map();
  const workspace = new Map(); // "@pnw/x" -> {path, exports}
  for (const f of files.filter((f) => f.endsWith("package.json") && !f.startsWith(`${SUB}/`))) {
    const p = packageOf(f, set, pkgCache);
    if (p?.name) workspace.set(p.name, p);
  }
  // Programs: a folder with src/main.leo, by its program id, in the live tree first, then stubs and archive.
  const programs = new Map();
  for (const f of files.filter((f) => f.endsWith("/src/main.leo"))) {
    const folder = posix.basename(posix.dirname(posix.dirname(f)));
    const id = folder.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/\.aleo$/, "") + ".aleo";
    const rank = f.includes("/archive/") ? 2 : f.includes("/stubs/") ? 1 : 0;
    if (!programs.has(id) || programs.get(id).rank > rank) programs.set(id, { file: f, rank });
  }
  const programFile = (id) => programs.get(id.endsWith(".aleo") ? id : `${id}.aleo`)?.file ?? null;
  const programsTs = files.find((f) => f === "packages/config/src/programs.ts");
  const programKeys = new Map(); // "layer1.payroll_audit_log" -> "payroll_audit_log.aleo"
  if (programsTs) {
    let group = null;
    for (const line of readFileSync(join(ROOT, programsTs), "utf8").split("\n")) {
      const g = line.match(/^\s{2}(\w+):\s*{/);
      if (g) group = g[1];
      const kv = line.match(/^\s{4}(\w+):\s*"([\w.]+\.aleo)"/);
      if (kv && group) programKeys.set(`${group}.${kv[1]}`, kv[2]);
    }
  }
  const idRe = /\b(?:INV|OPS)-\d{2}\b/g;

  for (const path of files) {
    const kind = kindOf(path);
    const text = TEXT.has(kind) ? readFileSync(join(ROOT, path), "utf8") : "";
    const node = { id: path, region: regionOf(path), label: posix.basename(path), kind, class: "code", path, holds: describe(path, text, kind) };
    if (text) node.lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    nodes.push(node);
    if (!text) continue;
    const dir = posix.dirname(path);
    const inSub = path.startsWith(`${SUB}/`);
    const repoRoot = inSub ? SUB : "";
    const fromRoot = (p) => posix.normalize(repoRoot ? posix.join(repoRoot, p) : p);

    // Rule and threat ids cited anywhere (threat ids only in documents, where "T6" means a threat).
    for (const id of new Set(text.match(idRe) ?? [])) edge(path, id, "cites");
    if (kind === "doc" && !path.startsWith("docs/THREAT_MODEL.md")) for (const id of new Set(text.match(/\bT\d{1,2}\b/g) ?? [])) edge(path, id, "cites");

    if (["code", "test", "style"].includes(kind) && /\.([mc]?[jt]sx?)$/.test(path)) {
      const pkg = packageOf(path, set, pkgCache);
      const specs = [];
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']/g)) specs.push([m[1], "imports"]);
      for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) specs.push([m[1], "imports"]);
      for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push([m[1], "loads"]);
      for (const m of text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) specs.push([m[1], "imports"]);
      for (const [spec, how] of specs) {
        let target = null;
        if (spec.startsWith(".")) target = resolveFile(set, posix.normalize(posix.join(dir, spec)));
        else if (spec.startsWith("@/")) {
          const app = path.startsWith("apps/site/") ? "apps/site/src/" : path.startsWith("apps/business/") ? "apps/business/src/" : null;
          if (app) target = resolveFile(set, app + spec.slice(2));
        } else if (spec.startsWith("node:")) continue;
        else {
          const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
          const sub = spec.slice(name.length);
          const ws = workspace.get(name);
          if (ws) {
            const key = sub ? `.${sub}` : ".";
            const exp = ws.exports && typeof ws.exports === "object" ? ws.exports[key] : typeof ws.exports === "string" && key === "." ? ws.exports : null;
            const rel = typeof exp === "string" ? exp : typeof exp === "object" && exp ? exp.default ?? exp.import : null;
            target = rel ? resolveFile(set, posix.normalize(posix.join(posix.dirname(ws.path), rel))) : resolveFile(set, posix.join(posix.dirname(ws.path), "src", sub ? sub.slice(1) : "index"));
          } else if (pkg && name in pkg.deps) target = dep(name, `A package the tree declares (${pkg.name ?? pkg.path}: ${pkg.deps[name]}).`);
          else continue;
        }
        if (target) edge(path, target, how);
      }
      // A program named through the registry.
      for (const m of text.matchAll(/\bPROGRAMS\.(\w+)\.(\w+)/g)) {
        const id = programKeys.get(`${m[1]}.${m[2]}`);
        const file = id && programFile(id);
        if (file) edge(path, file, "names");
      }
    }

    if (kind === "manifest") {
      const pkg = packageOf(path, set, pkgCache);
      if (pkg) for (const [name, version] of Object.entries(pkg.deps)) {
        const ws = workspace.get(name);
        if (ws) edge(path, ws.path, "depends");
        else edge(path, dep(name, `A package the tree declares (${pkg.name ?? path}: ${version}).`), "depends");
      }
    }

    if (kind === "doc") {
      for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const href = m[1].split("#")[0];
        if (!href || /^[a-z]+:/.test(href)) continue;
        const target = resolveFile(set, posix.normalize(posix.join(dir, href))) ?? resolveFile(set, fromRoot(href));
        if (target) edge(path, target, "links");
      }
      for (const m of text.matchAll(/`([\w./-]+\.[A-Za-z0-9]{1,5})`/g)) {
        const target = resolveFile(set, fromRoot(m[1])) ?? resolveFile(set, posix.normalize(posix.join(dir, m[1])));
        if (target) edge(path, target, "mentions");
      }
    }

    if (kind === "script" && path.endsWith(".py")) {
      const joined = text.replace(/"([^"\n]+)"(?:\s*\/\s*"([^"\n]+)")+/g, (m) => `"${[...m.matchAll(/"([^"\n]+)"/g)].map((x) => x[1]).join("/")}"`);
      for (const m of joined.matchAll(/"([\w./-]+\.[A-Za-z0-9]{1,5})"/g)) {
        const target = resolveFile(set, fromRoot(m[1]));
        if (target) edge(path, target, "reads");
      }
    }

    if (kind === "workflow" && path.includes(".github/workflows/")) {
      for (const m of text.matchAll(/^\s*(?:-\s*)?run:\s*(.+)$/gm)) {
        for (const t of m[1].matchAll(/[\w./-]+\.(?:py|sh|mjs|js|ts|json)\b/g)) {
          const target = resolveFile(set, fromRoot(t[0]));
          if (target) edge(path, target, "runs");
        }
      }
      for (const m of text.matchAll(/^\s*(?:-\s*)?uses:\s*([\w./-]+@[\w.-]+)/gm)) edge(path, dep(m[1], "A GitHub Action the workflow uses."), "uses");
    }

    if (kind === "leo") {
      for (const m of text.matchAll(/^\s*import\s+([\w.]+\.aleo)\s*;/gm)) {
        const file = programFile(m[1]);
        edge(path, file ?? dep(m[1], "A program on Aleo the tree imports but doesn't own."), "imports");
      }
    }

    if (path === `${SUB}/config/testnet.manifest.json`) {
      try {
        const manifest = JSON.parse(text);
        for (const id of Object.keys(manifest.deployments ?? {})) {
          const file = programFile(id);
          if (file) edge(path, file, "deploys");
        }
      } catch {
        /* the manifest's shape is checked in its own repository */
      }
    }
  }

  // Rules and threats, from the tables and headings that define them.
  const inv = readFileSync(join(ROOT, "docs/INVARIANTS.md"), "utf8");
  const threats = readFileSync(join(ROOT, "docs/THREAT_MODEL.md"), "utf8");
  const PATH = /`([\w./-]+\/[\w.-]+\.(?:ts|tsx|py|md|yml|json|sh|mjs))`/g;
  for (const line of inv.split("\n")) {
    const m = line.match(/^\|\s*((?:INV|OPS)-\d{2})\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    const ops = m[1].startsWith("OPS");
    nodes.push({ id: m[1], region: "rules", label: m[1], kind: ops ? "operating rule" : "invariant", class: "rules", holds: cells[0].slice(0, 260), rules: [m[1]] });
    const checkCell = ops ? cells[3] : cells[2];
    for (const p of checkCell.matchAll(PATH)) if (set.has(p[1])) edge(m[1], p[1], "checks");
    if (ops) for (const p of `${cells[1]} ${cells[2]}`.matchAll(PATH)) if (set.has(p[1])) edge(m[1], p[1], "checks");
    if (!ops) for (const t of new Set(cells[3].match(/\bT\d+\b/g) ?? [])) edge(m[1], t, "answers");
    edge(m[1], "docs/INVARIANTS.md", "cites");
  }
  for (const m of threats.matchAll(/^#{2,3} (T\d+) — ([^\n]+)\n+([^\n]*)/gm)) {
    nodes.push({ id: m[1], region: "rules", label: `${m[1]} ${m[2].trim()}`, kind: "threat", class: "rules", holds: m[3].replace(/[*_`]/g, "").slice(0, 260), rules: [m[1]] });
    edge(m[1], "docs/THREAT_MODEL.md", "cites");
  }
  nodes.push({ id: `${RETIRED}`, region: "archive", label: "The retired portal (submodule)", kind: "submodule", class: "code", path: RETIRED, holds: "The first employer-and-worker app, retired 2026-10-13 and kept as history. Its files aren't drawn." });
  edge("README.md", RETIRED, "mentions");
  for (const d of deps.values()) nodes.push(d);

  // Drop edges to ids that aren't nodes (a cited id with no row), rather than draw a dangling line.
  const ids = new Set(nodes.map((n) => n.id));
  const kept = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const sub = execFileSync("git", ["ls-tree", "HEAD", SUB], { cwd: ROOT, encoding: "utf8" }).split(/\s+/)[2] ?? "";
  return {
    id: "project",
    title: "The whole tree, and how it connects",
    description: `Every file git tracks in Hewn and in the Leo programs' repository, every rule and threat, and every dependency, with an edge for each fact read from the files: imports, links, what a script reads, what a workflow runs, which program a file names or imports, what a rule checks. ${nodes.length} points, ${kept.length} edges.`,
    classes: CLASSES,
    regions: REGIONS.map(({ prefixes, ...r }) => r),
    nodes,
    edges: kept.map((e) => ({ ...e, what: e.kind })),
    submodule: { path: SUB, commit: sub },
  };
}
