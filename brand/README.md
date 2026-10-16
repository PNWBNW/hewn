# Hewn brand assets

`source/` holds the original artwork: the logo on light and on dark, the front-page hero, the app icon
(`hewn-icon.svg`, rendered to `hewn-icon.png`), the "Every business. One Hewn." strip, and the product tiles in `tiles/`.
Everything the app (`apps/business`) and the marketing site (`apps/site`) serve is generated from it:

```sh
python3 brand/build_assets.py   # needs Pillow
```

The files are generated once into `apps/business/` and copied byte-for-byte into `apps/site/`
(the `APPS` list in the script). Never hand-edit either copy. The name, tagline, colours and asset
paths the code uses live in `packages/brand`.

| Output | Use |
|---|---|
| `apps/*/src/app/icon.png`, `apple-icon.png`, `favicon.ico` | Browser tab, iOS home screen (Next.js picks these up by filename) |
| `public/brand/hewn-icon-{192,512}.png`, `hewn-icon-maskable-512.png` | Installable app icons (`src/app/manifest.ts`) |
| `public/brand/hewn-mark.png` | The H tile (the app icon) |
| `public/brand/hewn-wordmark-{green,cream}.png` | "Hewn Accounting" lettering, transparent; green on light, cream on dark |
| `public/brand/hewn-tile-{books,payroll,invoices,reports}.png` | Product tiles on the marketing site (`tiles/farm.png` and `tiles/build.png` wait for their templates) |
| `public/brand/hewn-hero-*.{webp,jpg}` | Setup/unlock screens, the site and the README |

Colours: green `#113b31`, cream `#f5f0e3`, ink `#091623`, gold `#f8d084`,
cyan `#18dccb` (tokens in `packages/ui/src/tokens.css`).

The app icon is the Hewn H with a cyan pine in its left leg, cream on green
(`source/hewn-icon.svg`). It is a full square with the H in the middle half, so it works as the
iOS icon, the maskable app icon and an X avatar unchanged. After editing the SVG, render it to
`source/hewn-icon.png` at 1024 px (any browser or `rsvg-convert -w 1024`) and re-run the script.
