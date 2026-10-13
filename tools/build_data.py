import json, math, os

import pathlib
OUT = str(pathlib.Path(__file__).resolve().parent.parent / "data")
os.makedirs(OUT, exist_ok=True)

def rnd(x):
    return int(math.floor(x + 0.5))

# ---------------------------------------------------------------------------
# 1. Catalogo reale di riferimento (dalla ricerca del 13/10/2026)
# (id, brand, modello, categoria, anno, sku, retail_eur, retail_usd, resell_min_eur, resell_max_eur, rarita, fonte)
# ---------------------------------------------------------------------------
REF = [
    ("nike-air-force-1-07", "Nike", "Air Force 1 '07", "basket-retro / lifestyle", 1982, "FJ4146-303", 119.99, None, None, None, "common", "https://www.nike.com/it/t/scarpa-nike-air-force-1-07-uomo-n8juM1H2"),
    ("nike-dunk-low-retro", "Nike", "Dunk Low Retro 'Panda'", "basket-retro / lifestyle", 1985, "DD1391-100", 119.99, None, None, None, "common", "https://www.nike.com/it/t/scarpa-dunk-low-retro-zhqKMf"),
    ("nike-air-max-plus", "Nike", "Air Max Plus", "running-style", 1998, "DM2362-100", 189.99, 190, None, None, "popular", "https://www.nike.com/it/w/air-max-plus-ahvdn"),
    ("nike-zoom-vomero-5", "Nike", "Zoom Vomero 5", "running-style", 2010, "HF1553-003", 159.99, 160, None, None, "popular", "https://www.nike.com/it/t/scarpa-zoom-vomero-5-lTxg3uLL"),
    ("nike-p-6000", "Nike", "P-6000", "running-style", 2006, None, 119.99, None, None, None, "popular", "https://www.nike.com/it/w/nike-p-6000-scarpe-4ff6czy7ok"),
    ("nike-shox-tl", "Nike", "Shox TL", "running-style / Y2K", 2003, None, 169.99, None, None, None, "popular", "https://www.nike.com/it/w/prezzo-pieno-shox-4an3xz7e8jq"),
    ("nike-mind-001-slide", "Nike", "Mind 001 Slide", "ciabatta / recovery", 2026, "HQ4307-001", 95, None, 169, 919, "hyped", "https://sneaker.de/en/releases/nike-mind-001-slide-black-hyper-crimson-white-chrome-hq4307-001/"),
    ("nike-air-max-moto-2k", "Nike", "Air Max Moto 2K", "running-style / Y2K", 2025, None, None, None, None, None, "popular", "https://blog.jdsports.it/sneakers-2026/"),
    ("nike-air-max-95", "Nike", "Air Max 95", "running-style", 1995, None, None, None, None, None, "popular", "https://www.sneakerfreaker.com/features/hottest-sneakers-and-topics-of-2026-explained"),
    ("air-jordan-1-retro-high-og", "Jordan", "Air Jordan 1 Retro High OG", "basket-retro", 1985, None, 179.99, None, None, None, "hyped", "https://www.nike.com/it/w/jordan-scarpe-37eefzy7ok"),
    ("air-jordan-1-high-og-royal-2026", "Jordan", "Air Jordan 1 High OG 'Royal' (2026)", "basket-retro", 2026, "IQ5495-005", None, 185, None, None, "hyped", "https://sneakerbardetroit.com/air-jordan-release-dates/"),
    ("air-jordan-1-retro-low", "Jordan", "Air Jordan 1 Retro Low", "basket-retro", 1985, None, 159.99, None, None, None, "popular", "https://www.nike.com/it/w/jordan-scarpe-37eefzy7ok"),
    ("air-jordan-4-retro-flight-club", "Jordan", "Air Jordan 4 Retro OG 'Flight Club'", "basket-retro", 2026, "IM4002-100", 209.99, None, 249, 249, "hyped", "https://www.resellzonecesena.com/products/air-jordan-4-retro-og-flight-club"),
    ("air-jordan-4-og-bred-2026", "Jordan", "Air Jordan 4 OG 'Bred' (2026)", "basket-retro", 2026, "IX8180-001", None, 230, None, None, "limited", "https://sneakerbardetroit.com/air-jordan-release-dates/"),
    ("jbalvin-air-jordan-4-amazonas", "Jordan", "J Balvin x Air Jordan 4 'Amazonas'", "basket-retro / collab", 2026, "IW2872-700", None, 225, None, None, "limited", "https://sneakerbardetroit.com/air-jordan-release-dates/"),
    ("air-jordan-5-wolf-grey", "Jordan", "Air Jordan 5 Retro 'Wolf Grey' (2026)", "basket-retro", 2026, None, None, None, None, None, "hyped", "https://www.morningstar.com/news/pr-newswire/20260617de85661/stockx-reveals-breakout-products-and-global-soccer-spending-trends-in-latest-big-facts-report"),
    ("air-jordan-11-space-jam-2026", "Jordan", "Air Jordan 11 Retro 'Space Jam' (2026)", "basket-retro", 2026, "CT8012-900", None, 235, None, None, "limited", "https://kicksfinder.com/most-popular"),
    ("adidas-samba-og", "adidas", "Samba OG", "terrace", 1950, "B75807", 120, 100, None, None, "common", "https://www.jdsports.it/collection/adidas-originals-samba/marca/adidas/"),
    ("adidas-samba-xlg", "adidas", "Samba XLG", "terrace / platform", 2024, "JI3195", 130, None, None, None, "popular", "https://www.adidas.it/scarpe-samba-xlg/JI3195.html"),
    ("adidas-gazelle-indoor", "adidas", "Gazelle Indoor", "terrace", 1979, None, 120, None, None, None, "popular", "https://www.jdsports.it/donna/collection/adidas-originals-gazelle/"),
    ("adidas-handball-spezial", "adidas", "Handball Spezial", "terrace", 1979, "IF7086", 110, None, None, None, "popular", "https://www.jdsports.it/collection/adidas-originals-handball-spezial/"),
    ("adidas-campus-00s", "adidas", "Campus 00s", "skate / lifestyle", 2023, None, 120, None, None, None, "common", "https://www.jdsports.it/marca/adidas/c/scarpe/"),
    ("adidas-sl-72-og", "adidas", "SL 72 OG", "running-style / low-profile", 1972, "IE3425", 99.9, None, None, None, "popular", "https://answear.it/p/adidas-originals-sneakers-sl-72-og-colore-granata-ie3425-1261066"),
    ("adidas-superstar", "adidas", "Superstar", "basket-retro / lifestyle", 1969, None, None, None, None, None, "common", "https://www.vittoriocitro.it/blogs/news/sneakers-autunno-inverno-2026-2027-tendenze"),
    ("adidas-taekwondo", "adidas", "Taekwondo", "sneakerina / slim", 2025, None, None, None, None, None, "hyped", "https://www.aol.com/articles/sneaker-trends-fashion-girls-already-204927734.html"),
    ("new-balance-9060", "New Balance", "9060", "chunky / running-style", 2022, "U9060BLK", 190, 150, None, None, "popular", "https://www.newbalance.it/it/pd/9060/U9060V1-50600-PMG-EMEA.html"),
    ("new-balance-530", "New Balance", "530", "running-style", 1992, "MR530SG", 120, None, None, None, "common", "https://www.newbalance.it/it/uomo/scarpe/"),
    ("new-balance-204l", "New Balance", "204L", "running-style / low-profile", 2025, "U204L5YB", 140, None, None, None, "popular", "https://www.newbalance.it/it/acquista-per-modello/204l/"),
    ("new-balance-1906r", "New Balance", "1906R", "running-style", 2022, None, 160, None, None, None, "popular", "https://www.jdsports.it/product/bianco-new-balance-1906r/19679672_jdsportsit/"),
    ("new-balance-740", "New Balance", "740", "running-style", 2025, None, 120, None, None, None, "common", "https://www.jdsports.it/product/bianco-new-balance-1906r/19679672_jdsportsit/"),
    ("asics-gel-1130", "ASICS", "Gel-1130", "running-style", 2021, "1201A256", 110, 110, None, None, "popular", "https://www.asics.com/it/it-it/gel-1130/c/as88000045/"),
    ("asics-gel-kayano-14", "ASICS", "Gel-Kayano 14", "running-style", 2008, None, 170, 165, None, None, "popular", "https://www.asics.com/it/it-it/gel-kayano-14/c/as63300001/"),
    ("asics-gel-nyc", "ASICS", "Gel-NYC", "running-style", 2022, None, 150, 130, None, None, "popular", "https://www.jdsports.it/uomo/scarpe-uomo/collection/asics-gel-nyc/"),
    ("onitsuka-tiger-mexico-66", "Onitsuka Tiger", "Mexico 66", "low-profile / heritage", 1966, "1183C102.751", 160, 160, 112, 217, "hyped", "https://www.onitsukatiger.com/it/it-it/mexico-66/p/1183c102-751.html"),
    ("puma-speedcat-og", "Puma", "Speedcat OG", "low-profile / motorsport", 1999, "398846-01", 110, 120, 43, 183, "hyped", "https://eu.puma.com/it/it/pd/sneakers-speedcat-og-unisex/398846"),
    ("salomon-xt-6", "Salomon", "XT-6", "gorpcore / trail", 2013, "L41252900", 180, None, None, None, "popular", "https://www.jdsports.it/collection/salomon-xt-6/"),
    ("salomon-xt-whisper", "Salomon", "XT-Whisper", "gorpcore / trail", 2024, None, 150, None, None, None, "popular", "https://www.jdsports.it/product/nero-salomon-xt-whisper-donna/19720385_jdsportsit/"),
    ("vans-knu-skool", "Vans", "Knu Skool", "skate / chunky", 2023, "VN0009QC6BT", 95, None, None, None, "popular", "https://www.vans.com/it-it/p/scarpe-knu-skool-VN0009QC6BT"),
    ("vans-old-skool", "Vans", "Old Skool", "skate", 1977, None, None, 75, None, None, "common", "https://www.footlocker.com/category/brands/vans.html"),
    ("vans-lx-old-skool-36", "Vans", "LX Old Skool 36 'Pearlized Pack'", "skate / premium", 2026, None, None, None, None, None, "hyped", "https://www.morningstar.com/news/pr-newswire/20260617de85661/stockx-reveals-breakout-products-and-global-soccer-spending-trends-in-latest-big-facts-report"),
    ("converse-chuck-70", "Converse", "Chuck 70 Vintage Canvas High", "lifestyle / canvas", 1970, None, 95, None, None, None, "common", "https://www.converse.com/it/shop/p/chuck-70-vintage-canvas-unisex/162056MP.html"),
    ("ugg-tasman", "UGG", "Tasman", "slipper / mule", 2009, None, 140, None, None, None, "popular", "https://www.jdsports.it/uomo/collection/ugg-tasman/"),
    ("ugg-classic-ultra-mini", "UGG", "Classic Ultra Mini", "stivaletto", 2020, "1116109", 169.95, None, None, None, "popular", "https://www.ugg.com/eu/it/it/classic-ultra-mini-in-pelle/1117534.html"),
    ("birkenstock-boston", "Birkenstock", "Boston Suede", "sabot / clog", 1976, None, 150, None, None, None, "popular", "https://www.birkenstock.com/it/boston-suede-leather/boston-core-suedeleather-0-evarubber-u_491.html"),
    ("hoka-clifton-10", "HOKA", "Clifton 10", "running", 2025, None, 160, None, None, None, "common", "https://www.jdsports.it/donna/scarpe-donna/collection/hoka-clifton/"),
    ("saucony-progrid-omni-9", "Saucony", "ProGrid Omni 9", "running-style", 2025, None, 160, None, None, None, "hyped", "https://www.jdsports.it/donna/scarpe-donna/collection/saucony-progrid-omni-9-og/"),
    ("on-cloud-lifestyle", "On", "Cloud (linea lifestyle)", "running-style", 2010, None, None, None, None, None, "popular", "https://finwire.io/news/stock-markets-news/piper-says-nike-continues-to-lose-teen-market-share-as-on-running-gains"),
    ("village-pm-1pm", "Village PM", "1PM", "skate", 2025, None, None, None, None, None, "limited", "https://wwd.com/footwear-news/shoe-industry-news/chanel-pumps-hottest-shoes-lyst-index-q1-2026-1238933576/"),
    ("skims-jelly-shoe", "Skims", "Jelly Shoe 'Clay'", "ballerina / jelly", 2025, None, None, 58, None, None, "hyped", "https://wwd.com/footwear-news/shoe-trends/lyst-index-q2-2026-hottest-shoes-1239094483/"),
    ("puma-speedcat-ballet", "Puma", "Speedcat Ballet", "sneakerina", 2025, None, None, None, None, None, "popular", "https://www.trovaprezzi.it/prezzo_scarpe-sportive_puma_speedcat.aspx"),
]

