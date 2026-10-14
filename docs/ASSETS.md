# ASSETS — pixel art del gioco

## 1. Licenza

La base grafica è **Pixel Crawler — Free Pack** di **Anokolisa**. I termini completi sono in `apps/client/public/assets/vendor/pixel-crawler/Terms.txt`.

In sintesi:
- l'uso commerciale è ammesso;
- gli asset si possono modificare (forma, colori, pattern);
- citare l'autore non è obbligatorio;
- è vietato rivendere gli asset come prodotto a sé.

Per correttezza mettiamo comunque il credito nella pagina `/privacy`: "Pixel art: Pixel Crawler di Anokolisa".

**Font e logo** vengono dal sito upthere.it e sono di Upthere:
- **Chillax** (Indian Type Foundry, distribuito da Fontshare): uso commerciale gratuito secondo i termini Fontshare, che però chiedono di citare il font e la foundry. Va nei crediti di `/privacy`.
- **DM Sans**: SIL Open Font License 1.1, nessun vincolo pratico.

Crediti da mettere in `/privacy`: "Pixel art: Pixel Crawler di Anokolisa · Font: Chillax di Indian Type Foundry (Fontshare), DM Sans (SIL OFL)".

Il pack originale completo, con i sorgenti `.aseprite`, è in `vendor/Pixel_Crawler_-_Free_Pack_2_11.zip` e **non** viene servito al client. Gli script in `tools/assets/` leggono il pack estratto: decomprimilo fuori dal repo prima di usarli.

## 2. Struttura

```
apps/client/public/assets/
├── manifest.json            tutto quello che la scena Boot deve caricare (~405 KB)
├── PREVIEW_avatar.png       anteprima delle combinazioni avatar
├── PREVIEW_items.png        anteprima delle 29 icone scarpe
├── PREVIEW_roofs.png        confronto tetti originali / ricolorati Upthere (§6)
├── PREVIEW_village.png      anteprima della mappa del villaggio (collider in rosso, punti in giallo)
├── maps/village.json        mappa Tiled del villaggio (§6), generata da tools/assets/gen_village.py
├── avatar/
│   ├── body/                skin_{0..4}_… (ragazzo) e skinf_{0..4}_… (ragazza: ciglia e guance), {idle|walk}_{down|side|up}.png
│   ├── layers/              {pants|skirt|shoes|hoodie|hair_corti|hair_lunghi|hair_cappellino|hair_coda}_{anim}_{dir}.png  (ragazza: skirt al posto di pants)
│   └── avatar_manifest.json
├── brand/
│   ├── logo_upthere_white.svg / logo_upthere_primary.svg   logo vettoriale dal sito (bianco per fondi scuri, primary per fondi chiari)
│   ├── favicon.ico
│   ├── fonts.css            @font-face + variabili --up-font-display / --up-font-body
│   ├── fonts/               Chillax Medium e Semibold (woff), DM Sans variabile (woff2, latin + latin-ext)
│   └── pixel/               insegne degli edifici (sign_*.png) e logo pixel (logo_pixel_24/32.png)
├── shoes/
│   ├── items_atlas.png/json atlas delle 29 icone 32×32 (formato JSON Hash di Phaser, chiave = item id)
│   ├── items/               icone singole (per la card condivisibile e la pagina pubblica del passaporto)
│   └── silhouettes/         16 maschere in grigi, utili per ridisegnare
└── vendor/pixel-crawler/    selezione curata del pack, con nomi file puliti
    ├── characters/          corpo base Body_A (sorgente per rigenerare l'avatar; non caricato al boot)
    ├── npc/                 rogue, wizard, tavern_a, tavern_b, peasant_a
    ├── tiles/               floors (erba, ciottolato, terra, mattoni), water
    ├── buildings/           walls, roofs, props (porte, finestre, panche, staccionate), shadows
    └── props/               vegetation, farm, furniture, rocks, shadows, trees/
```

**Esclusi apposta**, perché fuori tema rispetto a ragazzi e sneaker:
- armi, mob (orchi, scheletri), Knight;
- tile e prop da dungeon, esoterico, carne, attrezzi;
- stazioni di crafting, interni;
- animazioni di morte e combattimento.

