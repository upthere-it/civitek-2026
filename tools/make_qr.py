"""QR definitivo verso il gioco (PLAN M6): deploy/qr/civitek-qr.svg (stampa) e .png (slide, 1200 px circa).

Uso: pip install segno && python3 tools/make_qr.py
L'URL viene da data/game_config.json (links.game), il colore scuro dal brand (primary), su fondo bianco:
contrasto alto per le fotocamere. Correzione d'errore H: regge anche stampato piccolo o un po' rovinato.
"""
import json
import os

import segno

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(ROOT, "data", "game_config.json"), encoding="utf-8"))
url = cfg["links"]["game"]
dark = cfg["brand"]["colors"]["primary"]

qr = segno.make(url, error="h", boost_error=False)
out = os.path.join(ROOT, "deploy", "qr")
os.makedirs(out, exist_ok=True)
qr.save(os.path.join(out, "civitek-qr.svg"), scale=10, border=4, dark=dark, light="#ffffff", title=url)
qr.save(os.path.join(out, "civitek-qr.png"), scale=36, border=4, dark=dark, light="#ffffff")
print(f"{url}: versione {qr.version}, correzione {qr.error}, {qr.symbol_size(scale=36, border=4)[0]} px")
