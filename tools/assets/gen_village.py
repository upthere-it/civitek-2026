"""
Genera la mappa del villaggio (GAME_DESIGN §4) in formato Tiled JSON, più un'anteprima PNG.

    python3 tools/assets/gen_village.py apps/client/public/assets

Output:
  maps/village.json      mappa Tiled (orthogonal, tile da 16 px): si apre e si ritocca in Tiled
  PREVIEW_village.png    anteprima composta (terreno, edifici, prop, NPC, insegne, collider in rosso)

Livelli:
  ground (dirt)  → cobble (piazza, con il buco del palco) → grass (bordo, con il buco della piazza)
  buildings      muri degli edifici, fontana            (sotto i personaggi)
  roofs          tetti                                  (sopra i personaggi: chi passa dietro resta coperto)
  colliders      rettangoli non calpestabili             (server e client ne ricavano la griglia)
  decor          prop come rettangoli con proprietà texture/sx/sy (ritaglio dello sheet), opz. above
  places         punti: spawn, NPC (zone di npcs.json), bacheca; proprietà approach = "tx,ty"

Le texture si riferiscono alle chiavi di assets/manifest.json: i tileset hanno come `name` la chiave.
I numeri del layout sono qui (è un generatore di asset, come gen_shoes.py), non nel codice di gioco.
"""
import json
import os
import random
import sys

from PIL import Image, ImageDraw

ASSETS = sys.argv[1]
V = os.path.join(ASSETS, 'vendor', 'pixel-crawler')
T = 16
W, H = 30, 40
rnd = random.Random(23102026)

# ---------------------------------------------------------------- tileset (nome = chiave del manifest)
TILESETS = [
    ('tiles_floors', 'tiles/floors.png'),
    ('tiles_water', 'tiles/water.png'),
    ('buildings_walls', 'buildings/walls.png'),
    ('buildings_roofs_upthere', 'buildings/roofs_upthere.png'),
]
tilesets, first = [], 1
for name, rel in TILESETS:
    im = Image.open(os.path.join(V, rel))
    cols, rows = im.width // T, im.height // T
    tilesets.append({
        'firstgid': first, 'name': name, 'image': f'../vendor/pixel-crawler/{rel}',
        'imagewidth': im.width, 'imageheight': im.height, 'tilewidth': T, 'tileheight': T,
        'columns': cols, 'tilecount': cols * rows, 'margin': 0, 'spacing': 0,
    })
    first += cols * rows
TS = {t['name']: t for t in tilesets}


def gid(ts, col, row):
    t = TS[ts]
    return t['firstgid'] + row * t['columns'] + col


def layer():
    return [0] * (W * H)


def put(lay, x, y, g):
    if 0 <= x < W and 0 <= y < H:
        lay[y * W + x] = g


# ---------------------------------------------------------------- terreno
# floors.png: ogni terreno ha un modello "buco" 5×5 (righe 0–4) e righe di riempimento (10–11).
#   colonne 0–4 erba, 5–9 ciottolato, 10–14 terra. Il terreno sopra si "buca" e lascia vedere quello sotto.
TERRAIN_COL = {'grass': 0, 'cobble': 5, 'dirt': 10}


def fill_tile(kind):
    c = TERRAIN_COL[kind]
    return gid('tiles_floors', c + rnd.choice([1, 2, 3]), 10)


def hole_tile(kind, ty, tx):
    return gid('tiles_floors', TERRAIN_COL[kind] + tx, ty)


def terrain(kind, holes):
    """Riempie tutto con `kind` tranne i buchi (x0, y0, x1, y1 interni, almeno 3×3), con i bordi del modello."""
    lay = [fill_tile(kind) for _ in range(W * H)]
    for x0, y0, x1, y1 in holes:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                corner = {(x0, y0): (1, 1), (x1, y0): (1, 3), (x0, y1): (3, 1), (x1, y1): (3, 3)}.get((x, y))
                put(lay, x, y, hole_tile(kind, *corner) if corner else 0)
        for x in range(x0, x1 + 1):
            tx = 1 if x == x0 else 3 if x == x1 else 2
            put(lay, x, y0 - 1, hole_tile(kind, 0, tx))
            put(lay, x, y1 + 1, hole_tile(kind, 4, tx))
        for y in range(y0, y1 + 1):
            ty = 1 if y == y0 else 3 if y == y1 else 2
            put(lay, x0 - 1, y, hole_tile(kind, ty, 0))
            put(lay, x1 + 1, y, hole_tile(kind, ty, 4))
    return lay


PLAZA = (2, 11, 27, 36)          # interno calpestabile della piazza
STAGE = (20, 17, 24, 20)         # spiazzo in terra battuta del palco di MC Suola

