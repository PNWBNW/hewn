# docs/art/prototype — the art prototypes

The code behind the renders in `docs/art/` and the design in `docs/HEWN_ART.md`, kept as it was
when the design was settled (2026-10-24). It is a prototype, not the app: nothing here is imported,
built or tested by CI. The renderer the app will use (`packages/art`) starts from this.

| File | What it draws |
|---|---|
| `art.html` | The 2D cards, in plain canvas: the business's topographic map, the paystub log (face and back), credential frames and their landmarks, the constellation, the seal, the sky. No dependencies. |
| `land3d.html` | A worker's land in 3D (three.js): the genome from a `name.hewn` (range, foothills, river course and width, lake or bend, entry left, middle or right, valley, groves, tree mix, rocks), the river carving its valley, the four landmark models (cabin, bridge, fire lookout, cairn), the cyan pine, the constellation, and each landmark's placement (its best spot on the card, in sight, apart from the others). |
| `checker/` | The 100-name check: draws random names with every landmark and measures each card (each landmark on the card and in sight, the water's share, room for the constellation). |

About 3,200 lines once formatted (the files pack several statements to a line): `art.html` about
1,900, `land3d.html` about 1,300, the checker about 200.

## Running them

Serve the folder over HTTP (the 3D page uses modules), for example `python3 -m http.server 8765`.

- `art.html` opens as is.
- `land3d.html` needs three.js beside it, at the version it was built with:
  `npm install --no-save three@0.169.0` in this folder (`node_modules` is ignored by git). Then
  `land3d.html?grid=ana_w.hewn,kwame.hewn&hour=14&season=summer` draws one card per name; `mix=1`
  cycles the hour and the season across the cards.
- The checker: `python3 checker/mkcheck.py` from this folder writes `check.html` (the 3D page with
  `checker/check_block.js` patched in), `node checker/runcheck.mjs out checker/names50a.txt` draws
  and measures the names in Chromium through Playwright (its browser path is the one in our cloud
  sessions; change it for yours), and `python3 checker/sheet.py out` makes the contact sheet and
  prints the pass count. The paths in the scripts assume they run from this folder.

## Rules the app's renderer keeps

From `docs/HEWN_ART.md`: every card is a pure function of its inputs (a seeded generator, no
clock, no `Math.random`), so the same name and records always draw the same card; the renderer is
versioned (`art v1`), and a card issued under one version is always drawn with it. The 3D scene is
deterministic as data; its pixels may differ slightly between graphics chips, so a saved or printed
card is rendered once and kept as an image.
