"""
Genera i layer dell'avatar a partire da Body_A (Pixel Crawler Free Pack, Anokolisa).

Output (frame 64x64, stesso layout degli sheet originali):
  body/skin_{0..4}_{anim}_{dir}.png   corpo "ragazzo" con pelle ricolorata (palette swap, occhi intatti)
  body/skinf_{0..4}_{anim}_{dir}.png  corpo "ragazza": lo stesso, con ciglia e guance (avatar.body_types)
  layers/{layer}_{anim}_{dir}.png      overlay in scala di grigi da tingere a runtime (Phaser setTint)
     layer = hoodie | pants | skirt | shoes | hair_{corti,lunghi,cappellino,coda,codini,caschetto}
  Il corpo "ragazza" usa la gonna (skirt, tinta come la felpa) al posto dei pantaloni; le acconciature
  disponibili per ciascuno stile sono in avatar.hair_by_body.

Sono PLACEHOLDER generati con euristiche sulle righe del corpo: vanno ritoccati in Aseprite.
"""
import json, os, sys
from PIL import Image

SRC = sys.argv[1]   # cartella Body_A/Animations
OUT = sys.argv[2]   # cartella di destinazione avatar/
CFG = sys.argv[3]   # game_config.json

cfg = json.load(open(CFG, encoding="utf-8"))
SKIN_TONES = cfg["avatar"]["skin_tones"]

ANIMS = {"idle": ("Idle_Base", "Idle"), "walk": ("Walk_Base", "Walk")}
DIRS = ["down", "side", "up"]
FRAME = 64

BLACK = (0, 0, 0)
SKIN_LIGHT = (217, 160, 102)
SKIN_SHADE = (162, 101, 67)
SKIN_HI = (250, 200, 149)
SKIN_DARK = (118, 61, 43)
SKIN_SET = {SKIN_LIGHT, SKIN_SHADE, SKIN_HI, SKIN_DARK}