ref_records = []
for (i, b, m, c, y, sku, eur, usd, rmin, rmax, rar, src) in REF:
    ref_records.append({
        "id": i, "brand": b, "modello": m, "categoria": c, "anno_uscita": y, "sku": sku,
        "prezzo_retail_eur": eur, "prezzo_retail_usd": usd,
        "resell_min_eur": rmin, "resell_max_eur": rmax,
        "rarita_hype": rar, "fonte_principale": src,
    })

ref_by_id = {r["id"]: r for r in ref_records}
assert len(ref_by_id) == len(ref_records), "id duplicati nel catalogo di riferimento"

catalog_reference = {
    "meta": {
        "uso": "SOLO RIFERIMENTO INTERNO per tarare prezzi e rarità. Non mostrare mai nel gioco: nel gioco si usano marchi fittizi (game_items.json).",
        "data_rilevazione": "2026-10-13",
        "mercato": "Italia/Europa",
        "valuta": "EUR (USD solo dove l'EUR non era verificabile, mai convertito)",
        "numero_record": len(ref_records),
        "record_con_retail_eur": sum(1 for r in ref_records if r["prezzo_retail_eur"] is not None),
        "record_con_resell_eur": sum(1 for r in ref_records if r["resell_min_eur"] is not None),
        "note": [
            "Sintesi del report di ricerca del 13/10/2026: per fonti complete e note per modello vedi il report.",
            "I prezzi resell sono prezzi richiesti da reseller o range StockX, non transazioni concluse.",
            "rarita_hype è un giudizio editoriale basato sulle fonti.",
        ],
    },
    "scarpe": ref_records,
}

