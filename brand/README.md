# Plumb brand assets

`source/` holds the original artwork (logo on light, logo on dark, front-page hero).
Everything the app serves is generated from it:

```sh
python3 brand/build_assets.py   # needs Pillow
```

| Output | Use |
|---|---|
| `apps/business/src/app/icon.png`, `apple-icon.png`, `favicon.ico` | Browser tab, iOS home screen (Next.js picks these up by filename) |
| `public/brand/plumb-icon-{192,512}.png`, `plumb-icon-maskable-512.png` | Installable app icons (`src/app/manifest.ts`) |
| `public/brand/plumb-mark-{dark,light}.png` | The pine-cone tile inside the app |
| `public/brand/plumb-wordmark-{green,cream}.png` | "Plumb" lettering, transparent; green on light, cream on dark |
| `public/brand/plumb-hero-*.{webp,jpg}` | Setup/unlock screens and the README (1.9 MB PNG → 86–301 KB) |

Colours sampled from the art: green `#113b31`, cream `#f5f0e3`, ink `#091623`, gold `#f8d084`,
cyan `#18dccb` (tokens in `packages/ui/src/tokens.css`).

The source logo's mark is about 190 px across, so the 512 px icons are upscaled. Drop in a vector
(SVG) or ≥1024 px source and re-run the script for crisper icons.