os.makedirs(os.path.join(OUT, "body"), exist_ok=True)
os.makedirs(os.path.join(OUT, "layers"), exist_ok=True)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def scale(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def lighten(c, k):
    return tuple(int(v + (255 - v) * k) for v in c)


def gray(level):
    v = int(255 * level)
    return (v, v, v, 255)


def shade_level(rgb):
    """Livello di grigio per gli overlay tingibili: conserva l'ombreggiatura del corpo."""
    if rgb == SKIN_HI:
        return 1.0
    if rgb == SKIN_LIGHT:
        return 0.93
    if rgb == SKIN_SHADE:
        return 0.70
    if rgb == SKIN_DARK:
        return 0.55
    return 0.85


def frame_bbox(px):
    xs, ys = [], []
    for y in range(FRAME):
        for x in range(FRAME):
            if px[x, y][3] > 0:
                xs.append(x)
                ys.append(y)
    return min(xs), max(xs), min(ys), max(ys)


def head_bounds(px, y0):
    """Colonne min/max del contorno testa (righe y0..y0+13)."""
    xs = [x for y in range(y0, y0 + 14) for x in range(FRAME) if px[x, y][3] > 0]
    return min(xs), max(xs)


def put(img, x, y, c):
    if 0 <= x < FRAME and 0 <= y < FRAME:
        img.putpixel((x, y), c)


def body_layer(px, ox, region):
    """Overlay che segue la silhouette del corpo nelle righe region(y)->bool."""
    out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    for y in range(FRAME):
        for x in range(FRAME):
            p = px[x, y]
            if p[3] == 0 or not region(x, y):
                continue
            rgb = p[:3]
            if rgb == BLACK:
                out.putpixel((x, y), (0, 0, 0, 255))
            elif rgb in SKIN_SET:
                out.putpixel((x, y), gray(shade_level(rgb)))
    return out


def shoes_layer(px, y0, y1):
    """Ultimi 2 pixel opachi di ogni colonna nella zona gambe."""
    out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    for x in range(FRAME):
        col = [y for y in range(y0 + 23, y1 + 1) if px[x, y][3] > 0]
        if not col:
            continue
        for y in col[-2:]:
            rgb = px[x, y][:3]
            out.putpixel((x, y), (0, 0, 0, 255) if rgb == BLACK else gray(0.95))
    return out


def hair_layer(px, d, style):
    _, _, y0, _ = frame_bbox(px)
    hx0, hx1 = head_bounds(px, y0)
    out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    H = gray(0.92)
    HS = gray(0.70)
    O = (0, 0, 0, 255)

    def cover(cond):
        for y in range(y0, y0 + 14):
            for x in range(hx0, hx1 + 1):
                p = px[x, y]
                if p[3] == 0 or not cond(x, y):
                    continue
                out.putpixel((x, y), O if p[:3] == BLACK else (HS if (x - hx0) in (1, hx1 - hx0 - 1) else H))

    cx = (hx0 + hx1) / 2

    if style == "cappellino":
        # calotta: righe y0..y0+5
        cover(lambda x, y: y <= y0 + 5)
        # visiera
        if d == "down":
            for x in range(hx0 - 1, hx1 + 2):
                put(out, x, y0 + 6, HS)
            put(out, hx0 - 2, y0 + 6, O); put(out, hx1 + 2, y0 + 6, O)
            for x in range(hx0 - 1, hx1 + 2):
                put(out, x, y0 + 7, O)
        elif d == "side":
            for x in range(int(cx), hx1 + 4):
                put(out, x, y0 + 6, HS)
            for x in range(int(cx), hx1 + 5):
                put(out, x, y0 + 7, O)
            put(out, hx1 + 4, y0 + 6, O)
        else:  # up: capelli sotto il cappellino
            cover(lambda x, y: y <= y0 + 12)
            for x in range(hx0 + 1, hx1):
                if out.getpixel((x, y0 + 6))[3]:
                    put(out, x, y0 + 6, O)
        return out

    if style == "codini":
        # due codini ai lati della testa (down/up), uno visibile dietro (side)
        out = hair_layer(px, d, "corti")
        def tail(xa, step):
            for y in range(y0 + 4, y0 + 13):
                for k in range(0, 3):
                    put(out, xa + step * k, y, H if k < 2 else O)
            for k in range(-1, 3):
                put(out, xa + step * k, y0 + 13, O)
            put(out, xa, y0 + 3, O); put(out, xa + step, y0 + 3, O)
        if d in ("down", "up"):
            tail(hx0 - 1, -1)
            tail(hx1 + 1, 1)
        else:
            tail(hx0 - 1, -1)
        return out

    if style == "caschetto":
        # caschetto con frangetta: copre i lati fino al mento, frangia dritta sulla fronte
        if d == "down":
            cover(lambda x, y: y <= y0 + 6 or (x - hx0 <= 2 or hx1 - x <= 2))
            for y in range(y0 + 7, y0 + 13):
                put(out, hx0 - 1, y, O); put(out, hx1 + 1, y, O)
            for x in range(hx0 - 1, hx0 + 3):
                put(out, x, y0 + 13, O)
            for x in range(hx1 - 2, hx1 + 2):
                put(out, x, y0 + 13, O)
            for x in range(hx0 + 3, hx1 - 2):
                put(out, x, y0 + 7, O)
        elif d == "up":
            cover(lambda x, y: y <= y0 + 13)
            for x in range(hx0, hx1 + 1):
                put(out, x, y0 + 13, O)
        else:
            cover(lambda x, y: y <= y0 + 6 or x <= cx + 1)
            for y in range(y0 + 7, y0 + 13):
                put(out, hx0 - 1, y, O)
            for x in range(hx0 - 1, int(cx) + 3):
                put(out, x, y0 + 13, O)
        return out

    if style == "coda":
        # base come i corti, più la coda: dietro la testa (side), giù lungo la schiena (up), un ciuffo di lato (down)
        out = hair_layer(px, d, "corti")
        if d == "down":
            for y in range(y0 + 2, y0 + 12):
                put(out, hx1 + 1, y, H); put(out, hx1 + 2, y, H if y < y0 + 10 else O); put(out, hx1 + 3, y, O)
            put(out, hx1 + 1, y0 + 1, O); put(out, hx1 + 2, y0 + 1, O); put(out, hx1 + 2, y0 + 12, O)
        elif d == "side":
            for y in range(y0 + 3, y0 + 14):
                w = 3 if y < y0 + 11 else 2
                for k in range(1, w + 1):
                    put(out, hx0 - k, y, H if k < w else HS)
                put(out, hx0 - w - 1, y, O)
            for k in range(0, 4):
                put(out, hx0 - k, y0 + 14, O)
            put(out, hx0 - 1, y0 + 2, O); put(out, hx0 - 2, y0 + 2, O)
        else:  # up
            mid = int(cx)
            for y in range(y0 + 12, y0 + 20):
                for x in (mid - 1, mid, mid + 1):
                    put(out, x, y, H if x == mid else HS)
                put(out, mid - 2, y, O); put(out, mid + 2, y, O)
            for x in range(mid - 1, mid + 2):
                put(out, x, y0 + 20, O)
            for x in range(mid - 2, mid + 3):
                put(out, x, y0 + 12, gray(0.40))  # elastico
        return out

    # stili di capelli
    if d == "down":
        cover(lambda x, y: y <= y0 + 6 or (y <= y0 + 9 and (x - hx0 <= 2 or hx1 - x <= 2)))
    elif d == "up":
        cover(lambda x, y: y <= y0 + 12)
    else:  # side: il viso guarda a destra
        cover(lambda x, y: y <= y0 + 6 or (y <= y0 + 11 and x <= cx))

    if style == "lunghi":
        if d == "down":
            for y in range(y0 + 7, y0 + 18):
                for x in (hx0, hx0 + 1, hx1 - 1, hx1):
                    put(out, x, y, H)
                put(out, hx0 - 1, y, O); put(out, hx1 + 1, y, O)
            for y in range(y0 + 11, y0 + 18):
                put(out, hx0 + 2, y, O); put(out, hx1 - 2, y, O)
            for x in list(range(hx0 - 1, hx0 + 3)) + list(range(hx1 - 2, hx1 + 2)):
                put(out, x, y0 + 18, O)
        elif d == "up":
            for y in range(y0 + 13, y0 + 18):
                for x in range(hx0, hx1 + 1):
                    put(out, x, y, H if (x - hx0) % 3 else HS)
                put(out, hx0 - 1, y, O); put(out, hx1 + 1, y, O)
            for x in range(hx0 - 1, hx1 + 2):
                put(out, x, y0 + 18, O)
        else:
            back = int(cx)
            for y in range(y0 + 8, y0 + 18):
                for x in range(hx0, back):
                    put(out, x, y, H if (x - hx0) % 3 else HS)
                put(out, hx0 - 1, y, O); put(out, back, y, O)
            for x in range(hx0 - 1, back + 1):
                put(out, x, y0 + 18, O)
    return out


# segnaposto delle guance nel corpo "ragazza": skin_swap lo trasforma in un rosa sul tono di pelle
BLUSH_MARK = (255, 0, 255)
BLUSH = (224, 96, 128)
# segnaposto della bocca, come le guance
MOUTH_MARK = (0, 255, 255)
MOUTH = (196, 52, 92)


def mix(a, b, k):
    return tuple(int(x + (y - x) * k) for x, y in zip(a, b))


def girl_face(fr, d):
    """Ciglia marcate (due pixel che allungano la riga sopra l'occhio verso l'esterno), bocca e guance."""
    out = fr.copy()
    px = out.load()
    if d == "up":
        return out
    _, _, y0, _ = frame_bbox(px)
    hx0, hx1 = head_bounds(px, y0)
    cx = (hx0 + hx1) // 2
    if d == "down":
        marks = [((hx0 + 1, y0 + 8), BLACK), ((hx0 + 1, y0 + 7), BLACK),
                 ((hx1 - 1, y0 + 8), BLACK), ((hx1 - 1, y0 + 7), BLACK),
                 ((hx0 + 2, y0 + 10), BLUSH_MARK), ((hx1 - 2, y0 + 10), BLUSH_MARK),
                 ((cx, y0 + 11), MOUTH_MARK), ((cx + 1, y0 + 11), MOUTH_MARK)]
    else:  # side: guarda a destra
        marks = [((hx1 - 1, y0 + 8), BLACK), ((hx1 - 1, y0 + 7), BLACK),
                 ((hx1 - 3, y0 + 10), BLUSH_MARK), ((hx1 - 1, y0 + 11), MOUTH_MARK)]
    for (x, y), c in marks:
        if 0 <= x < FRAME and 0 <= y < FRAME and px[x, y][3] and px[x, y][:3] in SKIN_SET:
            px[x, y] = c + (255,)
    return out


def skirt_layer(px, y0, y1):
    """Gonna corta e svasata (tinta come la felpa: insieme fanno un vestito), gambe scoperte sotto."""
    out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    legs = [x for x in range(FRAME) if px[x, y0 + 24][3] > 0]
    if not legs:
        return out
    x0, x1 = min(legs), max(legs)
    top = y0 + 22
    for k, y in enumerate(range(top, top + 4)):
        flare = (0, 1, 2, 3)[k]
        for x in range(x0 - flare, x1 + flare + 1):
            edge = x in (x0 - flare, x1 + flare)
            put(out, x, y, (0, 0, 0, 255) if edge else gray(0.92 if (x - x0 + k) % 4 else 0.74))
    for x in range(x0 - 3, x1 + 4):
        put(out, x, top + 4, (0, 0, 0, 255))
    return out


def skin_swap(sheet, tone_hex):
    base = hex2rgb(tone_hex)
    mapping = {
        SKIN_LIGHT: base,
        SKIN_SHADE: scale(base, 0.75),
        SKIN_HI: lighten(base, 0.30),
        SKIN_DARK: scale(base, 0.55),
        BLUSH_MARK: mix(base, BLUSH, 0.45),
        MOUTH_MARK: mix(base, MOUTH, 0.75),
    }
    out = sheet.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            p = px[x, y]
            if p[3] and p[:3] in mapping:
                px[x, y] = mapping[p[:3]] + (p[3],)
    return out


manifest = {"frame": {"width": FRAME, "height": FRAME}, "animations": {}, "body": [], "layers": {}}
LAYERS = ["pants", "skirt", "shoes", "hoodie", "hair_corti", "hair_lunghi", "hair_cappellino", "hair_coda",
          "hair_codini", "hair_caschetto"]

for anim, (folder, prefix) in ANIMS.items():
    for d in DIRS:
        src = os.path.join(SRC, folder, f"{prefix}_{d.capitalize()}-Sheet.png")
        sheet = Image.open(src).convert("RGBA")
        n = sheet.width // FRAME
        key = f"{anim}_{d}"
        manifest["animations"][key] = {"frames": n, "frameRate": 6 if anim == "idle" else 10,
                                       "flipForOtherSide": d == "side"}
        layers = {l: Image.new("RGBA", sheet.size, (0, 0, 0, 0)) for l in LAYERS}
        for i in range(n):
            fr = sheet.crop((i * FRAME, 0, (i + 1) * FRAME, FRAME))
            px = fr.load()
            _, _, y0, y1 = frame_bbox(px)
            bx0, bx1, _, _ = frame_bbox(px)
            parts = {
                # felpa: torso e braccia, mani escluse (colonne esterne dalla riga y0+19)
                "hoodie": body_layer(px, 0, lambda x, y: y0 + 14 <= y <= y0 + 21
                                     and not (y >= y0 + 19 and (x <= bx0 + 3 or x >= bx1 - 3))),
                "pants": body_layer(px, 0, lambda x, y: y0 + 22 <= y <= y1),
                "skirt": skirt_layer(px, y0, y1),
                "shoes": shoes_layer(px, y0, y1),
                "hair_corti": hair_layer(px, d, "corti"),
                "hair_lunghi": hair_layer(px, d, "lunghi"),
                "hair_cappellino": hair_layer(px, d, "cappellino"),
                "hair_coda": hair_layer(px, d, "coda"),
                "hair_codini": hair_layer(px, d, "codini"),
                "hair_caschetto": hair_layer(px, d, "caschetto"),
            }
            for l, img in parts.items():
                layers[l].alpha_composite(img, (i * FRAME, 0))
        for l, img in layers.items():
            p = os.path.join(OUT, "layers", f"{l}_{key}.png")
            img.save(p, optimize=True)
            manifest["layers"].setdefault(l, []).append(f"layers/{l}_{key}.png")
        girl = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
        for i in range(n):
            girl.alpha_composite(girl_face(sheet.crop((i * FRAME, 0, (i + 1) * FRAME, FRAME)), d), (i * FRAME, 0))
        for t, tone in enumerate(SKIN_TONES):
            skin_swap(sheet, tone).save(os.path.join(OUT, "body", f"skin_{t}_{key}.png"), optimize=True)
            skin_swap(girl, tone).save(os.path.join(OUT, "body", f"skinf_{t}_{key}.png"), optimize=True)
        manifest["body"].append(f"body/skin_{{tone}}_{key}.png")
        manifest["body"].append(f"body/skinf_{{tone}}_{key}.png")

manifest["draw_order"] = ["body", "pants|skirt", "shoes", "hoodie", "hair"]
manifest["body_types"] = {"ragazzo": {"body": "skin", "lower": "pants"}, "ragazza": {"body": "skinf", "lower": "skirt"}}
manifest["tint"] = {
    "pants": "fisso #2d3a5a (jeans)",
    "skirt": "come la felpa (avatar.outfit_colors[outfit]): insieme fanno un vestito",
    "shoes": "palette.upper della scarpa più preziosa posseduta (default #f4f4f4)",
    "hoodie": "avatar.outfit_colors[outfit]",
    "hair": "avatar.hair_colors[hair_color]",
}
manifest["note"] = "Layer PLACEHOLDER generati automaticamente da Body_A: vanno ritoccati in Aseprite."
json.dump(manifest, open(os.path.join(OUT, "avatar_manifest.json"), "w"), indent=2, ensure_ascii=False)
print("ok", len(os.listdir(os.path.join(OUT, "layers"))), "layer,", len(os.listdir(os.path.join(OUT, "body"))), "body")
