"""
Insegne pixel per gli edifici del villaggio, in palette Upthere.
Testo con un font bitmap 5x7 disegnato a mano (leggibile a qualsiasi scala intera),
logo Upthere vettoriale rasterizzato e binarizzato.
"""
import sys, os, io
from PIL import Image, ImageDraw
LOGO_SVG, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
h = lambda s: tuple(int(s.lstrip('#')[i:i+2], 16) for i in (0, 2, 4)) + (255,)
BG, BORDER, HI, TXT, INK = h("#3A012D"), h("#6F305B"), h("#B26998"), h("#E292C4"), h("#140010")

G = {
 "A": [" ### ","#   #","#   #","#####","#   #","#   #","#   #"],
 "B": ["#### ","#   #","#   #","#### ","#   #","#   #","#### "],
 "C": [" ####","#    ","#    ","#    ","#    ","#    "," ####"],
 "D": ["#### ","#   #","#   #","#   #","#   #","#   #","#### "],
 "E": ["#####","#    ","#    ","#### ","#    ","#    ","#####"],
 "F": ["#####","#    ","#    ","#### ","#    ","#    ","#    "],
 "G": [" ####","#    ","#    ","#  ##","#   #","#   #"," ### "],
 "H": ["#   #","#   #","#   #","#####","#   #","#   #","#   #"],
 "I": ["###"," # "," # "," # "," # "," # ","###"],
 "L": ["#    ","#    ","#    ","#    ","#    ","#    ","#####"],
 "M": ["#   #","## ##","# # #","# # #","#   #","#   #","#   #"],
 "N": ["#   #","##  #","# # #","#  ##","#   #","#   #","#   #"],
 "O": [" ### ","#   #","#   #","#   #","#   #","#   #"," ### "],
 "P": ["#### ","#   #","#   #","#### ","#    ","#    ","#    "],
 "R": ["#### ","#   #","#   #","#### ","# #  ","#  # ","#   #"],
 "S": [" ####","#    ","#    "," ### ","    #","    #","#### "],
 "T": ["#####","  #  ","  #  ","  #  ","  #  ","  #  ","  #  "],
 "U": ["#   #","#   #","#   #","#   #","#   #","#   #"," ### "],
 "V": ["#   #","#   #","#   #","#   #","#   #"," # # ","  #  "],
 "Z": ["#####","    #","   # ","  #  "," #   ","#    ","#####"],
 " ": ["  ","  ","  ","  ","  ","  ","  "],
}

def text_mask(text):
    w = sum(len(G[c][0]) + 1 for c in text) - 1
    m = Image.new("L", (w, 7), 0); x = 0
    for c in text:
        for y, row in enumerate(G[c]):
            for dx, ch in enumerate(row):
                if ch == "#": m.putpixel((x + dx, y), 255)
        x += len(G[c][0]) + 1
    return m

def logo_mask(height):
    import cairosvg
    png = cairosvg.svg2png(url=LOGO_SVG, output_height=height * 4)
    a = Image.open(io.BytesIO(png)).convert("RGBA").split()[3]
    a = a.crop(a.getbbox())
    return a.resize((max(1, a.width // 4), max(1, a.height // 4)), Image.LANCZOS).point(lambda v: 255 if v > 100 else 0)

def board(lines, pad=4):
    w = max(m.width for m, _ in lines) + pad * 2 + 4
    hgt = sum(m.height for m, _ in lines) + (len(lines) - 1) * 3 + pad * 2 + 4
    w += (16 - w % 16) % 16
    img = Image.new("RGBA", (w, hgt), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, hgt - 1], fill=INK)
    d.rectangle([1, 1, w - 2, hgt - 2], fill=BORDER)
    d.rectangle([2, 2, w - 3, hgt - 3], fill=BG)
    d.line([(2, 2), (w - 3, 2)], fill=HI)
    y = pad + 2
    for m, color in lines:
        x = (w - m.width) // 2
        img.paste(Image.new("RGBA", m.size, INK), (x + 1, y + 1), m)     # ombra
        img.paste(Image.new("RGBA", m.size, color), (x, y), m)
        y += m.height + 3
    return img

WHITE = (255, 255, 255, 255)
signs = {
    "sign_banca": [(logo_mask(20), WHITE), (text_mask("BANCA"), TXT)],
    "sign_negozio": [(text_mask("NEGOZIO"), TXT)],
    "sign_enoteca": [(text_mask("ENOTECA"), TXT), (text_mask("DOP DIGITAL"), WHITE)],
    "sign_bacheca": [(text_mask("BACHECA"), TXT), (text_mask("MERCATO"), WHITE)],
    "sign_autenticatore": [(text_mask("VERIFICA"), TXT), (text_mask("PASSAPORTI"), WHITE)],
    "sign_palco": [(text_mask("MC SUOLA"), TXT)],
}
for name, lines in signs.items():
    board(lines).save(os.path.join(OUT, f"{name}.png"), optimize=True)
for hgt in (24, 32):
    m = logo_mask(hgt); out = Image.new("RGBA", m.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", m.size, WHITE), (0, 0), m)
    out.save(os.path.join(OUT, f"logo_pixel_{hgt}.png"), optimize=True)
print("ok", len(os.listdir(OUT)), "file")
