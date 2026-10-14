# Hewn brand assets

`source/` holds the original artwork: the logo on light and on dark, the front-page hero, the app icon
(`hewn-icon.png`), the "Every business. One Hewn." strip, and the product tiles in `tiles/`.
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
| `public/brand/hewn-mark.png` | The pine-cone tile (the app icon) |
| `public/brand/hewn-wordmark-{green,cream}.png` | "Hewn Accounting" lettering, transparent; green on light, cream on dark |
| `public/brand/hewn-tile-{books,payroll,invoices,reports}.png` | Product tiles on the marketing site (`tiles/farm.png` and `tiles/build.png` wait for their templates) |
| `public/brand/hewn-hero-*.{webp,jpg}` | Setup/unlock screens, the site and the README |

Colours: green `#113b31`, cream `#f5f0e3`, ink `#091623`, gold `#f8d084`,
cyan `#18dccb` (tokens in `packages/ui/src/tokens.css`).

The app icon source is 217 px, so the 512 px icons are upscaled. Drop in a vector (SVG) or ≥1024 px
source as `hewn-icon.png` and re-run the script for crisper icons.