Non reintrodurli.

## 3. Avatar a layer

Ogni avatar è composto da 5 sprite sovrapposti nello stesso punto. Tutti hanno frame da **64×64** e lo stesso layout di animazione, quindi restano sincronizzati.

| Ordine | Layer | Texture | Colore |
|---|---|---|---|
| 1 | Corpo | `skin_{tono}_*` | già ricolorato (palette swap, occhi intatti) |
| 2 | Pantaloni | `pants_*` | tint fisso `avatar.pants_color` |
| 3 | Scarpe | `shoes_*` | tint = `palette.upper` della scarpa più preziosa |
| 4 | Felpa | `hoodie_*` | tint `avatar.outfit_colors[outfit]` |
| 5 | Capelli | `hair_{stile}_*` | tint `avatar.hair_colors[hairColor]` |

- **Animazioni**: idle (4 frame, 6 fps) e walk (6 frame, 10 fps), in 3 direzioni.
- **Direzione**: gli sheet `side` guardano a **destra**; la sinistra si ottiene con `flipX`.
- **Origine**: `(0.5, 0.75)`, così il punto di ancoraggio cade sui piedi.
- **Tint**: gli overlay sono in scala di grigi con contorno nero. `setTint` di Phaser moltiplica i colori, quindi le ombre restano e il contorno resta nero. `PREVIEW_avatar.png` è stato generato simulando esattamente questo comportamento.
- **Solo WebGL**: in Phaser 3 il tint funziona solo col renderer WebGL. Col renderer Canvas gli overlay restano grigi. Nella config del gioco va quindi `type: Phaser.WEBGL`, non `AUTO`: tutti i browser target supportano WebGL.

### Caricamento (scena Boot)

```ts
// scena Preload: this.load.json('manifest', 'assets/manifest.json');
const m = this.cache.json.get('manifest');
for (const s of m.spritesheets) this.load.spritesheet(s.key, s.path, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
for (const i of m.images) this.load.image(i.key, i.path);
for (const a of m.atlases) this.load.atlas(a.key, a.image, a.json);
for (const t of m.tilemaps) this.load.tilemapTiledJSON(t.key, t.path);
```

Dopo il load, un'animazione per ogni texture dell'avatar, con chiave = chiave della texture:

```ts
export function registerAvatarAnims(scene: Phaser.Scene) {
  const { animations } = gameConfig.avatar;
  for (const tex of scene.textures.getTextureKeys()) {
    const match = /^(?:skin_\d|pants|shoes|hoodie|hair_[a-z]+)_(idle|walk)_(?:down|side|up)$/.exec(tex);
    if (!match) continue;   // ancorata: 'shoes' da solo è l'atlas delle icone, non un layer
    const anim = match[1] as 'idle' | 'walk';
    scene.anims.create({ key: tex, frames: scene.anims.generateFrameNumbers(tex),
      frameRate: animations[anim].frameRate, repeat: -1 });
  }
}
```

### Compositore