# ---------------------------------------------------------------------------
# 2. Config di gioco
# ---------------------------------------------------------------------------
RARITY_MULT = {"common": 1.0, "popular": 1.15, "hyped": 1.6, "limited": 2.5}
EUR_TO_COIN_DIVISOR = 4

# ---------------------------------------------------------------------------
# 3. Item in gioco (marchi fittizi)
# (id, brand, name, colorway, silhouette, (upper, accent, sole), tier, rarity, sources, fakeable, refs, stima, drop_weight, flavor)
# ---------------------------------------------------------------------------
ITEMS = [
    # BASE
    ("volta-court-82-bianca", "Volta", "Court 82", "Bianco totale", "court_low", ("#f4f4f4", "#e6e6e6", "#ffffff"), "base", "common", ["shop", "starter"], False, ["nike-air-force-1-07"], None, 0, "La scarpa che sta bene con tutto. Il punto di partenza."),
    ("volta-court-82-nera", "Volta", "Court 82", "Nero totale", "court_low", ("#1d1d1f", "#2b2b2e", "#1d1d1f"), "base", "common", ["shop", "starter"], False, ["nike-air-force-1-07"], None, 0, "Stessa scarpa, mood diverso."),
    ("volta-duo-low", "Volta", "Duo Low", "Bianco/Nero", "court_low", ("#f4f4f4", "#1d1d1f", "#ffffff"), "base", "common", ["shop", "starter"], False, ["nike-dunk-low-retro"], None, 0, "Ex regina dell'hype, oggi la vedi in ogni corridoio."),
    ("terra-calcio-og", "Terra", "Calcio OG", "Nero/Bianco/Gomma", "terrace", ("#1d1d1f", "#f4f4f4", "#b5835a"), "base", "common", ["shop", "starter"], False, ["adidas-samba-og"], None, 0, "Sottile, con la suola color gomma. Un classico."),
    ("nordline-53", "Nordline", "53", "Bianco/Argento", "runner_retro", ("#f4f4f4", "#c0c4cc", "#e8e8e8"), "base", "common", ["shop", "starter"], False, ["new-balance-530"], None, 0, "Runner anni 2000, comoda tutto il giorno."),
    ("telo-70-alta", "Telo", "70 Alta", "Nero", "canvas_high", ("#1d1d1f", "#f2ead8", "#f2ead8"), "base", "common", ["shop", "starter"], False, ["converse-chuck-70"], None, 0, "Tela e gomma, dal 1970."),
    ("rampa-classica", "Rampa", "Classica", "Nero/Bianco", "skate", ("#1d1d1f", "#f4f4f4", "#f4f4f4"), "base", "common", ["shop", "starter"], False, ["vans-old-skool"], 22, 0, "La skate shoe per eccellenza."),
    ("nuvola-10", "Nuvola", "10", "Bianco nuvola", "runner_max", ("#f4f4f4", "#9fd3f0", "#ffffff"), "base", "common", ["shop"], False, ["hoka-clifton-10"], None, 0, "Suola altissima, sembra di camminare su una nuvola."),
    # TREND
    ("kaze-113", "Kaze", "113", "Bianco/Argento", "runner_retro", ("#f4f4f4", "#b9bec7", "#dfe3e8"), "trend", "popular", ["shop"], False, ["asics-gel-1130"], None, 0, "La runner retrò del momento."),
    ("terra-sprint-72", "Terra", "Sprint 72", "Granata", "slim_runner", ("#7a1f2b", "#f4f4f4", "#e8dcc8"), "trend", "popular", ["shop"], False, ["adidas-sl-72-og"], None, 0, "Sottilissima, anni '70: quella che viene dopo la Calcio."),
    ("terra-indoor", "Terra", "Indoor", "Bordeaux/Rosa", "terrace", ("#6d1a2a", "#f2b8c6", "#b5835a"), "trend", "popular", ["shop"], False, ["adidas-gazelle-indoor"], None, 0, "Scamosciata e colorata."),
    ("nordline-20l", "Nordline", "20L", "Nero", "slim_runner", ("#1d1d1f", "#5a5a5f", "#3a3a3d"), "trend", "popular", ["shop"], False, ["new-balance-204l"], None, 0, "Bassa e sottile, il nuovo che avanza."),
    ("volta-vento-5", "Volta", "Vento 5", "Grigio freddo", "runner_retro", ("#a7adb5", "#d9dce0", "#f4f4f4"), "trend", "popular", ["shop"], False, ["nike-zoom-vomero-5"], None, 0, "Tecnica, con l'aria da runner del 2010."),
    ("nordline-906", "Nordline", "906", "Sale marino", "chunky", ("#ece6da", "#c9c2b4", "#f4f1ea"), "trend", "popular", ["shop"], False, ["new-balance-9060"], None, 0, "La chunky più desiderata."),
    ("vetta-x6", "Vetta", "X6", "Bianco luna", "trail", ("#f4f4f4", "#c7ccd3", "#9aa1ab"), "trend", "popular", ["shop"], False, ["salomon-xt-6"], None, 0, "Nata per la montagna, la usi in città."),
    ("rampa-gonfia", "Rampa", "Gonfia", "Nero/Bianco", "skate", ("#1d1d1f", "#f4f4f4", "#f4f4f4"), "trend", "popular", ["shop"], False, ["vans-knu-skool"], None, 0, "Skate anni '90 imbottita, perfetta coi jeans larghi."),
    ("lanetta-pantofola", "Lanetta", "Pantofola", "Castagna", "slipper", ("#a8693b", "#e8d6b8", "#5a3a22"), "trend", "popular", ["shop"], False, ["ugg-tasman"], None, 0, "Pantofola da fuori casa. Sì, si può."),
    ("sughero-clog", "Sughero", "Clog", "Visone", "clog", ("#8a7a6a", "#c4b5a2", "#6b5444"), "trend", "popular", ["shop"], False, ["birkenstock-boston"], None, 0, "Sabot scamosciato da campus."),
    ("volta-onda-plus", "Volta", "Onda+", "Nero onda", "runner_max", ("#1d1d1f", "#6b3fa0", "#2b2b2e"), "trend", "popular", ["shop"], False, ["nike-air-max-plus"], None, 0, "Aggressiva, da strada."),
    ("kaze-14", "Kaze", "14", "Argento/Blu", "runner_retro", ("#c0c4cc", "#3b6fb6", "#e8e8e8"), "trend", "popular", ["shop"], False, ["asics-gel-kayano-14"], None, 0, "Per chi ne sa."),
    # HYPE
    ("pista-corsa-og", "Pista", "Corsa OG", "Nero/Bianco", "slim_motorsport", ("#1d1d1f", "#f4f4f4", "#1d1d1f"), "hype", "hyped", ["drop"], True, ["puma-speedcat-og"], None, 3, "Sottile come una scarpa da pilota. Esaurita a ogni restock."),
    ("shiro-66", "Shiro", "66", "Giallo/Nero", "slim_runner", ("#f2c230", "#1d1d1f", "#e8dcc8"), "hype", "hyped", ["drop"], True, ["onitsuka-tiger-mexico-66"], None, 3, "Gialla con le strisce nere: impossibile non notarla."),
    ("volta-mente-slide", "Volta", "Mente Slide", "Nero/Cromo", "slide", ("#1d1d1f", "#c9ccd1", "#e04a2f"), "hype", "hyped", ["drop"], True, ["nike-mind-001-slide"], None, 3, "La ciabatta virale. Si porta con le calze."),
    ("salto-1-alta", "Salto", "1 Alta", "Rosso/Nero/Bianco", "court_high", ("#c8102e", "#1d1d1f", "#f4f4f4"), "hype", "hyped", ["drop"], True, ["air-jordan-1-retro-high-og"], None, 2, "La più iconica del basket."),
    ("salto-4-club", "Salto", "4 Club", "Vela/Nero/Rosso", "court_mid", ("#efe9dd", "#1d1d1f", "#c8102e"), "hype", "hyped", ["drop"], True, ["air-jordan-4-retro-flight-club"], None, 2, "La scarpa dei sogni."),
    ("falco-grid-9", "Falco", "Grid 9", "Grigio/Blu", "runner_retro", ("#a7adb5", "#2a4d8f", "#e8e8e8"), "hype", "hyped", ["drop"], True, ["saucony-progrid-omni-9"], None, 2, "Scoperta sui social, ancora poco diffusa."),
    # LIMITED
    ("salto-11-spazio", "Salto", "11 Spazio", "Nero/Blu", "court_high", ("#1d1d1f", "#2f3fa8", "#f4f4f4"), "limited", "limited", ["drop"], True, ["air-jordan-11-space-jam-2026"], 130, 1, "Uscita evento. Pochissime in giro."),
    ("salto-4-notte", "Salto", "4 Notte", "Nero/Rosso", "court_mid", ("#1d1d1f", "#c8102e", "#9a9a9a"), "limited", "limited", ["drop"], True, ["air-jordan-4-og-bred-2026"], 130, 1, "Colorway leggendaria."),
    # UPTHERE
    ("upthere-one", "Upthere", "One", "Edizione Villaggio", "upthere_one", ("#490D50", "#E292C4", "#F4F4F4"), "upthere", "limited", ["drop"], True, [], 90, 2, "Creata da Upthere. Il primo nome nel suo passaporto è il nostro."),
]

