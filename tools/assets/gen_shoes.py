"""
Icone 32x32 PLACEHOLDER delle scarpe, generate in modo parametrico da silhouette + palette.
Nessun segno distintivo di marchi reali (niente swoosh, strisce, jazz stripe): solo pannelli generici.
Output: items/{item_id}.png, items_atlas.png + items_atlas.json (formato JSON Hash per Phaser),
        silhouettes/{silhouette}.png (maschera in grigi per eventuale tint).
"""
import json, os, sys
from PIL import Image, ImageDraw

ITEMS = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(os.path.join(OUT, "items"), exist_ok=True)
os.makedirs(os.path.join(OUT, "silhouettes"), exist_ok=True)

S = 32
GROUND = 27          # ultima riga della suola


def hex2rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def darker(c, k=0.72):
    return tuple(int(v * k) for v in c)


def lighter(c, k=0.25):
    return tuple(int(v + (255 - v) * k) for v in c)


# parametri: sole = spessore suola, collar = y del collo alla caviglia, toe = altezza punta,
# front = x dove il collo scende verso la punta, open_back = sabot/ciabatta
SIL = {
    "court_low":       dict(sole=3, collar=15, toe=21, front=14),
    "court_mid":       dict(sole=3, collar=11, toe=21, front=13, wing=True),
    "court_high":      dict(sole=3, collar=7,  toe=21, front=12),
    "terrace":         dict(sole=2, collar=17, toe=22, front=14, slim=True),
    "runner_retro":    dict(sole=4, collar=15, toe=21, front=14, panels=True),
    "runner_max":      dict(sole=7, collar=13, toe=18, front=14, panels=True),
    "slim_runner":     dict(sole=2, collar=18, toe=23, front=15, slim=True),
    "slim_motorsport": dict(sole=2, collar=18, toe=23, front=16, slim=True, round_toe=True),
    "chunky":          dict(sole=6, collar=13, toe=19, front=14, panels=True, wavy=True),
    "trail":           dict(sole=5, collar=13, toe=19, front=14, lugs=True, laces_zig=True),
    "skate":           dict(sole=3, collar=14, toe=21, front=14, side_band=True, puffy=True),
    "canvas_high":     dict(sole=3, collar=7,  toe=22, front=12, toe_cap=True),
    "slide":           dict(sole=4, collar=None, toe=22, front=None, slide=True),
    "slipper":         dict(sole=3, collar=17, toe=21, front=13, fur=True),
    "clog":            dict(sole=4, collar=None, toe=19, front=None, clog=True),
    "upthere_one":     dict(sole=4, collar=14, toe=20, front=13, upthere=True),
}


