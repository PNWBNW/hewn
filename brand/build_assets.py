#!/usr/bin/env python3
"""
Builds every Plumb web asset from the three source images in brand/source/.
Re-run after replacing a source:  python3 brand/build_assets.py
Outputs go to apps/business/public/brand/ and apps/business/src/app/ (Next.js icon files).
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "brand", "source")
PUB = os.path.join(ROOT, "apps", "business", "public", "brand")
APP = os.path.join(ROOT, "apps", "business", "src", "app")
os.makedirs(PUB, exist_ok=True)

GREEN = (17, 59, 49)      # #113b31, the icon tile
CREAM = (245, 240, 227)   # #f5f0e3, light background / dark-mode wordmark

def bbox_of_content(im, region=None, threshold=60):
    bg = im.getpixel((5, 5))
    px = im.load()
    W, H = im.size
    x0, y0, x1, y1 = region or (0, 0, W, H)
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y][:3]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > threshold:
                xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1

def rounded_mask(size, radius, inset=0):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((inset, inset, size - 1 - inset, size - 1 - inset), radius=radius, fill=255)
    return m

def icon_tile(source_path):
    """The rounded square mark, as a transparent-cornered RGBA square."""
    im = Image.open(source_path).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = bbox_of_content(im, (0, 0, int(W * 0.4), H))
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    square = im.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    big = square.resize((1024, 1024), Image.LANCZOS).convert("RGBA")
    # Trim 1.5% so no background fringe survives at the rounded corners.
    big.putalpha(rounded_mask(1024, radius=200, inset=16))
    return big

def save_png(img, name, size, folder=PUB):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(folder, name), optimize=True)

def wordmark(source_path, colour):
    """'Plumb' lettering only, recoloured, with a transparent background."""
    im = Image.open(source_path).convert("RGB")
    W, H = im.size
    bg = im.getpixel((5, 5))
    ix0, _, ix1, _ = bbox_of_content(im, (0, 0, int(W * 0.4), H))
    x0, y0, x1, y1 = bbox_of_content(im, (ix1 + 8, 0, W, H))
    crop = im.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4))
    px = crop.load()
    ink = max((px[x, y] for x in range(crop.width) for y in range(crop.height)),
              key=lambda p: abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]))
    full = sum(abs(a - b) for a, b in zip(ink, bg))
    out = Image.new("RGBA", crop.size)
    o = out.load()
    for y in range(crop.height):
        for x in range(crop.width):
            d = sum(abs(a - b) for a, b in zip(px[x, y], bg))
            o[x, y] = (*colour, max(0, min(255, round(255 * d / full))))
    return out

def main():
    tile = icon_tile(os.path.join(SRC, "plumb-logo-dark.png"))  # gold cone reads best at small sizes
    tile_light = icon_tile(os.path.join(SRC, "plumb-logo-light.png"))

    # Next.js file conventions: src/app/icon.png, apple-icon.png, favicon.ico
    save_png(tile, "icon.png", 512, APP)
    apple = Image.new("RGBA", (180, 180), (*GREEN, 255))  # iOS wants a full square; it rounds itself
    apple.alpha_composite(tile.resize((180, 180), Image.LANCZOS))
    apple.convert("RGB").save(os.path.join(APP, "apple-icon.png"), optimize=True)
    tile.resize((64, 64), Image.LANCZOS).save(os.path.join(APP, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    # Web app manifest icons
    for s in (192, 512):
        save_png(tile, f"plumb-icon-{s}.png", s)
    maskable = Image.new("RGBA", (512, 512), (*GREEN, 255))  # safe zone: art inside the middle 80%
    inner = tile.resize((410, 410), Image.LANCZOS)
    maskable.alpha_composite(inner, (51, 51))
    maskable.convert("RGB").save(os.path.join(PUB, "plumb-icon-maskable-512.png"), optimize=True)

    # In-app marks
    save_png(tile, "plumb-mark-dark.png", 128)
    save_png(tile_light, "plumb-mark-light.png", 128)
    wordmark(os.path.join(SRC, "plumb-logo-light.png"), GREEN).save(os.path.join(PUB, "plumb-wordmark-green.png"), optimize=True)
    wordmark(os.path.join(SRC, "plumb-logo-dark.png"), CREAM).save(os.path.join(PUB, "plumb-wordmark-cream.png"), optimize=True)

    # Hero: WebP at two widths plus a JPEG fallback
    hero = Image.open(os.path.join(SRC, "plumb-hero.png")).convert("RGB")
    for w in (1536, 768):
        h = round(hero.height * w / hero.width)
        r = hero.resize((w, h), Image.LANCZOS)
        r.save(os.path.join(PUB, f"plumb-hero-{w}.webp"), quality=82, method=6)
    hero.save(os.path.join(PUB, "plumb-hero-1536.jpg"), quality=82, optimize=True, progressive=True)
    for f in sorted(os.listdir(PUB)):
        print(f"{os.path.getsize(os.path.join(PUB, f)) // 1024:5d} KB  public/brand/{f}")
    for f in ("icon.png", "apple-icon.png", "favicon.ico"):
        print(f"{os.path.getsize(os.path.join(APP, f)) // 1024:5d} KB  src/app/{f}")

main()