SILHOUETTES = {
    "court_low": "Scarpa da basket bassa, linea pulita (tipo campo da basket anni '80)",
    "court_mid": "Basket a collo medio con alette laterali e retina",
    "court_high": "Basket alta con collo sopra la caviglia",
    "terrace": "Bassa e sottile in camoscio, suola piatta color gomma, tre accenti laterali generici (NON tre strisce)",
    "runner_retro": "Runner anni 2000 a strati, suola media con dettagli argento",
    "runner_max": "Runner con suola molto alta/ammortizzata",
    "slim_runner": "Runner anni '70 molto bassa e sottile",
    "slim_motorsport": "Scarpa da pilota bassissima, punta arrotondata, suola sottile",
    "chunky": "Runner massiccia con suola scolpita e grossa",
    "trail": "Scarpa da trail con lacci rapidi e suola scolpita",
    "skate": "Skate shoe bassa con banda laterale generica (NON la jazz stripe)",
    "canvas_high": "Tela alta con punta in gomma",
    "slide": "Ciabatta recovery con cinturino largo e suola a bolle",
    "slipper": "Pantofola-mocassino con bordo in lana",
    "clog": "Sabot chiuso davanti, aperto dietro, suola in sughero",
    "upthere_one": "Silhouette originale Upthere: inventarla da zero, è il pezzo firma del villaggio",
}