def outline(img):
    px = img.load()
    out = img.copy(); po = out.load()
    for y in range(S):
        for x in range(S):
            if px[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < S and 0 <= ny < S and px[nx, ny][3]:
                        po[x, y] = (20, 18, 24, 255); break
    return out


def draw_shoe(sil, pal):
    p = SIL[sil]
    upper, accent, sole = (hex2rgb(pal[k]) for k in ("upper", "accent", "sole"))
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    st = GROUND - p["sole"] + 1          # prima riga della suola
    heel, tip = 3, 29

    # --- tomaia ---
    if p.get("slide"):
        d.rectangle([12, st - 6, 24, st - 1], fill=upper)                 # fascia
        d.rectangle([12, st - 6, 24, st - 5], fill=lighter(upper))
        d.rectangle([14, st - 3, 22, st - 2], fill=accent)                # dettaglio
    elif p.get("clog"):
        d.polygon([(11, st - 1), (13, st - 8), (22, st - 9), (27, p["toe"]), (tip, st - 1)], fill=upper)
        d.line([(13, st - 8), (22, st - 9)], fill=lighter(upper))
        d.rectangle([16, st - 6, 17, st - 5], fill=accent)                # fibbia
    else:
        c = p["collar"]; f = p["front"]; t = p["toe"]
        pts = [(heel, st - 1), (heel, c + 1), (heel + 1, c), (f - 3, c), (f, c + 2),
               (f + 6, t - 2), (tip - 2, t), (tip, t + 2), (tip, st - 1)]
        if p.get("round_toe"):
            pts = pts[:-2] + [(tip - 1, t), (tip, t + 1), (tip, st - 1)]
        if p.get("puffy"):
            pts[2] = (heel + 1, c - 1); pts[3] = (f - 3, c - 1)
        d.polygon(pts, fill=upper)
        d.line([(heel + 1, c), (f - 3, c)], fill=lighter(upper))         # luce sul collo
        # accenti generici
        d.rectangle([heel, c + 1, heel + 2, st - 1], fill=accent)        # contrafforte tallone
        if p.get("wing"):
            d.polygon([(heel + 3, c + 3), (f - 1, c + 3), (f - 4, c + 7), (heel + 3, c + 7)], fill=accent)
        if p.get("panels"):
            d.polygon([(f - 2, st - 2), (f + 3, t + 1), (f + 6, t + 1), (f + 2, st - 2)], fill=accent)
            d.line([(heel + 3, st - 3), (tip - 3, st - 3)], fill=lighter(accent))
        if p.get("side_band"):
            d.line([(heel + 4, st - 2), (f + 2, c + 5), (f + 7, st - 3)], fill=accent)
        if p.get("toe_cap"):
            d.polygon([(tip - 6, st - 1), (tip - 5, t + 1), (tip, t + 2), (tip, st - 1)], fill=lighter(sole, 0.1))
        if p.get("fur"):
            d.rectangle([heel, c - 1, f - 2, c + 1], fill=accent)
        if p.get("slim"):
            d.line([(f - 4, c + 3), (tip - 6, st - 2)], fill=accent)
        if p.get("upthere"):
            # monogramma "U" originale Upthere sul fianco
            d.line([(f - 4, c + 3), (f - 4, c + 7)], fill=accent)
            d.line([(f, c + 3), (f, c + 7)], fill=accent)
            d.line([(f - 4, c + 7), (f, c + 7)], fill=accent)
        # lacci
        if p.get("laces_zig"):
            for i in range(3):
                d.point((f + 1 + i * 2, c + 3 + i * 2), fill=accent)
        else:
            for i in range(3):
                d.point((f + 1 + i * 2, c + 3 + i * 2), fill=lighter(upper, 0.6) if sum(upper) < 300 else darker(upper))

    # --- suola ---
    d.rectangle([heel - (0 if p.get("slide") or p.get("clog") else 0), st, tip, GROUND], fill=sole)
    if p.get("slide") or p.get("clog"):
        d.rectangle([9, st, tip, GROUND], fill=sole)
        d.rectangle([3, st, 8, GROUND], fill=(0, 0, 0, 0))
    d.line([(3 if not (p.get("slide") or p.get("clog")) else 9, st), (tip, st)], fill=lighter(sole))
    if p.get("wavy"):
        for x in range(heel, tip + 1, 3):
            d.point((x, st), fill=darker(sole))
    if p.get("lugs"):
        for x in range(heel, tip + 1, 2):
            d.point((x, GROUND), fill=darker(sole, 0.5))
    return outline(img)


items = json.load(open(ITEMS, encoding="utf-8"))["items"]
atlas_cols = 8
rows = (len(items) + atlas_cols - 1) // atlas_cols
atlas = Image.new("RGBA", (atlas_cols * S, rows * S), (0, 0, 0, 0))
frames = {}
for i, it in enumerate(items):
    icon = draw_shoe(it["silhouette"], it["palette"])
    icon.save(os.path.join(OUT, "items", f"{it['id']}.png"), optimize=True)
    x, y = (i % atlas_cols) * S, (i // atlas_cols) * S
    atlas.alpha_composite(icon, (x, y))
    frames[it["id"]] = {"frame": {"x": x, "y": y, "w": S, "h": S}, "rotated": False, "trimmed": False,
                        "spriteSourceSize": {"x": 0, "y": 0, "w": S, "h": S}, "sourceSize": {"w": S, "h": S}}
atlas.save(os.path.join(OUT, "items_atlas.png"), optimize=True)
json.dump({"frames": frames, "meta": {"image": "items_atlas.png", "size": {"w": atlas.width, "h": atlas.height},
                                      "scale": "1", "note": "PLACEHOLDER generati: sostituire con pixel art definitiva"}},
          open(os.path.join(OUT, "items_atlas.json"), "w"), indent=1)

gray = {"upper": "#e6e6e6", "accent": "#9a9a9a", "sole": "#ffffff"}
for sil in SIL:
    draw_shoe(sil, gray).save(os.path.join(OUT, "silhouettes", f"{sil}.png"), optimize=True)

# anteprima 4x con nomi
from PIL import ImageDraw as D2
prev = Image.new("RGBA", (atlas_cols * 140, rows * 170), (58, 64, 74, 255)); dp = D2.Draw(prev)
for i, it in enumerate(items):
    x, y = (i % atlas_cols) * 140, (i // atlas_cols) * 170
    prev.alpha_composite(Image.open(os.path.join(OUT, "items", f"{it['id']}.png")).resize((128, 128), Image.NEAREST), (x + 6, y))
    dp.text((x + 6, y + 130), it["display_name"][:20], fill="white")
    dp.text((x + 6, y + 145), f"{it['tier']} · {it['base_value']}", fill=(200, 200, 200))
prev.save(os.path.join(OUT, "PREVIEW_items.png"))
print("icone:", len(items), "silhouette:", len(SIL))
