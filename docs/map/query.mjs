#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Questions to the map, from the command line (docs/map/README.md): the
// agent's side of the same graph the page draws. It runs the extractor fresh
// each time (a fraction of a second), so it never answers from a stale graph.
//
//   node docs/map/query.mjs show <file|id>        what it is, its rules, every edge grouped
//   node docs/map/query.mjs impact <file> [hops]  what reaches it through code (2 hops by default): what a change can break
//   node docs/map/query.mjs path <a> <b>          the shortest chain of edges between two points
//   node docs/map/query.mjs rule <INV-07|OPS-01|T18>   its checks, threats, and who cites it
//   node docs/map/query.mjs find <text>           points whose path, name or description match
//   node docs/map/query.mjs hubs [region] [n]     the most-connected points
//   node docs/map/query.mjs regions               the regions and their counts
//
// A name may be a full id or the end of a path (`books/close.ts`); one that
// matches several points is refused with the candidates listed, never
// guessed. Exit codes: 0 an answer, 2 usage, 3 ambiguous, 4 not found.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";

/** How each kind of edge reads from either end. */
const WORDS = {
  imports: ["imports", "imported by"],
  loads: ["loads (when needed)", "loaded (when needed) by"],
  depends: ["depends on", "depended on by"],
  links: ["links to", "linked from"],
  mentions: ["mentions", "mentioned by"],
  reads: ["reads", "read by"],
  runs: ["runs", "run by"],
  uses: ["uses", "used by"],
  names: ["names the program", "named by"],
  deploys: ["records as deployed", "recorded as deployed by"],
  checks: ["is checked by", "checks the rule"],
  answers: ["answers the threat", "answered by the rule"],
  cites: ["cites", "cited by"],
};
/** The edges along which a change travels: if the target changes, the source may break. */
const CODE = new Set(["imports", "loads", "depends", "names", "runs", "reads", "checks"]);

export class Ambiguous extends Error {
  constructor(name, candidates) {
    super(`"${name}" matches ${candidates.length} points; say which:\n  ${candidates.join("\n  ")}`);
    this.candidates = candidates;
  }
}
export class NotFound extends Error {
  constructor(name) {
    super(`nothing on the map is called "${name}"`);
  }
}

/** The graph with its indexes, built once per run. */
export function load(graph = extract()) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map(), inn = new Map();
  for (const n of graph.nodes) {
    out.set(n.id, []);
    inn.set(n.id, []);
  }
  for (const e of graph.edges) {
    out.get(e.from).push(e);
    inn.get(e.to).push(e);
  }
  const regions = new Map(graph.regions.map((r) => [r.id, r]));
  return { graph, byId, out, inn, regions };
}

/** One point by its id or the end of its path; refuses to guess between several. */
export function resolve(map, name) {
  if (map.byId.has(name)) return map.byId.get(name);
  const lower = name.toLowerCase();
  const exact = map.graph.nodes.filter((n) => n.id.toLowerCase() === lower || (n.path && n.path.toLowerCase() === lower));
  if (exact.length === 1) return exact[0];
  const ends = map.graph.nodes.filter((n) => n.path && (n.path.endsWith(`/${name}`) || n.path === name));
  if (ends.length === 1) return ends[0];
  if (ends.length > 1) throw new Ambiguous(name, ends.map((n) => n.id));
  const loose = map.graph.nodes.filter((n) => n.id.toLowerCase().includes(lower) || n.label.toLowerCase() === lower);
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) throw new Ambiguous(name, loose.slice(0, 20).map((n) => n.id));
  throw new NotFound(name);
}

const degree = (map, id) => map.out.get(id).length + map.inn.get(id).length;
const where = (map, n) => `${map.regions.get(n.region)?.name ?? n.region} · ${n.kind}${n.lines ? ` · ${n.lines} lines` : ""}`;

