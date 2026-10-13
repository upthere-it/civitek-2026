import sys, os
from PIL import Image, ImageDraw

D = sys.argv[1]
OUTP = sys.argv[2]
F = 64


def hex2rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def tint(img, color):
    """Moltiplica come Phaser setTint, ma lascia il nero (contorno) intatto."""
    c = hex2rgb(color)
    out = img.copy(); px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (r * c[0] // 255, g * c[1] // 255, b * c[2] // 255, a)
    return out


def frame(path, i=0):
    return Image.open(path).convert("RGBA").crop((i * F, 0, (i + 1) * F, F))


def compose(skin, hair, hair_col, hoodie_col, shoe_col, anim, d, i=0):
    key = f"{anim}_{d}"
    base = frame(f"{D}/body/skin_{skin}_{key}.png", i)
    for layer, col in (("pants", "#2d3a5a"), ("shoes", shoe_col), ("hoodie", hoodie_col), (f"hair_{hair}", hair_col)):
        base.alpha_composite(tint(frame(f"{D}/layers/{layer}_{key}.png", i), col))
    return base.crop((12, 10, 52, 54))  # ritaglio attorno al personaggio


combos = [
    (0, "corti", "#2b1d14", "#c8102e", "#f4f4f4"),
    (1, "lunghi", "#d9b45a", "#B26998", "#1d1d1f"),
    (2, "cappellino", "#c8102e", "#1d1d1f", "#f2c230"),
    (3, "corti", "#1a1a1a", "#f2c230", "#f4f4f4"),
    (4, "lunghi", "#8a5a2b", "#7b4fd6", "#c8102e"),
    (2, "cappellino", "#490D50", "#f4f4f4", "#E292C4"),
]
S = 4
cw, ch = 40 * S, 44 * S
rows = []
for anim, frames in (("idle", [0]), ("walk", [0, 2, 4])):
    for d in ("down", "side", "up"):
        for fi in frames:
            rows.append((anim, d, fi))
img = Image.new("RGBA", (len(combos) * cw + 140, len(rows) * ch), (70, 110, 70, 255))
dr = ImageDraw.Draw(img)
for r, (anim, d, fi) in enumerate(rows):
    dr.text((4, r * ch + ch // 2), f"{anim} {d} f{fi}", fill="white")
    for c, combo in enumerate(combos):
        a = compose(*combo, anim, d, fi).resize((cw, ch), Image.NEAREST)
        img.alpha_composite(a, (140 + c * cw, r * ch))
img.save(OUTP)
print(img.size)
