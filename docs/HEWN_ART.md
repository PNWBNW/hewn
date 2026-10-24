# Hewn art: credential cards and paystub rings

**Status:** design, for review (Joshua, 2026-10-24). Concept sketches only
(`docs/art/concepts-2026-10-24.png`); nothing is in the app yet.

![Three credential cards and a paystub](art/concepts-2026-10-24.png)

## What it is

Every credential and every paystub gets a picture drawn from its own data, the way PNW's
topographic credential art was (`archive/packages/nft-art`), in Hewn's spirit: the Northwest of the
hero image, layered ridges fading into mist, evergreens, honest materials. The old art's best idea
stays (seeded terrain, so no two are alike); its blueprint look goes.

Cyan is used for three things only, each one meaningful:

| Cyan | Where | What it means |
|---|---|---|
| **The pine** | Credential cards | The logo's pine, standing in the forest. It grows with the person's **time on Hewn** (Joshua, 2026-10-24). Where it stands comes from the hash. |
| **The constellation** | Credential cards and paystubs | The person's **own constellation** (Joshua, 2026-10-24): the same shape on every card and paystub of theirs, drawn from their `name.hewn`. The record lights one of its stars, so the lit star is the record's **fingerprint**. |
| **This ring** | Paystubs | The paycheck in hand, among the year's rings. |

## The credential card

- **The scene:** four ridgelines, far ones pale and blue, near ones deep green, with mist between;
  snow on the highest; a forest along the front; the sun or the moon. Every shape comes from the
  credential's hash, so no two cards share a skyline.
- **The pine:** taller for each year since the person's `name.hewn` was registered. The sketches
  show 1 and 6 years.
- **The constellation:** small, six to eight stars, always in the sky: above the mountains with a
  gap and clear of the sun or moon. Only its place and size change from card to card, never its
  shape. Faint teal by day, glowing cyan at dusk and night.
- **The words:** the `name.hewn`, the kind of credential, the title, the business, the dates, a
  short fingerprint, and "hewn · proven on Aleo".

## The paystub

A hewn log's cross-section: one ring per paycheck this year, the rings still to come faint, this
paycheck's ring cyan (no crack: Joshua, 2026-10-24). The person's constellation sits in the top
corner, with this paystub's star lit. At year end the log is whole: a year-end card. Ring widths come from the paystub's
hash, never from the pay or the hours.

## The constellation and the fingerprint (Joshua, 2026-10-24)

- **The shape is the person's.** All of it comes from their `name.hewn`, so `ana_w.hewn` has
  exactly the same constellation on every credential and every paystub she will ever have. People
  come to know it as hers.
- **The lit star is the record's.** Which of her stars is lit, brighter with a glint, comes from the
  record: for a credential, its public commitment on Aleo; for a paystub, the paystub document's
  hash, which both sides hold (so the business's copy and hers light the same star).
- **The rest of the record's fingerprint is the landscape:** the ridgelines, the snow, the forest and
  where her pine stands all come from the same commitment.
- **Checking it:** anyone can redraw a credential's card from the chain and the name. A card whose
  constellation isn't the name's, or whose landscape or lit star doesn't match the commitment, is
  not genuine.
- **It never changes:** the drawing is a pure function of its inputs (a seeded generator, fixed
  layout, no clock, no `Math.random`), and the renderer is versioned. A change to the art ships as
  `art v2`; a card issued under v1 is always drawn with v1.

## Privacy

What goes in: hashes, the `name.hewn` (public already), the kind of credential, its dates, the
paycheck's number in the year and the time on Hewn. Never a wage, an amount, hours, an address or
an account. Showing a card shows what's written on it and nothing more; the person decides whether
to show it at all.

## Building it

1. **The renderer**, as SVG: deterministic text, testable byte for byte, crisp at any size and in
   PDFs. A package of its own (`packages/art`), with tests that the same input always draws the
   same picture and different inputs don't.
2. **Paystub rings** on the person's Paystubs and the business's paystub view, and in the PDF.
   App only: no Leo.
3. **Credential cards**, which need a credential program: the deployed `credential_nft_v3` and
   `v4` check agreements in `employer_agreement_v4`, so a v5 agreement can't mint one. A new
   program (new Leo, Fable 5.1 at high effort, must-fail tests), then the cards.
4. **A verify page:** paste a card's fingerprint or open its link; the page redraws the
   constellation from the chain and shows whether it matches.

## Open questions

1. What the time of day, the season or the weather in the scene stand for: the kind of credential
   (the sketches use dawn for employment, day for a certification, night for years of service),
   or nothing at all.
2. Whether a business gets a card of its own (its pine, its constellation).
3. Time on Hewn: from the name's registration on chain if the registry keeps the height,
   otherwise from the first agreement.
