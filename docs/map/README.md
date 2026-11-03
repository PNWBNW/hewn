# docs/map

The map of Hewn, drawn in 3D: glowing points in regions, lines between them coloured by what
crosses, a legend, labels, and a panel for the point you tap. It lives on GitHub Pages at
[pnwbnw.github.io/hewn](https://pnwbnw.github.io/hewn), built from the tree on every push to
`main`, so it always shows the current state and nothing generated is committed. Nothing of it
is on the product's website: it's a window into the repository, for people reading the code and
for the agents that work on it.

The views, on one page (the switch at the top right; the address names one, `#project`):

| View | What it shows | Source |
|---|---|---|
| `project` | The whole tree: every file git tracks here and in the Leo programs' repository (the `pnw_mvp_v2` submodule), every rule and threat, every declared dependency, and how they connect. Edges are facts read from the files: imports and dynamic loads, package dependencies, links and mentions between documents, what a script reads, what a workflow runs and uses, which program a file names or imports, what the manifest records as deployed, what a rule checks and answers, who cites a rule. | `extract.mjs`, from the tree itself |
| `data-flow` | Every place Hewn's data can be and every flow between them, each classed private, sealed, public or control, each citing its rule | `data/data_flow.json`, hand-written; companion [`../security/DATA_FLOW.md`](../security/DATA_FLOW.md) |

The README's picture at the top of the repository is `still.svg`, the project view from one fixed
angle, drawn in Node at build time, so it is as current as the page.

**For agents and anyone at a terminal**, the same graph answers questions without the page
(`query.mjs`; it runs the extractor fresh, so it is never stale):

```bash
node docs/map/query.mjs show books/close.ts      # what it is, its rules, every edge grouped by kind and direction
node docs/map/query.mjs impact books/close.ts    # what reaches it through code within 2 hops: what a change can break
node docs/map/query.mjs path app/transactions/page.tsx payroll_audit_log.aleo/src/main.leo
node docs/map/query.mjs rule INV-07              # its checks, its threats, who cites it
node docs/map/query.mjs find "close the books"   # points whose path, name or description match
node docs/map/query.mjs hubs chain 10            # the most-connected points, overall or in a region
node docs/map/query.mjs regions
```

A name may be a full id or the end of a path; one that matches several points is refused with
the candidates listed (exit 3), never guessed; nothing found is exit 4. `CLAUDE.md` asks agents
to run `show` and `impact` on a file before changing it, and to ask the map before grepping.

## What's here

| File | What |
|---|---|
| `data/*.json` | One graph per hand-written view: `regions` (with a position `at`, like the lobes of a brain, and a colour), `nodes` (in a region, with a kind, a class, what it holds and the rules it cites), `edges` (from, to, what crosses, class, rules), `classes` (with a colour each). The source of truth for `data-flow`. |
| `extract.mjs` | The `project` view, read from the tree: `git ls-files` in both repositories, a region per path (the table at its top, first match wins), each file's own first comment or paragraph as its description, and the edges listed above. It resolves TypeScript imports the way the build does (relative, `@/`, workspace `exports`, declared dependencies), Leo imports to the program's `main.leo` (live first, then stubs and the archive), and refuses to run without the submodule rather than draw a map with a hole in it. |
| `extract.test.mjs` | Known facts the extractor must find (an import, a dynamic load, a program named by the app, a program importing another, a rule's check, a workflow's step), run by `node --test docs/map/*.test.mjs` in CI. |
| `query.mjs`, `query.test.mjs` | The questions above, as functions over the extracted graph plus a command line; the test pins their answers on known facts (who imports `close.ts`, the path from a screen to a program, a rule's checks, an ambiguous name refused). |
| `still.mjs` | The still: a laid-out graph projected from one angle to SVG, deterministic, no scripts or external references. |
| `bodies.mjs` | A point's size, glow and name from its connections and lines, shared by the page and the still. |
| `layout.mjs` | Where every point sits: regions where the data puts them, points settled inside their region by a small seeded force simulation. Pure, deterministic. |
| `build.mjs` | Checks the graphs (a dangling edge, an unknown region or class, a rule id not in `INVARIANTS.md` or `THREAT_MODEL.md` all fail), lays them out, writes the generated tables into each companion (`--doc`), and builds `dist/`: the viewer, the laid-out graphs, three.js and the few addons the viewer imports, copied from the art package's dependency so the page loads nothing from any other host. |
| `index.html`, `map.css`, `map.js` | The viewer. three.js with bloom; an import map points `three` at `./vendor`. It keeps nothing: no storage, no cookies, no requests to any other host. |
| `dist/` | The built site (ignored by git). |

## Commands

```bash
git submodule update --init pnw_mvp_v2   # once: the extractor reads the programs' repository
node docs/map/build.mjs --check   # what CI runs: the graphs and the companions are sound
node --test docs/map/extract.test.mjs docs/map/query.test.mjs   # the extractor and the queries find the known facts
node docs/map/build.mjs --doc     # after editing data/: rewrite the companions' generated tables
pnpm map                          # build dist/ (needs pnpm install, for three.js)
python3 -m http.server 8765 -d docs/map/dist   # then open http://localhost:8765
```

The address can name a view and a point to open: `#data-flow:d.vault`,
`#project:apps/business/src/books/close.ts`. A point's panel links to the file on GitHub (a
submodule's file at the commit the map was built from), lists its lines, the rules it cites and
every edge, and walks to the other end of any of them.

**Filters** (top right) switch kinds of points and lines on and off: code, tests, documents,
images, Leo programs, rules, threats, dependencies; imports, loads, links, mentions, checks,
cites and the rest, each with its count. A hidden point takes its lines with it; the legend
counts what is shown ("74 of 77").

## How it's published

`.github/workflows/map.yml` runs on every push to `main`: checks out the submodule, installs the
art package's dependencies, builds `dist/` and deploys it to GitHub Pages. It is the one automatic workflow with
a write permission, and it writes to Pages alone (`docs/INVARIANTS.md`, OPS-05). The CI gate
(`ci.yml`) runs `--check` on every pull request, so a graph that drifts from the rules, or a
companion that drifts from its graph, can't merge.

## Rules it keeps

- **The data is the document.** The companion's tables and diagram are generated from the graph;
  CI fails when they differ. A new place for data is a change to the JSON, in the same pull
  request as the code.
- **Nothing in the project view is guessed.** A point is a tracked file, a rule, a threat or a
  declared dependency; an edge exists only when its target resolves. What can't be resolved (an
  import of a package nobody declares, a link to a file that isn't there) is left out, never
  invented. The regions are the one editorial choice: a table of path prefixes at the top of
  `extract.mjs`, in the open.
- **Every point and flow cites a rule.** Ids are checked against the invariants and the threat
  model, so the map can't claim a rule that doesn't exist.
- **Self-contained.** The page loads three.js from beside itself, never from a CDN, and sends
  nothing anywhere.
- **Size is connections and length** (`bodies.mjs`). A point's size is continuous: every edge at
  it adds to it, and so does every line of the file, with increments that shrink as it grows (a
  square-root curve), so nothing jumps and no hub swallows the map. A file nothing connects to
  stays a glint however long it is. The same scale names each point for its panel and the
  Bodies filter (dust, comet, moon, planet, giant, star, bright star, supergiant) and draws the
  still; the hotter the body, the wider and whiter its glow. In 3D the drawn size grows faster
  than the weight (a power curve), so the spread reads at a glance: a supergiant is some 25 times
  a comet.
