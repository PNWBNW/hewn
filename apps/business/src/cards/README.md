# src/cards

The cards as the app draws them (`docs/HEWN_ART.md`), one component each, on top of the renderer
in `packages/art`. Pure drawing: each takes what it needs as props (a name, a card's issue block, a
paystub's hash and place in its year) and puts the renderer's SVG text straight into the page,
every word escaped by the renderer. No chain package is imported here: what a card needs from the
chain reaches it through the vault or the page.

| File | Draws |
|---|---|
| `BusinessCardArt.tsx` | A business's card: its land as a map, the cyan contour at its years on Hewn. Settings and the public card page |
| `WorkerCardArt.tsx` | A worker's card: their land in 3D (the three.js renderer loads only here), the pine grown with their years, their constellation. The private view in Settings and the public view on the card page |
| `PaystubCardArt.tsx` | A paystub's card: the log of rings, this paycheck's cyan, the lit star from the paystub's hash. The person's Paystubs and the business's paystub view |

Tests beside each pin the words on the card and that the same inputs draw the same card.
