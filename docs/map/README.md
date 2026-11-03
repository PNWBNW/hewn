# docs/map

The map of Hewn, drawn in 3D: glowing points in regions, lines between them coloured by what
crosses, a legend, labels, and a panel for the point you tap. It lives on GitHub Pages at
[pnwbnw.github.io/hewn](https://pnwbnw.github.io/hewn), built from the tree on every push to
`main`, so it always shows the current state and nothing generated is committed. Nothing of it
is on the product's website: it's a window into the repository, for people reading the code and
for the agents that work on it.

Views so far:

| View | What it shows | Written companion |
|---|---|---|
| `data-flow` | Every place Hewn's data can be and every flow between them, each classed private, sealed, public or control, each citing its rule | [`../security/DATA_FLOW.md`](../security/DATA_FLOW.md) |

Next: the whole tree (every file, package, document, rule and program, and how they connect), as
a second view on the same page, and a query script for agents.

## What's here

| File | What |
|---|---|
| `data/*.json` | One graph per view: `regions` (with a position `at`, like the lobes of a brain, and a colour), `nodes` (in a region, with a kind, a class, what it holds and the rules it cites), `edges` (from, to, what crosses, class, rules), `classes`. The source of truth; hand-written for `data-flow`. |
| `layout.mjs` | Where every point sits: regions where the data puts them, points settled inside their region by a small seeded force simulation. Pure, deterministic. |
| `build.mjs` | Checks the graphs (a dangling edge, an unknown region or class, a rule id not in `INVARIANTS.md` or `THREAT_MODEL.md` all fail), lays them out, writes the generated tables into each companion (`--doc`), and builds `dist/`: the viewer, the laid-out graphs, three.js and the few addons the viewer imports, copied from the art package's dependency so the page loads nothing from any other host. |
| `index.html`, `map.css`, `map.js` | The viewer. three.js with bloom; an import map points `three` at `./vendor`. It keeps nothing: no storage, no cookies, no requests to any other host. |
| `dist/` | The built site (ignored by git). |

## Commands

```bash
node docs/map/build.mjs --check   # what CI runs: the graphs and the companions are sound
node docs/map/build.mjs --doc     # after editing data/: rewrite the companions' generated tables
pnpm map                          # build dist/ (needs pnpm install, for three.js)
python3 -m http.server 8765 -d docs/map/dist   # then open http://localhost:8765
```

The address can name a view and a point to open: `#data-flow:d.vault`.

## How it's published

`.github/workflows/map.yml` runs on every push to `main`: installs the art package's
dependencies, builds `dist/` and deploys it to GitHub Pages. It is the one automatic workflow with
a write permission, and it writes to Pages alone (`docs/INVARIANTS.md`, OPS-05). The CI gate
(`ci.yml`) runs `--check` on every pull request, so a graph that drifts from the rules, or a
companion that drifts from its graph, can't merge.

## Rules it keeps

- **The data is the document.** The companion's tables and diagram are generated from the graph;
  CI fails when they differ. A new place for data is a change to the JSON, in the same pull
  request as the code.
- **Every point and flow cites a rule.** Ids are checked against the invariants and the threat
  model, so the map can't claim a rule that doesn't exist.
- **Self-contained.** The page loads three.js from beside itself, never from a CDN, and sends
  nothing anywhere.