items = []
for (iid, brand, name, cw, sil, pal, tier, rar, sources, fakeable, refs, stima, dw, flavor) in ITEMS:
    assert sil in SILHOUETTES, f"silhouette mancante: {sil}"
    for rid in refs:
        assert rid in ref_by_id, f"reference id inesistente: {rid}"
    if stima is not None:
        base_value, vsrc = stima, "stima_game_design"
    else:
        eur = ref_by_id[refs[0]]["prezzo_retail_eur"]
        assert eur is not None, f"{iid}: retail EUR nullo e nessuna stima"
        base_value = rnd(eur / EUR_TO_COIN_DIVISOR * RARITY_MULT[rar])
        vsrc = "riferimento_retail_eur"
    items.append({
        "id": iid,
        "brand": brand,
        "name": name,
        "display_name": f"{brand} {name}",
        "colorway": cw,
        "silhouette": sil,
        "sprite_key": sil,
        "palette": {"upper": pal[0], "accent": pal[1], "sole": pal[2]},
        "tier": tier,
        "rarity": rar,
        "base_value": base_value,
        "value_source": vsrc,
        "sources": sources,
        "fakeable": fakeable,
        "drop_weight": dw,
        "reference_ids": refs,
        "flavor": flavor,
    })

ids = [i["id"] for i in items]
assert len(ids) == len(set(ids)), "id item duplicati"

