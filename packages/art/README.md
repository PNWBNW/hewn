# @pnw/art

The renderer behind the cards (`docs/HEWN_ART.md`): a business's land as a topographic map, a
paystub's log of rings, the person's constellation, the live sky, and a worker's land in 3D.
The 2D cards are SVG text built here, so a card is deterministic (the same inputs, the same
bytes), testable byte for byte and crisp at any size. The land is three.js: its scene is
deterministic as data (`land.ts`, tested), its pixels come from a browser's graphics chip
(`land3d.ts`, loaded only by the pages that show a land), and a worker's card wraps that one
picture in the same SVG frame.

Rules the package keeps:

- **A card is a pure function of its inputs.** The only randomness is a seeded generator
  (`seed.ts`: mulberry32 over an FNV-1a seed of a label). No clock, no `Math.random`. The hour
  and the season are inputs; whoever draws passes the moment.
- **Versioned.** `ART_VERSION` is 1. A change to what a card looks like bumps it; a card issued
  under a version is always drawn with that version.
- **No product name.** Every word on a card is passed in by the app. Colours come from
  `@pnw/brand`, the one place they live.
- **One raster, by hand.** The map's tint and hillshade are painted at the heightmap's own
  resolution (96 by 70) and written as a PNG by `png.ts` (stored deflate, CRC and Adler by hand,
  base64 by hand), so the bytes are the same on every machine and nothing is imported for it.
  The SVG scales it up smooth.

| File | What |
|---|---|
| `seed.ts` | The generator, the seed of a label, colour mixing, `ART_VERSION` |
| `svg.ts` | Elements as text: stable numbers (two decimals, never `-0`), escaped words |
| `png.ts` | The PNG writer for the map's raster |
| `sky.ts` | The sky's two colours by the hour, night, the season of a date |
| `constellation.ts` | The person's stars from their name; the record lights one |
| `map.ts` | The terrain from a name, the tint and hillshade, contours by marching squares, the cyan contour at the years on Hewn, the cross-section |
| `rings.ts` | The log: bark, wood, one ring a paycheck, this one cyan, a reversed one dashed |
| `land.ts` | A worker's land as data: the genome a name gives, the terrain the river carves, the mountains scaled to leave the sky, each landmark's best spot, the trees in groves, the rocks, the grass, the ground's colour |
| `land3d.ts` | The three.js scene from that data (sky dome with the sun or the moon, the water, the models: cabin, bridge, fire lookout, cairn, the pine) and one render of it with bloom, plus a mask render for the skyline. Browser only |
| `card.ts` | The 400 by 600 cards: a business's (the map), a paystub's face (the log) and a worker's (the rendered land, their constellation in its sky) |

Tests: `src/art.test.ts` pins the determinism, the PNG's validity (its stream inflates back with
Node's zlib), the constellation's rules, the map's structure and the cards' words and escaping;
`src/land.test.ts` the genome's ranges and the river's three entries, the water staying below its
banks, the range leaving the sky, the landmarks on the card and out of the water, the forest clear
of them, and the constellation's spot in the sky.