export function show(map, name) {
  const n = resolve(map, name);
  const lines = [`${n.id}`, `  ${where(map, n)}`, `  ${n.holds || "(no description)"}`];
  const rules = (n.rules ?? []).filter((r) => r !== n.id);
  if (rules.length) lines.push(`  rules: ${rules.join(" ")}`);
  const groups = new Map();
  for (const e of map.out.get(n.id)) {
    const k = WORDS[e.kind][0];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e.to);
  }
  for (const e of map.inn.get(n.id)) {
    const k = WORDS[e.kind][1];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e.from);
  }
  if (groups.size === 0) lines.push("  no edges: nothing on the map points at it, and it points at nothing");
  for (const [k, ids] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${k} (${ids.length}):`);
    for (const id of ids.sort()) lines.push(`    ${id}`);
  }
  return lines.join("\n");
}

export function impact(map, name, hops = 2, perRing = 40) {
  const n = resolve(map, name);
  const seen = new Map([[n.id, 0]]);
  let frontier = [n.id];
  const rings = [];
  for (let h = 1; h <= hops && frontier.length; h++) {
    const next = [];
    for (const id of frontier) {
      for (const e of map.inn.get(id)) {
        if (!CODE.has(e.kind) || seen.has(e.from)) continue;
        seen.set(e.from, h);
        next.push(e.from);
      }
    }
    rings.push(next.sort());
    frontier = next;
  }
  const total = rings.reduce((s, r) => s + r.length, 0);
  const lines = [`${n.id}: ${total} points reach it through code within ${hops} hops (imports, loads, depends, names, runs, reads, checks)`];
  rings.forEach((ring, i) => {
    if (!ring.length) return;
    lines.push(`  ${i + 1} hop${i ? "s" : ""} (${ring.length}):`);
    for (const id of ring.slice(0, perRing)) lines.push(`    ${id}`);
    if (ring.length > perRing) lines.push(`    … and ${ring.length - perRing} more`);
  });
  const docs = map.inn.get(n.id).filter((e) => !CODE.has(e.kind)).map((e) => `${e.from} (${e.kind})`).sort();
  if (docs.length) lines.push(`  also pointed at by documents and rules (${docs.length}):`, ...docs.map((d) => `    ${d}`));
  return lines.join("\n");
}

export function path(map, a, b) {
  const from = resolve(map, a), to = resolve(map, b);
  const prev = new Map([[from.id, null]]);
  const queue = [from.id];
  while (queue.length) {
    const id = queue.shift();
    if (id === to.id) break;
    const steps = [...map.out.get(id).map((e) => [e.to, e, ">"]), ...map.inn.get(id).map((e) => [e.from, e, "<"])];
    for (const [next, e, dir] of steps) {
      if (prev.has(next)) continue;
      prev.set(next, { id, e, dir });
      queue.push(next);
    }
  }
  if (!prev.has(to.id)) return `${from.id} and ${to.id} aren't connected on the map`;
  const chain = [];
  for (let cur = to.id; prev.get(cur); cur = prev.get(cur).id) chain.unshift(prev.get(cur));
  const lines = [`${from.id} to ${to.id}: ${chain.length} ${chain.length === 1 ? "edge" : "edges"}`, `  ${from.id}`];
  let cur = from.id;
  for (const step of chain) {
    const next = step.dir === ">" ? step.e.to : step.e.from;
    lines.push(`  ${step.dir === ">" ? `--${step.e.kind}-->` : `<--${step.e.kind}--`} ${next}`);
    cur = next;
  }
  return lines.join("\n");
}

export function rule(map, id) {
  const n = resolve(map, id.toUpperCase());
  if (!["invariant", "operating rule", "threat"].includes(n.kind)) return `${n.id} is a ${n.kind}, not a rule or a threat; try: show ${n.id}`;
  const lines = [`${n.id} (${n.kind})`, `  ${n.holds}`];
  const group = (label, ids) => {
    if (!ids.length) return;
    lines.push(`  ${label} (${ids.length}):`, ...ids.sort().map((x) => `    ${x}`));
  };
  group("checked by", map.out.get(n.id).filter((e) => e.kind === "checks").map((e) => e.to));
  group("answers", map.out.get(n.id).filter((e) => e.kind === "answers").map((e) => e.to));
  group("answered by", map.inn.get(n.id).filter((e) => e.kind === "answers").map((e) => e.from));
  group("cited by", map.inn.get(n.id).filter((e) => e.kind === "cites").map((e) => e.from));
  return lines.join("\n");
}

