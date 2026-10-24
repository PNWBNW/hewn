import json, sys, os, collections
from PIL import Image
d = sys.argv[1]
res = json.load(open(os.path.join(d, "results.json")))
cols, w, h = 10, 200, 300
rows = (len(res) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols + 1) * 8, rows * h + (rows + 1) * 8), (233, 228, 214))
for i in range(len(res)):
    im = Image.open(os.path.join(d, f"{i:02d}.jpg")).resize((w, h), Image.LANCZOS)
    sheet.paste(im, (8 + (i % cols) * (w + 8), 8 + (i // cols) * (h + 8)))
sheet.save(os.path.join(d, "sheet.jpg"), quality=85)
bad = [r for r in res if r["flags"]]
print(f"{len(res) - len(bad)}/{len(res)} pass", "entry", dict(collections.Counter({-1:"left",0:"middle",1:"right"}[r["entry"]] for r in res)), "lakes", sum(r["head"]=="lake" for r in res))
kinds = collections.Counter(f.split(" ")[0] + " " + " ".join(f.split(" ")[1:]).split("%")[-1].strip() for r in bad for f in r["flags"])
for k, v in kinds.most_common():
    print(f"  {v:2d}  {k}")
for i, r in enumerate(res):
    if r["flags"]:
        print(f"{i:02d} {r['name']}: {'; '.join(r['flags'])}  water={r['water']}")