ground = [fill_tile('dirt') for _ in range(W * H)]
cobble = terrain('cobble', [STAGE])
grass = terrain('grass', [PLAZA])
buildings, roofs = layer(), layer()
colliders, decor, places = [], [], []


def collider(x, y, w, h, name=''):
    colliders.append({'name': name, 'x': x, 'y': y, 'width': w, 'height': h})


def deco(texture, sx, sy, sw, sh, x, y, above=False, name=''):
    """Prop: (x, y) = angolo in alto a sinistra in pixel mondo."""
    props = [{'name': 'texture', 'type': 'string', 'value': texture},
             {'name': 'sx', 'type': 'int', 'value': sx}, {'name': 'sy', 'type': 'int', 'value': sy}]
    if above:
        props.append({'name': 'above', 'type': 'bool', 'value': True})
    decor.append({'name': name or texture, 'x': x, 'y': y, 'width': sw, 'height': sh, 'properties': props})


def place(kind, name, x, y, approach=None, **extra):
    props = [{'name': k, 'type': 'string', 'value': str(v)} for k, v in extra.items()]
    if approach:
        props.append({'name': 'approach', 'type': 'string', 'value': f'{approach[0]},{approach[1]}'})
    places.append({'name': name, 'type': kind, 'x': x, 'y': y, 'point': True, 'properties': props})


# ---------------------------------------------------------------- prop (ritagli in pixel dagli sheet)
P = {
    'door':      ('buildings_props', 132, 25, 24, 39),
    'window':    ('buildings_props', 100, 64, 24, 32),
    'bench':     ('buildings_props', 80, 160, 64, 32),
    'bench_s':   ('buildings_props', 16, 128, 32, 16),
    'board':     ('props_farm', 284, 26, 60, 50),
    'crates':    ('props_farm', 336, 0, 64, 28),
    'sack':      ('props_farm', 256, 0, 16, 32),
    'bush':      ('props_vegetation', 2, 5, 29, 27),
    'bush_l':    ('props_vegetation', 0, 96, 50, 48),
    'pine':      ('props_trees_model_02_size_03', 0, 80, 48, 80),
    'pine_teal': ('props_trees_model_02_size_03', 0, 0, 48, 76),
}
FLOWERS = [('props_vegetation', 48 + 16 * i, 368 + 16 * r, 16, 16) for r in range(4) for i in range(4)]


def prop(key, x, y, above=False, name=''):
    tex, sx, sy, sw, sh = P[key]
    deco(tex, sx, sy, sw, sh, x, y, above, name or key)
    return sw, sh


