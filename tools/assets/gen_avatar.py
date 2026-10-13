"""
Genera i layer dell'avatar a partire da Body_A (Pixel Crawler Free Pack, Anokolisa).

Output (frame 64x64, stesso layout degli sheet originali):
  body/skin_{0..4}_{anim}_{dir}.png   corpo con pelle ricolorata (palette swap, occhi intatti)
  layers/{layer}_{anim}_{dir}.png      overlay in scala di grigi da tingere a runtime (Phaser setTint)
     layer = hoodie | pants | shoes | hair_corti | hair_lunghi | hair_cappellino

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


def skin_swap(sheet, tone_hex):
    base = hex2rgb(tone_hex)
    mapping = {
        SKIN_LIGHT: base,
        SKIN_SHADE: scale(base, 0.75),
        SKIN_HI: lighten(base, 0.30),
        SKIN_DARK: scale(base, 0.55),
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
LAYERS = ["pants", "shoes", "hoodie", "hair_corti", "hair_lunghi", "hair_cappellino"]

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
                "shoes": shoes_layer(px, y0, y1),
                "hair_corti": hair_layer(px, d, "corti"),
                "hair_lunghi": hair_layer(px, d, "lunghi"),
                "hair_cappellino": hair_layer(px, d, "cappellino"),
            }
            for l, img in parts.items():
                layers[l].alpha_composite(img, (i * FRAME, 0))
        for l, img in layers.items():
            p = os.path.join(OUT, "layers", f"{l}_{key}.png")
            img.save(p, optimize=True)
            manifest["layers"].setdefault(l, []).append(f"layers/{l}_{key}.png")
        for t, tone in enumerate(SKIN_TONES):
            p = os.path.join(OUT, "body", f"skin_{t}_{key}.png")
            skin_swap(sheet, tone).save(p, optimize=True)
        manifest["body"].append(f"body/skin_{{tone}}_{key}.png")

manifest["draw_order"] = ["body", "pants", "shoes", "hoodie", "hair"]
manifest["tint"] = {
    "pants": "fisso #2d3a5a (jeans)",
    "shoes": "palette.upper della scarpa più preziosa posseduta (default #f4f4f4)",
    "hoodie": "avatar.outfit_colors[outfit]",
    "hair": "avatar.hair_colors[hair_color]",
}
manifest["note"] = "Layer PLACEHOLDER generati automaticamente da Body_A: vanno ritoccati in Aseprite."
json.dump(manifest, open(os.path.join(OUT, "avatar_manifest.json"), "w"), indent=2, ensure_ascii=False)
print("ok", len(os.listdir(os.path.join(OUT, "layers"))), "layer,", len(os.listdir(os.path.join(OUT, "body"))), "body")