game_items = {
    "meta": {
        "versione": "1.0.0",
        "valuta": "monete di gioco",
        "regola_valore": f"base_value = round(retail_eur / {EUR_TO_COIN_DIVISOR} x moltiplicatore_rarità); dove il retail EUR manca, stima di game design (value_source).",
        "moltiplicatore_rarita": RARITY_MULT,
        "marchi": "TUTTI FITTIZI. Silhouette e palette sono ispirate a modelli reali ma non devono riprodurre loghi, strisce, swoosh o altri segni distintivi.",
        "sprite": "Icone 32x32 per l'UI, una per silhouette, colorate a runtime con la palette (upper/accent/sole). Gli sprite dei falsi sono IDENTICI agli originali.",
        "numero_item": len(items),
    },
    "silhouettes": SILHOUETTES,
    "items": items,
}

# ---------------------------------------------------------------------------
# 4. game_config.json
# ---------------------------------------------------------------------------
starter_pool = [i["id"] for i in items if "starter" in i["sources"]]
game_config = {
    "version": "1.0.0",
    "conference": {"date": "2026-10-23", "expected_players": 100},
    "brand": {
        "name": "Upthere",
        "colors": {
            "primary": "#490D50",
            "primary-700": "#6F305B",
            "accent": "#B26998",
            "accent-400": "#E292C4",
            "accent-900": "#3A012D",
            "warn": "#dc393c",
        },
        "roofs_texture": "buildings_roofs_upthere",
        "fonts": {
            "css": "assets/brand/fonts.css",
            "display": "Chillax (600 titoli, 500 sottotitoli)",
            "body": "DM Sans (variabile)",
            "credits": "Chillax: Indian Type Foundry (Fontshare) · DM Sans: SIL OFL 1.1",
        },
        "logo": {
            "svg_white": "assets/brand/logo_upthere_white.svg",
            "svg_primary": "assets/brand/logo_upthere_primary.svg",
            "pixel": ["assets/brand/pixel/logo_pixel_24.png", "assets/brand/pixel/logo_pixel_32.png"],
            "favicon": "assets/brand/favicon.ico",
            "source": "https://upthere.it (header del sito, 13/10/2026)",
        },
        "signs": {
            "banca": "brand_pixel_sign_banca", "negozio": "brand_pixel_sign_negozio",
            "enoteca": "brand_pixel_sign_enoteca", "bacheca": "brand_pixel_sign_bacheca",
            "autenticatore": "brand_pixel_sign_autenticatore", "palco": "brand_pixel_sign_palco",
        },
        "contrast_rules": {
            "testo_bianco_su": ["primary", "primary-700", "accent-900"],
            "testo_primary_su": ["accent-400"],
            "accent_solo_decorativo_o_testo_grande": "bianco su accent = 3,9:1, sotto AA per testo normale",
            "warn": "bianco su warn = 4,47:1: usare solo testo bold >= 14 px oppure warn come bordo/icona su fondo chiaro",
        },
    },
    "links": {"dop_digital": "https://dopdigital.it/"},
    "player": {
        "start_coins": 100,
        "starter_item_pool": starter_pool,
        "max_inventory": 12,
        "nickname": {
            "pattern": "{animal}{number}",
            "number_digits": 2,
            "animals": ["Volpe", "Lince", "Gufo", "Lupo", "Orso", "Riccio", "Lontra", "Corvo", "Geco", "Delfino",
                        "Koala", "Panda", "Castoro", "Fenicottero", "Camaleonte", "Pinguino", "Tasso", "Scoiattolo"],
            "editable": False,
        },
        "recovery_code": {"length": 6, "alphabet": "ABCDEFGHJKMNPQRSTUVWXYZ23456789", "display_format": "XXX-XXX"},
        "inactivity_anonymize_days": 30,
        "rate_limit_actions_per_sec": 8,
    },
    "avatar": {
        "frame": {"width": 64, "height": 64, "origin_x": 0.5, "origin_y": 0.75},
        "traits": "3 tratti: pelle (5 toni) · capelli (3 stili x 6 colori) · felpa (8 colori)",
        "skin_tones": ["#f6d3b8", "#e3b08b", "#c68863", "#8d5a3c", "#5c3a26"],
        "hair_styles": ["corti", "lunghi", "cappellino"],
        "hair_colors": ["#2b1d14", "#1a1a1a", "#8a5a2b", "#d9b45a", "#c8102e", "#2f6fdb"],
        "outfit_colors": ["#1d1d1f", "#f4f4f4", "#c8102e", "#2f6fdb", "#B26998", "#f2c230", "#7b4fd6", "#3a8f4f"],
        "pants_color": "#2d3a5a",
        "shoes_default_color": "#f4f4f4",
        "shoes_color_from": "palette.upper della scarpa con valore percepito più alto",
        "draw_order": ["body", "pants", "shoes", "hoodie", "hair"],
        "animations": {"idle": {"frames": 4, "frameRate": 6}, "walk": {"frames": 6, "frameRate": 10}},
        "directions": ["down", "side", "up"],
        "side_left": "flipX dello sheet side",
    },
    "first_run": {
        "duration_sec": 300,
        "objective": {"type": "wardrobe_value_growth", "multiplier": 1.3, "_note": "da tarare in playtest"},
        "beats": [
            {"at_sec": 0, "id": "welcome"},
            {"at_sec": 15, "id": "tooltip_move"},
            {"at_sec": 30, "id": "tooltip_passport"},
            {"at_sec": 45, "id": "objective"},
            {"at_sec": 90, "id": "hint_stall"},
            {"at_sec": 150, "id": "hint_legend"},
            {"at_sec": 210, "id": "hint_market"},
            {"at_sec": 270, "id": "closing_warning"},
            {"at_sec": 300, "id": "reveal"},
        ],
    },
    "economy": {
        "system_players": {"treasury": 1, "shop": 2, "stall": 3, "legend": 4, "bots_from": 10},
        "treasury_initial": 5000,
        "market_fee_pct": 5,
        "market_fee_min": 1,
        "listing_min_price": 2,
        "listing_max_multiplier": 5,
        "shop_price": "base_value",
        "auth_cost": 3,
        "legend": {"cost": 15, "wear_duration_sec": 10, "cooldown_sec": 60},
        "bots": {
            "count": 8,
            "buy_pct": 0.70,
            "sell_pct": 1.15,
            "min_treasury_pct_to_buy": 0.20,
            "tick_sec": 5,
            "max_inventory_per_bot": 6,
            "full_activity_below_humans_online": 10,
            "min_activity_at_humans_online": 40,
            "min_activity": 0.2,
        },
        "stall": {"price_pct_of_base": 0.50, "max_fakes_on_sale": 3, "restock_sec": 90, "fake_tiers": ["hype", "limited", "upthere"]},
    },
    "valuation": {
        "legend_bonus_per_wear": 0.40,
        "legend_max_counted": 2,
        "upthere_mint_bonus": 0.25,
        "gap_multiplier": 0.40,
        "flip_free_owners": 5,
        "flip_penalty_per_owner": 0.05,
        "flip_floor": 0.75,
        "fake_value_after_auth": 2,
        "min_value": 1,
    },
    "drops": {
        "interval_sec": 180,
        "quantity": 4,
        "window_sec": 60,
        "max_per_player": 1,
        "price": "base_value",
        "pool_tiers": ["hype", "limited", "upthere"],
        "weighting": "drop_weight in game_items.json",
    },
    "world": {
        "tick_hz": 10,
        "visible_radius_px": 320,
        "max_players_per_room": 150,
        "emotes": ["👋", "🔥", "😂", "👟", "💸", "🤝"],
        "tap_npc_behaviour": "l'avatar cammina fino all'NPC e il pannello si apre all'arrivo",
        "map": "assets/maps/village.json",
        "walk_speed_px_s": 72,
        "camera_zoom": 2,
        "emote_duration_ms": 2500,
        "reconcile_px": 24,
    },
    "chain": {
        "enabled": True,
        "notary": "mock",
        "network": "TODO-D1",
        "batch_interval_ms": 2000,
        "max_items_per_batch": 20,
        "max_attempts": 5,
        "explorer_tx_url": "TODO-D1",
        "certify": "MINT (tranne FAKE_MINT) + ogni evento con almeno un giocatore umano",
        "mock": {"min_delay_ms": 1500, "max_delay_ms": 4000},
    },
    "leaderboard": {"metric": "wardrobe_value", "size": 10},
}

