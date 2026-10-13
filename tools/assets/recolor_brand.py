"""Ricolora i tetti verde acqua del pack con la palette Upthere (palette swap esatto, vetrate intatte)."""
import sys
from PIL import Image
SRC, DST, VARIANT = sys.argv[1], sys.argv[2], sys.argv[3]
TEAL = ["#18593f", "#247e5a", "#39a97c", "#44c591"]          # dal più scuro al più chiaro
RAMPS = {
    "plum":  ["#3A012D", "#490D50", "#6F305B", "#B26998"],    # accent-900, primary, primary-700, accent
    "mauve": ["#490D50", "#6F305B", "#B26998", "#E292C4"],    # primary, primary-700, accent, accent-400
}
h = lambda s: tuple(int(s.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
m = {h(a): h(b) for a, b in zip(TEAL, RAMPS[VARIANT])}
im = Image.open(SRC).convert("RGBA"); px = im.load()
for y in range(im.height):
    for x in range(im.width):
        p = px[x, y]
        if p[3] and p[:3] in m: px[x, y] = m[p[:3]] + (p[3],)
im.save(DST, optimize=True)