def sign(zone, cx, bottom):
    im = Image.open(os.path.join(ASSETS, 'brand', 'pixel', f'sign_{zone}.png'))
    deco(f'brand_pixel_sign_{zone}', 0, 0, im.width, im.height, cx - im.width // 2, bottom - im.height, True, f'sign_{zone}')


# ---------------------------------------------------------------- edifici (tetto Upthere 8×6 + facciata 8×3)
WALL_SEQ = [30, 31, 35, 33, 34, 32, 30, 31]   # intonaco con zoccolo in mattoni: pannelli larghi (2) e stretti (1)


def building(bx, by, zone, npc_sprite, npc_side):
    for r in range(6):
        for c in range(8):
            put(roofs, bx + c, by + r, gid('buildings_roofs_upthere', 8 + c, r))
    for r in range(3):
        for i, c in enumerate(WALL_SEQ):
            put(buildings, bx + i, by + 6 + r, gid('buildings_walls', c, 12 + r))
    bottom = (by + 9) * T
    door_cx = (bx + 4) * T
    prop('door', door_cx - 12, bottom - 39, name=f'door_{zone}')
    prop('window', (bx + 1) * T + 4, (by + 6) * T + 10)
    prop('window', (bx + 6) * T - 4, (by + 6) * T + 10)
    sign(zone, door_cx, (by + 5) * T + 23)
    collider(bx * T, by * T, 8 * T, 9 * T, f'building_{zone}')
    nx = door_cx + 28 * npc_side
    place('npc', zone, nx, bottom + 8, approach=(nx // T, by + 10), sprite=npc_sprite)
    collider(nx - 8, bottom, T, T, f'npc_{zone}')


building(3, 2, 'banca', 'npc_tavern_b_idle', +1)
building(3, 14, 'negozio', 'npc_tavern_a_idle', +1)
building(19, 26, 'enoteca', 'npc_peasant_a_idle', -1)

# ---------------------------------------------------------------- fontana (mattoni + acqua) al centro
FX, FY = 13, 16
for r in range(5):
    for c in range(5):
        put(buildings, FX + c, FY + r, gid('tiles_floors', 15 + c, r))
for r in range(1, 4):
    for c in range(1, 4):
        put(buildings, FX + c, FY + r, gid('tiles_water', 2, 7))
collider(FX * T + 4, FY * T + 4, 5 * T - 8, 5 * T - 8, 'fontana')
place('spawn', 'spawn', (FX + 2) * T + 8, (FY + 7) * T + 8)

# ---------------------------------------------------------------- bacheca del mercato (in alto a destra)
bw, bh = prop('board', 21 * T + 2, 11 * T + 6, name='bacheca')
sign('bacheca', 21 * T + 2 + bw // 2, 11 * T + 10)
collider(21 * T, 12 * T, 4 * T, 2 * T, 'bacheca')
place('board', 'bacheca', 23 * T, 14 * T + 8, approach=(23, 14))

# ---------------------------------------------------------------- palco di MC Suola (spiazzo in terra)
sign('palco', 22 * T + 8, 17 * T + 2)
place('npc', 'palco', 22 * T + 8, 19 * T, approach=(22, 21), sprite='avatar')
collider(22 * T, 18 * T, T, 2 * T, 'mc_suola')
prop('bench_s', 20 * T + 8, 22 * T + 4)
prop('bench_s', 23 * T + 8, 22 * T + 4)
collider(20 * T + 8, 22 * T + 4, 32, 12)
collider(23 * T + 8, 22 * T + 4, 32, 12)

# ---------------------------------------------------------------- bancarella di Tony Affari (in basso a sinistra)
place('npc', 'bancarella', 5 * T, 29 * T + 4, approach=(5, 31), sprite='npc_rogue_idle')
prop('crates', 3 * T + 8, 29 * T + 6)
prop('sack', 7 * T + 8, 28 * T + 8)
collider(3 * T + 8, 29 * T + 6, 64, 26, 'bancarella')
collider(4 * T, 28 * T, 2 * T, T)
collider(7 * T + 8, 29 * T, 16, 16)

# ---------------------------------------------------------------- Dott.ssa Hash (in basso al centro)
sign('autenticatore', 15 * T, 27 * T + 10)
place('npc', 'autenticatore', 15 * T, 29 * T + 6, approach=(15, 31), sprite='npc_wizard_idle')
prop('bench', 13 * T, 29 * T + 4)
collider(13 * T, 29 * T + 4, 64, 28, 'autenticatore')
collider(14 * T, 28 * T + 8, 2 * T, T)

# ---------------------------------------------------------------- panchine e verde
prop('bench', 11 * T, 24 * T + 12)
collider(11 * T, 24 * T + 16, 64, 24)
prop('bench', 13 * T, 12 * T)
collider(13 * T, 12 * T + 4, 64, 24)

# bordo: fuori dalla piazza non si cammina
collider(0, 0, W * T, PLAZA[1] * T, 'bordo_nord')
collider(0, (PLAZA[3] + 1) * T, W * T, (H - PLAZA[3] - 1) * T, 'bordo_sud')
collider(0, 0, PLAZA[0] * T, H * T, 'bordo_ovest')
collider((PLAZA[2] + 1) * T, 0, (W - PLAZA[2] - 1) * T, H * T, 'bordo_est')

for x in range(12, 28, 3):
    prop('pine' if x % 2 else 'pine_teal', x * T + rnd.randint(-4, 4), rnd.randint(-28, -8))
for x in range(0, 30, 2):
    if 3 * T <= x * T <= 11 * T:
        continue
    prop('bush', x * T + rnd.randint(0, 6), 8 * T + rnd.randint(0, 10))
for y in range(12, 37, 3):
    prop('bush', rnd.randint(-10, -2), y * T + rnd.randint(0, 8))
    prop('bush', 28 * T + rnd.randint(2, 8), y * T + rnd.randint(0, 8))
for x in range(0, 30, 3):
    prop('bush_l', x * T + rnd.randint(-6, 6), 37 * T + rnd.randint(2, 14))
for _ in range(14):
    tex, sx, sy, sw, sh = rnd.choice(FLOWERS)
    fx, fy = rnd.choice([(rnd.randint(0, 26), rnd.randint(9, 10)), (rnd.randint(0, 27), 37)])
    deco(tex, sx, sy, sw, sh, fx * T + rnd.randint(0, 8), fy * T + rnd.randint(0, 6), name='fiore')


# ---------------------------------------------------------------- JSON Tiled
def tile_layer(lid, name, data):
    return {'id': lid, 'name': name, 'type': 'tilelayer', 'x': 0, 'y': 0, 'width': W, 'height': H,
            'opacity': 1, 'visible': True, 'data': data}


def object_layer(lid, name, objs, visible=True):
    for i, o in enumerate(objs):
        o.setdefault('id', lid * 1000 + i + 1)
        o.setdefault('rotation', 0)
        o.setdefault('visible', True)
        o.setdefault('type', '')
        o.setdefault('width', 0)
        o.setdefault('height', 0)
    return {'id': lid, 'name': name, 'type': 'objectgroup', 'x': 0, 'y': 0, 'opacity': 1,
            'visible': visible, 'draworder': 'topdown', 'objects': objs}


layers = [
    tile_layer(1, 'ground', ground),
    tile_layer(2, 'cobble', cobble),
    tile_layer(3, 'grass', grass),
    tile_layer(4, 'buildings', buildings),
    tile_layer(5, 'roofs', roofs),
    object_layer(6, 'decor', decor),
    object_layer(7, 'places', places),
    object_layer(8, 'colliders', colliders, visible=False),
]
tmj = {
    'type': 'map', 'version': '1.10', 'tiledversion': '1.10.2', 'orientation': 'orthogonal',
    'renderorder': 'right-down', 'width': W, 'height': H, 'tilewidth': T, 'tileheight': T,
    'infinite': False, 'nextlayerid': 9, 'nextobjectid': 9000, 'layers': layers, 'tilesets': tilesets,
    'properties': [{'name': 'generator', 'type': 'string', 'value': 'tools/assets/gen_village.py'}],
}
os.makedirs(os.path.join(ASSETS, 'maps'), exist_ok=True)
with open(os.path.join(ASSETS, 'maps', 'village.json'), 'w') as f:
    json.dump(tmj, f, separators=(',', ':'))

# ---------------------------------------------------------------- anteprima
manifest = json.load(open(os.path.join(ASSETS, 'manifest.json')))
paths = {i['key']: i['path'] for i in manifest['images']} | {s['key']: s['path'] for s in manifest['spritesheets']}
sheets = {s['key']: s for s in manifest['spritesheets']}
img_cache = {}


def tex(key):
    if key not in img_cache:
        img_cache[key] = Image.open(os.path.join(ASSETS, '..', paths[key])).convert('RGBA')
    return img_cache[key]


ts_img = {t['name']: Image.open(os.path.join(ASSETS, 'maps', t['image'])).convert('RGBA') for t in tilesets}


def draw_layer(out, data):
    for i, g in enumerate(data):
        if not g:
            continue
        t = max((t for t in tilesets if t['firstgid'] <= g), key=lambda t: t['firstgid'])
        lid = g - t['firstgid']
        sx, sy = (lid % t['columns']) * T, (lid // t['columns']) * T
        out.alpha_composite(ts_img[t['name']].crop((sx, sy, sx + T, sy + T)), ((i % W) * T, (i // W) * T))


def draw_decor(out, above):
    for o in sorted(decor, key=lambda o: o['y'] + o['height']):
        p = {q['name']: q['value'] for q in o['properties']}
        if bool(p.get('above')) != above:
            continue
        crop = tex(p['texture']).crop((p['sx'], p['sy'], p['sx'] + o['width'], p['sy'] + o['height']))
        out.alpha_composite(crop, (o['x'], o['y']))


out = Image.new('RGBA', (W * T, H * T), (0, 0, 0, 255))
for data in (ground, cobble, grass, buildings):
    draw_layer(out, data)
draw_decor(out, above=False)
for p in places:
    sprite = next((q['value'] for q in p['properties'] if q['name'] == 'sprite'), None)
    if sprite and sprite in sheets:
        s = sheets[sprite]
        frame = tex(sprite).crop((0, 0, s['frameWidth'], s['frameHeight']))
        out.alpha_composite(frame, (int(p['x'] - s['frameWidth'] * s['originX']), int(p['y'] - s['frameHeight'] * s['originY'])))
draw_layer(out, roofs)
draw_decor(out, above=True)
over = Image.new('RGBA', out.size)
d = ImageDraw.Draw(over)
for c in colliders:
    if not c['name'].startswith('bordo'):
        d.rectangle([c['x'], c['y'], c['x'] + c['width'] - 1, c['y'] + c['height'] - 1], outline=(255, 40, 40, 140))
for p in places:
    d.ellipse([p['x'] - 3, p['y'] - 3, p['x'] + 3, p['y'] + 3], fill=(255, 230, 0, 220))
out.alpha_composite(over)
out.resize((W * T * 2, H * T * 2), Image.NEAREST).save(os.path.join(ASSETS, 'PREVIEW_village.png'))
print(f'village.json: {W}x{H} tile, {len(decor)} prop, {len(colliders)} collider, {len(places)} punti')
