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

## A live sky (Joshua, 2026-10-24)

![One card through a day](art/live-sky-2026-10-24.png)

The card is alive: its sky follows the **viewer's own clock**. The sun crosses from east to west
and sets behind the person's ridgeline; at night the moon rises in its real phase for the date and
the stars come out, with the person's constellation glowing among them (faint by day). Ana sees her
morning; a landlord in another time zone sees theirs.

- **The seasons follow the real date** (Joshua): snow down on the low ridges, the trees and the
  meadow in winter, wildflowers in spring, full green in summer, golden larches and dry grass in
  autumn. Northern hemisphere, as the app is. The pine stays cyan in every season: it is the person.
- **No motion** (Joshua, 2026-10-24): nothing drifts or twinkles. The card changes with the clock
  and the date, and is still in between.

![One card through the year](art/seasons-2026-10-24.png)
- **What never moves:** the landscape, the pine, the constellation's shape and the lit star (the
  fingerprint). Only the sky, the light and the season change, so a card is always checkable.
- **Saved or printed, it freezes at its birth sky** (Joshua): the sky, light and season at the
  moment the credential was issued, so a PDF or an image always looks the same.
- Nothing is sent anywhere: the device's clock and date only; the moon's phase is worked out on
  the device.

## A business's card: its land as a map (Joshua, 2026-10-24)

![Business cards](art/business-2026-10-24.png)

Joshua's original topographic idea, in Hewn's colours instead of the dark blueprint. A business's
card says only who it is and how long it has been on Hewn.

- **The map** is the business's own land: green-ink contours on cream paper, every fourth one
  heavier, a faint survey grid, a north arrow and a scale bar. The terrain comes from its
  `name.hewn`, so its land is always the same.
- **The cross-section** below, from the original, is cut through the summit and hatched.
- **Time on Hewn is the climbing contour:** one contour is cyan, one level higher for each year on
  Hewn, from the foothills toward the summit, and the same level runs across the cross-section in
  cyan ("4 yr"). No pine on a business's card (Joshua).
- **Its constellation** sits in the map's top corner, from its name, as a person's does.
- **Live, the map's way:** the slopes are shaded from where the sun really is on the viewer's clock
  (east in the morning, west in the evening); at night the map turns to dark paper with cream
  lines. The seasons tint the land: green in spring and summer, ochre in autumn, snow on the high
  ground in winter. No motion. Saved or printed, it freezes at its birth sky like every card.
- **To settle:** past about nine years the cyan contour nears the summit; it could then start a
  second ring low on the mountain, like a second lap.

### Issued with the account (Joshua, 2026-10-24)

Every business gets its card automatically when it sets up its account: a **public NFT** on Aleo,
minted in the same setup that registers its `name.hewn`.

- **On chain:** the business's name hash, its owner (public, as a business's name already is) and
  the block height it was issued at, which is where its time on Hewn counts from. The picture is
  drawn from those, by anyone, the same way every time; it is never stored on chain.