```ts
export type Dir = 'down' | 'up' | 'left' | 'right';
export interface AvatarLook { skin: number; hair: number; hairColor: number; outfit: number; shoesColor?: string }
const hex = (h: string) => parseInt(h.replace('#', ''), 16);

export class AvatarSprite extends Phaser.GameObjects.Container {
  private parts: { sprite: Phaser.GameObjects.Sprite; prefix: string }[] = [];
  private cur = { anim: '', dir: '' };

  constructor(scene: Phaser.Scene, x: number, y: number, look: AvatarLook) {
    super(scene, x, y);
    const a = gameConfig.avatar;
    const layers: [string, string | null][] = [
      [`skin_${look.skin}`, null],
      ['pants', a.pants_color],
      ['shoes', look.shoesColor ?? a.shoes_default_color],
      ['hoodie', a.outfit_colors[look.outfit]],
      [`hair_${a.hair_styles[look.hair]}`, a.hair_colors[look.hairColor]],
    ];
    for (const [prefix, tint] of layers) {
      const s = scene.add.sprite(0, 0, `${prefix}_idle_down`).setOrigin(a.frame.origin_x, a.frame.origin_y);
      if (tint) s.setTint(hex(tint));
      this.add(s);
      this.parts.push({ sprite: s, prefix });
    }
    scene.add.existing(this);
    this.animate('idle', 'down');
  }

  animate(anim: 'idle' | 'walk', dir: Dir) {
    if (anim === this.cur.anim && dir === this.cur.dir) return this;
    this.cur = { anim, dir };
    const sheetDir = dir === 'left' || dir === 'right' ? 'side' : dir;
    for (const { sprite, prefix } of this.parts) {
      sprite.setFlipX(dir === 'left').play(`${prefix}_${anim}_${sheetDir}`);
    }
    return this;
  }

  setShoesColor(color: string) {
    this.parts.find(p => p.prefix === 'shoes')?.sprite.setTint(hex(color));
  }
}
```

Con 100 giocatori sono al massimo 500 sprite, e se ne disegnano solo quelli nel raggio visibile. Per Phaser non è un problema.

### Stato: placeholder

I layer sono generati da `tools/assets/gen_avatar.py` con euristiche sulle righe del corpo: la testa, il busto, le gambe e gli ultimi 2 pixel di ogni colonna per le scarpe. Funzionano e si leggono bene, ma se c'è tempo vanno ritoccati in Aseprite. I difetti noti:
- la nuca sotto il cappellino, vista di lato, resta color pelle;
- le mani sono sempre scoperte;
- le ciocche dei capelli lunghi sono squadrate.

Per rigenerare tutto dopo un cambio dei toni di pelle in config:

```bash
python3 tools/assets/gen_avatar.py "<pack>/Entities/Characters/Body_A/Animations" apps/client/public/assets/avatar data/game_config.json
python3 tools/assets/preview_avatar.py apps/client/public/assets/avatar apps/client/public/assets/PREVIEW_avatar.png
```

## 4. Icone delle scarpe

- 29 icone 32×32, una per item, generate in modo parametrico da silhouette + palette (`tools/assets/gen_shoes.py`).
- **Nessun segno distintivo reale**: i pannelli sono generici (contrafforte del tallone, pannelli laterali, punta, lacci). L'unico monogramma è la "U" di **Upthere One**, che è nostra.
- **I falsi usano la stessa icona dell'originale**: è voluto, solo il passaporto li distingue.
- In gioco l'icona si usa dall'atlas: `this.add.image(x, y, 'shoes', itemId)`. Nelle liste HTML (bacheca, inventario, passaporto) si usa `items/{itemId}.png` con `image-rendering: pixelated`.
- Per rigenerarle dopo una modifica a `game_items.json` (palette, nuovi item):
  ```bash
  python3 tools/assets/gen_shoes.py data/game_items.json apps/client/public/assets/shoes
  ```

## 5. NPC

| NPC | Sprite | Note |
|---|---|---|
| Banca Upthere | `npc_tavern_b_idle` (64) | |
| Il Negozio | `npc_tavern_a_idle` (64) | |
| Tony Affari | `npc_rogue_idle` (32) | Frame da 32 px: origine Y = 1.0 (vedi manifest) |
| Dott.ssa Hash | `npc_wizard_idle` (32) | Frame da 32 px: origine Y = 1.0 |
| Enoteca DOP Digital | `npc_peasant_a_idle` (64) | |
| MC Suola | avatar (pelle 3, cappellino giallo, felpa nera, scarpe rosse) | Costruito con `AvatarSprite` |
| Bot | avatar con tratti casuali (seed = player_id) | Hanno lo stesso aspetto dei giocatori |

Gli sheet degli NPC del pack sono in una sola direzione e restano fermi: si gira solo `flipX` verso il giocatore quando parla con loro. Tutte le origini sono in `manifest.json` (`originY` calcolato sul piede del primo frame).

## 6. Mappa del villaggio (Tiled, tile da 16 px)

