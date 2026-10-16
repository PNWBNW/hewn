#!/usr/bin/env python3
"""
Builds every Hewn web asset from the source art in brand/source/.
Re-run after replacing a source:  python3 brand/build_assets.py
Outputs go to <app>/public/brand/ and <app>/src/app/ (Next.js icon files) for every app in
APPS. The files are generated once and copied, so every app serves byte-identical assets.
"""
import os
import shutil
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "brand", "source")
APPS = ["business", "site"]  # the first one is generated into, the rest receive copies
PUB = os.path.join(ROOT, "apps", APPS[0], "public", "brand")
APP = os.path.join(ROOT, "apps", APPS[0], "src", "app")
ICON_FILES = ("icon.png", "apple-icon.png", "favicon.ico")
TILES = ("books", "payroll", "invoices", "reports")  # the product tiles the site shows; farm and build wait for their templates
os.makedirs(PUB, exist_ok=True)

GREEN = (17, 59, 49)      # #113b31, the icon tile
CREAM = (245, 240, 227)   # #f5f0e3, light background / dark-mode wordmark


def distance(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def content_bbox(im, bg, region=None, threshold=60):
    """Bounding box of every pixel that differs from the background colour."""
    px = im.load()
    W, H = im.size
    x0, y0, x1, y1 = region or (0, 0, W, H)
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if distance(px[x, y][:3], bg) > threshold:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def rounded_mask(size, radius, inset=0):
    """A rounded square, drawn at 4x and shrunk so the corners are smooth."""
    big = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (inset * 4, inset * 4, (size - inset) * 4 - 1, (size - inset) * 4 - 1), radius=radius * 4, fill=255
    )
    return big.resize((size, size), Image.LANCZOS)


def rounded_tile(path, out_size, trim=1):
    """A tile drawn on a cream page: cropped to the tile, corners made transparent."""
    im = Image.open(path).convert("RGB")
    bg = im.getpixel((2, 2))
    x0, y0, x1, y1 = content_bbox(im, bg)
    x0, y0, x1, y1 = x0 + trim, y0 + trim, x1 - trim, y1 - trim
    side = min(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    square = im.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    out = square.resize((out_size, out_size), Image.LANCZOS).convert("RGBA")
    out.putalpha(rounded_mask(out_size, radius=round(out_size * 0.2)))
    return out


def lettering(path, colour, panel=False):
    """The logo's lettering only, recoloured, on a transparent background.

    The light logo is lettering on cream. The dark logo is lettering on a navy panel that sits on
    a cream page, so for it we first find the panel, then work inside it."""
    im = Image.open(path).convert("RGB")
    page = im.getpixel((2, 2))
    if panel:
        px0, py0, px1, py1 = content_bbox(im, page, threshold=30)
        bg = im.getpixel((px0 + 14, (py0 + py1) // 2))
        region = (px0 + 18, py0 + 14, px1 - 18, py1 - 14)
    else:
        bg = page
        region = None
    x0, y0, x1, y1 = content_bbox(im, bg, region)
    crop = im.crop((x0 - 3, y0 - 3, x1 + 3, y1 + 3))
    px = crop.load()
    full = max(distance(px[x, y], bg) for x in range(crop.width) for y in range(crop.height))
    out = Image.new("RGBA", crop.size)
    o = out.load()
    for y in range(crop.height):
        for x in range(crop.width):
            a = max(0, min(255, round(255 * distance(px[x, y], bg) / full)))
            o[x, y] = (*colour, a)
    return out


def save_png(img, name, size, folder=PUB):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(folder, name), optimize=True)


def main():
    # Start clean so a rename never leaves stale files behind.
    for f in os.listdir(PUB):
        os.remove(os.path.join(PUB, f))

    # The icon source is a full green square with the H in its middle half (drawn as
    # hewn-icon.svg, rendered to hewn-icon.png at 1024 px). Square uses take it as is; the
    # rest get rounded corners.
    square = Image.open(os.path.join(SRC, "hewn-icon.png")).convert("RGB").resize((1024, 1024), Image.LANCZOS)
    tile = square.convert("RGBA")
    tile.putalpha(rounded_mask(1024, radius=round(1024 * 0.2)))

    # Next.js file conventions: src/app/icon.png, apple-icon.png, favicon.ico
    save_png(tile, "icon.png", 512, APP)
    square.resize((180, 180), Image.LANCZOS).save(os.path.join(APP, "apple-icon.png"), optimize=True)  # iOS rounds it itself
    tile.resize((64, 64), Image.LANCZOS).save(os.path.join(APP, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    # Web app manifest icons
    for s in (192, 512):
        save_png(tile, f"hewn-icon-{s}.png", s)
    # Maskable: the H already sits inside the middle 80% safe zone, so the full square works.
    square.resize((512, 512), Image.LANCZOS).save(os.path.join(PUB, "hewn-icon-maskable-512.png"), optimize=True)

    # In-app mark and lettering
    save_png(tile, "hewn-mark.png", 128)
    lettering(os.path.join(SRC, "hewn-logo-light.png"), GREEN).save(os.path.join(PUB, "hewn-wordmark-green.png"), optimize=True)
    lettering(os.path.join(SRC, "hewn-logo-dark.png"), CREAM, panel=True).save(os.path.join(PUB, "hewn-wordmark-cream.png"), optimize=True)

    # Product tiles for the marketing site (native size is plenty at 2-3x on a 56 px tile)
    for name in TILES:
        rounded_tile(os.path.join(SRC, "tiles", f"{name}.png"), 160).save(os.path.join(PUB, f"hewn-tile-{name}.png"), optimize=True)

    # Hero: WebP at two widths plus a JPEG fallback
    hero = Image.open(os.path.join(SRC, "hewn-hero.png")).convert("RGB")
    for w in (1536, 768):
        h = round(hero.height * w / hero.width)
        hero.resize((w, h), Image.LANCZOS).save(os.path.join(PUB, f"hewn-hero-{w}.webp"), quality=84, method=6)
    hero.save(os.path.join(PUB, "hewn-hero-1536.jpg"), quality=84, optimize=True, progressive=True)

    for f in sorted(os.listdir(PUB)):
        im = Image.open(os.path.join(PUB, f))
        print(f"{os.path.getsize(os.path.join(PUB, f)) // 1024:5d} KB  {im.size[0]}x{im.size[1]}  public/brand/{f}")
    for f in ICON_FILES:
        print(f"{os.path.getsize(os.path.join(APP, f)) // 1024:5d} KB  src/app/{f}")
    w = Image.open(os.path.join(PUB, "hewn-wordmark-green.png"))
    print(f"wordmarkAspect (width / height): {w.width} / {w.height}")

    # The other apps serve the same files: copy, never regenerate, so they stay byte-identical.
    for app in APPS[1:]:
        pub = os.path.join(ROOT, "apps", app, "public", "brand")
        app_dir = os.path.join(ROOT, "apps", app, "src", "app")
        os.makedirs(pub, exist_ok=True)
        os.makedirs(app_dir, exist_ok=True)
        for f in os.listdir(pub):
            os.remove(os.path.join(pub, f))
        for f in sorted(os.listdir(PUB)):
            shutil.copyfile(os.path.join(PUB, f), os.path.join(pub, f))
        for f in ICON_FILES:
            shutil.copyfile(os.path.join(APP, f), os.path.join(app_dir, f))
        print(f"copied to apps/{app}/")


main()
