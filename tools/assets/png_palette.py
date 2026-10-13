"""Ricomprime PNG pixel art in modalità palette (lossless se <= 256 colori RGBA)."""
import sys, os
from PIL import Image

def to_palette(path):
    im = Image.open(path).convert("RGBA")
    colors = im.getcolors(256)
    if colors is None:
        return False
    pal_colors = [c for _, c in colors]
    # trasparente per primo
    pal_colors.sort(key=lambda c: c[3])
    idx = {c: i for i, c in enumerate(pal_colors)}
    out = Image.new("P", im.size)
    out.putdata([idx[p] for p in im.getdata()])
    flat = []
    for c in pal_colors: flat += c[:3]
    out.putpalette(flat + [0] * (768 - len(flat)))
    alpha = bytes(c[3] for c in pal_colors)
    before = os.path.getsize(path)
    tmp = path + ".tmp.png"
    out.save(tmp, optimize=True, transparency=alpha)
    assert list(Image.open(tmp).convert("RGBA").getdata()) == list(im.getdata()), path  # lossless
    if os.path.getsize(tmp) < before:
        os.replace(tmp, path)
    else:
        os.remove(tmp)                      # l'originale era già più piccolo
    return before, os.path.getsize(path)

tot_b = tot_a = 0
for root in sys.argv[1:]:
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.endswith(".png"):
                r = to_palette(os.path.join(d, f))
                if r: tot_b += r[0]; tot_a += r[1]
print(f"{tot_b//1024} KB -> {tot_a//1024} KB")
