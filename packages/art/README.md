# @pnw/art

The renderer behind the cards (`docs/HEWN_ART.md`): a business's land as a topographic map, a
paystub's log of rings, the person's constellation, the live sky. Everything is SVG text built
here, so a card is deterministic (the same inputs, the same bytes), testable byte for byte and
crisp at any size. The worker's land in 3D is not here yet (it will load three.js only on the
pages that show it).

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
| `card.ts` | The 400 by 600 cards: a business's (the map) and a paystub's face (the log) |

Tests: `src/art.test.ts` pins the determinism, the PNG's validity (its stream inflates back with
Node's zlib), the constellation's rules, the map's structure and the cards' words and escaping.