# drop pool check
drop_items = [i for i in items if i["tier"] in game_config["drops"]["pool_tiers"]]
assert drop_items and all(i["drop_weight"] > 0 for i in drop_items)
assert all(i["fakeable"] for i in items if i["tier"] in game_config["economy"]["stall"]["fake_tiers"])

# ---------------------------------------------------------------------------
# 5. npcs.json
# ---------------------------------------------------------------------------
npcs = {
    "meta": {"nota": "Nomi e battute sono proposte (decisione D6 in PLAN.md). Testi brevi, tono da ragazzi, niente volgarità.", "sprite": "sprite.type = sheet → chiave in apps/client/public/assets/manifest.json; sprite.type = avatar → composto con i layer dell'avatar (vedi docs/ASSETS.md)"},
    "system_players": [
        {
            "player_id": 1, "role": "TREASURY", "name": "Banca Upthere", "zone": "banca", "sprite_key": "npc_tavern_b_idle", "sprite": {"type": "sheet", "key": "npc_tavern_b_idle", "flipX": False},
            "purpose": "Tesoreria dell'economia chiusa. Annuncia e vende i drop: le scarpe dei drop hanno Upthere come primo proprietario.",
            "lines": {
                "idle": ["Qui nasce la storia delle scarpe migliori.", "Ogni drop parte da noi: primo anello certificato."],
                "drop_open": ["Drop aperto! {qty} paia di {item} a {price} monete. Una a testa."],
                "drop_soldout": ["Finite. Al prossimo drop tra {min} minuti."],
            },
        },
        {
            "player_id": 2, "role": "SHOP", "name": "Il Negozio", "zone": "negozio", "sprite_key": "npc_tavern_a_idle", "sprite": {"type": "sheet", "key": "npc_tavern_a_idle", "flipX": False},
            "purpose": "Vende le scarpe base e trend a base_value. Conia gli asset (MINT) e li trasferisce al compratore.",
            "lines": {"idle": ["Prezzi giusti, scarpe vere. Niente sorprese.", "Ogni paio esce da qui con il passaporto già aperto."]},
        },
        {
            "player_id": 3, "role": "STALL", "name": "Tony Affari", "zone": "bancarella", "sprite_key": "npc_rogue_idle", "sprite": {"type": "sheet", "key": "npc_rogue_idle", "flipX": False},
            "purpose": "Vende FALSI di scarpe hype/limited/Upthere One a metà prezzo. Sprite identici agli originali; il passaporto mostra l'origine non certificata.",
            "lines": {
                "idle": ["Psst. Roba buona a metà prezzo.", "Originali, giuro. Più o meno."],
                "offer": ["{item} a {price}. Affare del giorno, solo per te."],
                "after_sale": ["Grazie, eh. Il passaporto? Dettagli."],
            },
        },
        {
            "player_id": 4, "role": "LEGEND", "name": "MC Suola", "zone": "palco", "sprite_key": "avatar", "sprite": {"type": "avatar", "skin": 3, "hair_style": "cappellino", "hair_color": "#f2c230", "outfit_color": "#1d1d1f", "shoes_color": "#c8102e", "note": "costruito con i layer dell'avatar: stesso stile dei giocatori, ma riconoscibile"},
            "purpose": "Per 15 monete indossa la scarpa per 10 secondi: due anelli nel passaporto (LEGEND_IN/LEGEND_OUT) e +40% di valore.",
            "lines": {
                "idle": ["Le indosso dieci secondi e la tua scarpa entra nella storia.", "Non conta che le ho messe. Conta che si può dimostrare."],
                "wearing": ["Un attimo che faccio due foto…"],
                "returned": ["Ecco qua. Ora nel passaporto ci sono anch'io."],
                "cooldown": ["Calma, ho appena finito con un altro paio. Torna tra poco."],
            },
        },
    ],
    "service_npcs": [
        {
            "id": "authenticator", "name": "Dott.ssa Hash", "zone": "autenticatore", "sprite_key": "npc_wizard_idle", "sprite": {"type": "sheet", "key": "npc_wizard_idle", "flipX": False},
            "purpose": "Per 3 monete verifica una scarpa del giocatore: controlla che la catena parta da un MINT certificato.",
            "lines": {
                "idle": ["Dammi 3 monete e ti dico la verità su quella scarpa."],
                "genuine": ["Autentica. Ogni passaggio torna, dal primo all'ultimo."],
                "fake": ["Falsa. Il passaporto non parte da un produttore certificato. Vale 2 monete, mi spiace."],
            },
        },
        {
            "id": "dop_wine_shop", "name": "Enoteca DOP Digital", "zone": "enoteca", "sprite_key": "npc_peasant_a_idle", "sprite": {"type": "sheet", "key": "npc_peasant_a_idle", "flipX": False},
            "purpose": "Ponte verso DOP Digital: mostra il passaporto (demo) di una bottiglia di vino con la stessa UI delle scarpe.",
            "lines": {
                "idle": ["Le scarpe hanno un passaporto. Anche il vino.", "Inquadra la bottiglia: stessa storia, dal vigneto al tavolo."],
            },
            "demo_bottle": {
                "label": "ESEMPIO DIMOSTRATIVO",
                "name": "Bottiglia demo DOP Digital",
                "timeline": [
                    {"step": "Vigneto", "detail": "Vendemmia e lotto di provenienza", "certified": True},
                    {"step": "Cantina", "detail": "Vinificazione e imbottigliamento", "certified": True},
                    {"step": "Etichetta elettronica", "detail": "Ingredienti, valori nutrizionali, info ambientali via QR", "certified": True},
                    {"step": "Distributore", "detail": "Passaggio di proprietà", "certified": True},
                    {"step": "Enoteca", "detail": "Passaggio di proprietà", "certified": True},
                    {"step": "Tu", "detail": "Inquadri il QR e vedi tutta la storia", "certified": True},
                ],
                "cta": {"text": "Scopri DOP Digital", "url": "https://dopdigital.it/"},
            },
        },
    ],
    "bots": [
        {"player_id": 10 + n, "nickname": nick, "style": style,
         "sprite": {"type": "avatar", "random_traits": True, "seed": 10 + n}}
        for n, (nick, style) in enumerate([
            ("Lince17", "compra_sottoprezzo"), ("Gufo08", "vende_trend"), ("Volpe33", "collezionista_hype"),
            ("Orso21", "compra_sottoprezzo"), ("Riccio45", "vende_base"), ("Lontra12", "collezionista_hype"),
            ("Corvo56", "vende_trend"), ("Geco90", "compra_sottoprezzo"),
        ])
    ],
}
assert len(npcs["bots"]) == game_config["economy"]["bots"]["count"]

# ---------------------------------------------------------------------------
# write
# ---------------------------------------------------------------------------
for name, obj in [
    ("catalog_reference.json", catalog_reference),
    ("game_items.json", game_items),
    ("game_config.json", game_config),
    ("npcs.json", npcs),
]:
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    json.load(open(p, encoding="utf-8"))  # validazione

print("reference:", catalog_reference["meta"]["numero_record"], "record,",
      catalog_reference["meta"]["record_con_retail_eur"], "con retail EUR,",
      catalog_reference["meta"]["record_con_resell_eur"], "con resell EUR")
print("items:", len(items))
for i in items:
    print(f'  {i["tier"]:8} {i["display_name"]:24} {i["base_value"]:>4}  {i["value_source"]}')
print("starter pool:", starter_pool)