export function find(map, text, limit = 30) {
  const q = text.toLowerCase();
  const hits = map.graph.nodes.filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q) || (n.holds ?? "").toLowerCase().includes(q));
  hits.sort((a, b) => degree(map, b.id) - degree(map, a.id));
  if (!hits.length) return `nothing on the map matches "${text}"`;
  const lines = [`${hits.length} ${hits.length === 1 ? "point matches" : "points match"} "${text}"${hits.length > limit ? `, the ${limit} most connected:` : ":"}`];
  for (const n of hits.slice(0, limit)) lines.push(`  ${n.id}  (${where(map, n)}, ${degree(map, n.id)} edges)`);
  return lines.join("\n");
}

export function hubs(map, region, n = 15) {
  let nodes = map.graph.nodes;
  if (region) {
    const r = [...map.regions.values()].find((r) => r.id === region || r.name.toLowerCase() === region.toLowerCase());
    if (!r) return `no region called "${region}"; they are: ${[...map.regions.keys()].join(", ")}`;
    nodes = nodes.filter((x) => x.region === r.id);
  }
  const top = [...nodes].sort((a, b) => degree(map, b.id) - degree(map, a.id)).slice(0, n);
  const lines = [`the ${top.length} most connected points${region ? ` in ${region}` : ""} (in → point → out):`];
  for (const x of top) lines.push(`  ${String(map.inn.get(x.id).length).padStart(4)} → ${x.id} → ${map.out.get(x.id).length}`);
  return lines.join("\n");
}

export function regions(map) {
  const counts = new Map();
  for (const n of map.graph.nodes) counts.set(n.region, (counts.get(n.region) ?? 0) + 1);
  const lines = [`${map.graph.nodes.length} points, ${map.graph.edges.length} edges, ${map.regions.size} regions:`];
  for (const r of map.regions.values()) lines.push(`  ${r.id.padEnd(10)} ${String(counts.get(r.id) ?? 0).padStart(5)}  ${r.name}: ${r.description}`);
  return lines.join("\n");
}

const USAGE = `usage: node docs/map/query.mjs <show|impact|path|rule|find|hubs|regions> ...
  show <file|id>         what it is, its rules, every edge grouped by kind and direction
  impact <file> [hops]   what reaches it through code within N hops (default 2): what a change can break
  path <a> <b>           the shortest chain of edges between two points
  rule <INV-07|OPS-01|T18>   its checks, its threats, who cites it
  find <text>            points whose path, name or description match
  hubs [region] [n]      the most-connected points, overall or in one region
  regions                the regions and their counts`;

export function run(argv, map = load()) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "show":
      if (!args[0]) throw new Usage();
      return show(map, args[0]);
    case "impact":
      if (!args[0]) throw new Usage();
      return impact(map, args[0], args[1] ? Number(args[1]) : 2);
    case "path":
      if (!args[1]) throw new Usage();
      return path(map, args[0], args[1]);
    case "rule":
      if (!args[0]) throw new Usage();
      return rule(map, args[0]);
    case "find":
      if (!args[0]) throw new Usage();
      return find(map, args.join(" "));
    case "hubs":
      return hubs(map, args[0] && Number.isNaN(Number(args[0])) ? args[0] : undefined, Number(args.find((a) => !Number.isNaN(Number(a)))) || 15);
    case "regions":
      return regions(map);
    default:
      throw new Usage();
  }
}
export class Usage extends Error {
  constructor() {
    super(USAGE);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(e instanceof Usage ? 2 : e instanceof Ambiguous ? 3 : e instanceof NotFound ? 4 : 1);
  }
}