| Elemento | Asset |
|---|---|
| Prato e terreno | `tiles/floors.png`: blocchi a croce per l'autotile di erba, ciottolato e terra (da configurare come Terrain/Wang set in Tiled) |
| Piazza | ciottolato da `tiles/floors.png` |
| Fontana al centro della piazza | `tiles/water.png` |
| Edifici (Banca, Negozio, Enoteca) | `buildings/walls.png` (legno, intonaco, vetrate) + `buildings/roofs.png` |
| Porte, finestre, panche, staccionate | `buildings/props.png` |
| Bancarella di Tony, bacheca del mercato | banchi e scaffali in legno da `props/farm.png` |
| Vetrina del Negozio, botti dell'Enoteca | `props/furniture.png` |
| Verde | `props/vegetation.png`, `props/trees/` |
| Ombre | `buildings/shadows.png`, `props/shadows.png` |

**Brand.** I tetti verde acqua del pack sono già ricolorati con la palette Upthere in `buildings/roofs_upthere.png`, che è la versione caricata dal manifest. La rampa usata è accent-900 → primary → primary-700 → accent (confronto in `PREVIEW_roofs.png`); le vetrate restano azzurre. Per rigenerare: `tools/assets/recolor_brand.py` (variante `plum`; `mauve` è l'alternativa più chiara). Le insegne sono pronte in `brand/pixel/` (vedi §7).

### Com'è fatta (M1)

La mappa è `maps/village.json`, 30×40 tile, già nel manifest (`tilemaps`). La genera `tools/assets/gen_village.py`, che produce anche `PREVIEW_village.png`:

```bash
python3 tools/assets/gen_village.py apps/client/public/assets && python3 tools/assets/build_manifest.py
```

| Livello | Tipo | Contenuto |
|---|---|---|
| `ground`, `cobble`, `grass` | tile | terra sotto, ciottolato della piazza (bucato sul palco), erba ai bordi (bucata sulla piazza) |
| `buildings` | tile | facciate (intonaco con zoccolo in mattoni, `walls.png` righe 12–14) e fontana |
| `roofs` | tile | tetti Upthere: disegnati **sopra** i personaggi |
| `decor` | oggetti | prop come rettangoli con proprietà `texture` (chiave del manifest), `sx`, `sy` (ritaglio nello sheet) e `above` (insegne sopra i personaggi) |
| `places` | punti | `spawn`, NPC (`name` = zona di `npcs.json`, `sprite`), `bacheca`; `approach = "tx,ty"` è la cella dove l'avatar si ferma per parlare |
| `colliders` | rettangoli | celle non calpestabili: da qui server e client ricavano la stessa griglia (`parseVillage` in `shared`) |

I tileset hanno come `name` la chiave del manifest, così il client li aggancia direttamente.

Si può ritoccare in Tiled aprendo `village.json`. Attenzione: rilanciando lo script, le modifiche fatte a mano si perdono. Si sceglie una strada sola: o lo script o Tiled. Dopo una modifica vanno rifatti `npm test -w @sp/shared` (verifica che ogni punto di interazione sia raggiungibile dallo spawn) e il riavvio del server, che legge la mappa all'avvio.

## 7. Brand Upthere

I colori stanno in `game_config.json` → `brand.colors` e vanno esposti come variabili CSS per l'overlay HTML:

```css
:root {
  --up-primary: #490D50;      /* fondi principali, HUD, bottone primario */
  --up-primary-700: #6F305B;  /* hover/pressed, pannelli secondari */
  --up-accent: #B26998;       /* bordi, badge, decorazioni */
  --up-accent-400: #E292C4;   /* bottone secondario, evidenziazioni */
  --up-accent-900: #3A012D;   /* fondo più scuro (reveal, modali) */
  --up-warn: #dc393c;         /* errori, ⚠️, timbro FALSA */
}
```

Contrasti WCAG, calcolati:

| Combinazione | Rapporto | Uso |
|---|---|---|
| Bianco su primary | 14,4:1 | ✅ testo e bottone primario |
| Bianco su primary-700 | 9,3:1 | ✅ |
| Bianco su accent-900 | 17,2:1 | ✅ |
| Primary su accent-400 | 6,3:1 | ✅ bottone secondario |
| Bianco su accent | 3,9:1 | ⚠️ solo testo grande/bold o decorazione |
| Bianco su warn | 4,47:1 | ⚠️ solo testo bold ≥ 14 px; altrimenti warn come bordo/icona su fondo chiaro |
| Accent su primary | 3,7:1 | ⚠️ solo decorazione, mai testo piccolo |

**Font.** Nell'overlay HTML si importa `assets/brand/fonts.css` e si usano le variabili:
- `--up-font-display` (Chillax): titoli, CTA, nome della scarpa nel passaporto. 600 per i titoli, 500 per i sottotitoli.
- `--up-font-body` (DM Sans): tutto il resto.

Se serve testo dentro il canvas Phaser (i nickname sopra gli avatar), si crea solo a font caricati, altrimenti Phaser lo disegna col font di fallback e non lo aggiorna più. `document.fonts.ready` da solo non basta: un `@font-face` che nessun elemento del DOM usa non viene scaricato. Va richiesto esplicitamente, per esempio `await document.fonts.load('600 16px Chillax')` (vedi `apps/client/src/main.ts`).

**Logo.**
- Landing, HUD e reveal usano l'SVG: `logo_upthere_white.svg` su fondi primary o accent-900, `logo_upthere_primary.svg` su fondi chiari.
- Dentro il mondo di gioco si usa la versione pixel: `brand/pixel/logo_pixel_24.png`, oppure la 32.
- Il logo è stato preso dall'header di upthere.it: è lo stesso del sito.

**Insegne degli edifici** (`brand/pixel/sign_*.png`, già nel manifest con chiave `brand_pixel_sign_*`):

| Insegna | Edificio |
|---|---|
| `sign_banca` | Banca Upthere, con il logo |
| `sign_negozio` | Il Negozio |
| `sign_enoteca` | Enoteca DOP Digital |
| `sign_bacheca` | Bacheca del mercato |
| `sign_autenticatore` | Dott.ssa Hash ("VERIFICA PASSAPORTI") |
| `sign_palco` | Palco di MC Suola |

- Larghezza multipla di 16 px, così si allineano ai tile.
- Il testo usa un font bitmap 5×7 disegnato apposta: Chillax a 7 px diventava illeggibile.
- Per nuove insegne: `tools/assets/gen_signs.py` (serve `pip install cairosvg`).

Dove compare il brand in gioco:
- tetti degli edifici e insegne;
- logo nella landing, nell'HUD e nel reveal;
- **Upthere One** (tomaia primary, monogramma accent-400);
- un colore della felpa (accent);
- HUD e pannelli;
- schermata reveal (fondo accent-900, CTA "Scopri DOP Digital" in accent-400 con testo primary).

## 8. Peso al primo caricamento


| Gruppo | KB |
|---|---|
| Avatar: corpo (5 toni × 6 sheet) | 31 |
| Avatar: overlay | 13 |
| NPC | 10 |
| Tile | 34 |
| Edifici (tetti Upthere al posto degli originali) | 43 |
| Prop (alberi, vegetazione, mobili) | 183 |
| Atlas scarpe | 10 |
| Mappa del villaggio (`village.json`, 4 KB con gzip) | 45 |
| Insegne e logo pixel | ~4 |
| **Totale (manifest Phaser)** | **~372** |
| Font (CSS, fuori dal manifest: Chillax 2 pesi + DM Sans latin) | ~88 |

Con i font si arriva a circa 460 KB di file. A questi si aggiunge il bundle JS: Phaser 3 pesa circa 1,2 MB minificato e 345 KB con gzip (vedi decisione D9 in `PLAN.md`). Per i suoni resta margine solo se il budget di 1 MB si misura sul trasferito compresso. Il file DM Sans latin-ext (18 KB) si scarica solo se serve, grazie a `unicode-range`. Se serve risparmiare, il primo candidato è `props/furniture.png`: si può ritagliare solo la parte che si usa.