- **Testnet:** a small program of its own (new Leo), minting one card per business name, checked
  against the name registry (only the name's owner, only a business name, only once). Businesses
  that already exist claim theirs once, from Settings.
- **Mainnet:** a business's `name.hewn` will itself be an NFT under the Aleo Name Service (ARC-721),
  so the card can be that NFT's picture: one NFT, not two, shown in every ANS-aware wallet and
  explorer.
- **To settle:** whether the card stays with the wallet that registered the name (soulbound) or
  moves with the name if the name ever moves.

## The paystub

![The paystub card](art/paystub-2026-10-24.png)

A hewn log's cross-section: one ring per paycheck this year, the rings still to come faint, this
paycheck's ring cyan (no crack: Joshua, 2026-10-24). The person's constellation sits in the top
corner, with this paystub's star lit. Ring widths come from the paystub's hash, never from the pay
or the hours.

- **Entirely private** (Joshua, 2026-10-24): the face as much as the back. Only the person sees it,
  in their own app, and the business holds its copy. It is never shared or shown publicly. To prove
  income to a landlord or a lender, the person shares a proof (a yes or no, "over $3,000 a month for
  six months"), never the card. Saving or printing gives them a private file of their own, and the
  app says so first.
- **The face:** the log, the constellation, the pay period ("18 of 26 · 2026"), the employer, the
  dates and the pay date, and a check line ("Issued by dayco.hewn · paid on Aleo") shown only once
  the app has checked the record came from that employer through the paystub program.
- **The back** (flip the card): the paystub itself, every pay line, the withholdings, the net paid
  in USDCx, the year to date, and a way to make a proof of income from it.
- **The year-end log:** every ring complete, no cyan ring; "2026 · 26 paychecks" and the employer on
  the face, the year's totals on the back. One log per employer per year.
- **To settle:** the net pay on the face or every amount on the back; a corrected or reversed
  paycheck's ring dashed rather than removed; the season on the bark (snow for a January paycheck),
  fixed at the pay date.

## The constellation and the fingerprint (Joshua, 2026-10-24)

- **The shape is the person's.** All of it comes from their `name.hewn`, so `ana_w.hewn` has
  exactly the same constellation on every credential and every paystub she will ever have. People
  come to know it as hers.
- **The lit star is the record's.** Which of her stars is lit, brighter with a glint, comes from the
  record: for a credential, its public commitment on Aleo; for a paystub, the paystub document's
  hash, which both sides hold (so the business's copy and hers light the same star).
- **The rest of the record's fingerprint is the landscape:** the ridgelines, the snow, the forest and
  where her pine stands all come from the same commitment.
- **Checking it:** the app redraws a card only from a record it has checked (the right program,
  the right issuer), so a card in the app is genuine by being there. A drawing whose constellation
  isn't the name's, or whose landscape or lit star doesn't match the record, is not one of ours.
- **It never changes:** the drawing is a pure function of its inputs (a seeded generator, fixed
  layout, no clock, no `Math.random`), and the renderer is versioned. A change to the art ships as
  `art v2`; a card issued under v1 is always drawn with v1.

## Privacy (Joshua, 2026-10-24)

- **Every card is private:** credential cards and paystubs alike. Each is a private record on
  Aleo; its card shows only in its owner's app (and, for a paystub, the business's copy). Nothing
  about a person is ever shown publicly through their cards. When someone needs to prove something
  (a job, a licence, an income), they share a proof of that one fact, not a card.
- **The one exception: a business's card is public** (Joshua, 2026-10-24). It shows only the
  business's name and its time on Hewn, both public already, so anyone can see it (on its job
  postings and its directory listing, say) and redraw it from its name.
- What goes into any card: hashes, the `name.hewn`, the kind of credential, its dates, the
  paycheck's number in the year and the time on Hewn. Never a wage, an amount, hours, an address or
  an account in the art itself.

## Building it

1. **The renderer**, as SVG: deterministic text, testable byte for byte, crisp at any size and in
   PDFs. A package of its own (`packages/art`), with tests that the same input always draws the
   same picture and different inputs don't.
2. **Paystub rings** on the person's Paystubs and the business's paystub view, and in the PDF.
   App only: no Leo.
3. **Credential cards**, which need a credential program: the deployed `credential_nft_v3` and
   `v4` check agreements in `employer_agreement_v4`, so a v5 agreement can't mint one. A new
   program (new Leo, Fable 5.1 at high effort, must-fail tests), then the cards.
4. **Proofs instead of showing:** a person proves one fact from their private records (employed by,
   licensed as, earned over) without showing a card. And a business that makes its card public
   gets a page anyone can open, drawn from its name.

## Open questions

1. Time on Hewn: from the name's registration on chain if the registry keeps the height,
   otherwise from the first agreement.
