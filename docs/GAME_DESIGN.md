# GAME_DESIGN — Sneaker Passport

Tutti i numeri citati qui stanno in `data/game_config.json`, che è la sorgente di verità. Se un numero qui e in config non coincidono, vale la config.

## 1. Obiettivo

Contesto: intervento di 10 minuti a una conferenza per studenti delle superiori, il **23/10/2026**, con circa **100 ragazzi**.

Il gioco deve:
- catturare l'attenzione entro 45 secondi dalla scansione del QR;
- far vivere due idee senza bisogno di spiegarle a parole:
  1. **la tracciabilità della proprietà protegge dai falsi**;
  2. **la storia di chi ha posseduto un oggetto cambia il suo valore percepito**;
- portare a **DOP Digital** (https://dopdigital.it/), che fa la stessa cosa con le bottiglie di vino.

Il gioco funziona **in autonomia** e resta **aperto** dopo la conferenza: nessuna data di chiusura, nessun drop giornaliero.

## 2. Flusso del giocatore

1. **QR → landing `/`**: fondo primary, logo Upthere bianco (SVG), titolo in Chillax e il bottone "Entra nel mercato" (accent-400 con testo primary). Sotto, un link piccolo: "Hai già giocato? Inserisci il codice".
2. **device_id**: il client genera `crypto.randomUUID()`, lo salva in localStorage e lo manda nell'handshake socket. Il server crea il giocatore con un nickname generato (es. `Lince42`), 100 monete e una scarpa base regalata.
3. **Avatar**: tre scelte in una sola schermata, con anteprima live, poi "Entra".
4. **Villaggio**: parte la **prima run** di 5 minuti (§5).
5. **Reveal** a fine prima run (§12). Dopo il reveal il mondo resta aperto e si continua a giocare senza timer.

Obiettivo di tempo: dalla scansione al villaggio in meno di 45 secondi.

## 3. Avatar

Tre tratti, scelti con swatch o frecce in una sola schermata. Niente testo libero.

| Tratto | Opzioni |
|---|---|
| Pelle | 5 toni (`avatar.skin_tones`) |
| Capelli | 3 stili (corti, lunghi, cappellino) × 6 colori (`avatar.hair_styles`, `avatar.hair_colors`) |
| Felpa | 8 colori (`avatar.outfit_colors`) |

L'avatar è composto da layer sovrapposti, tutti in frame da 64×64. I dettagli e il codice Phaser sono in `docs/ASSETS.md`.
- **Base**: il corpo di Pixel Crawler, ricolorato nei 5 toni di pelle (palette swap, occhi intatti).
- **Overlay**: pantaloni, scarpe, felpa e capelli in scala di grigi, tinti a runtime.
- **Animazioni**: idle (4 frame) e walk (6 frame), in 3 direzioni. La direzione sinistra è il flipX del lato destro.
- **Scarpe ai piedi**: prendono il colore `upper` della scarpa più preziosa posseduta, così si vede chi ha l'armadio migliore.

I layer attuali sono placeholder generati da script (`tools/assets/gen_avatar.py`), da ritoccare in Aseprite quando c'è tempo.

## 4. Il villaggio

Mappa piccola, circa 2 schermate di telefono in verticale, disegnata con una tilemap Tiled.

```
┌─────────────────────────────────────────────┐
│  🏦 Banca Upthere          📋 Bacheca         │
│     (drop)                    mercato         │
│                                              │
│  🏪 Negozio      ⛲ Piazza      🎤 MC Suola    │
│                   (spawn)       (Leggenda)    │
│                                              │
│  🧥 Bancarella   🔍 Dott.ssa    🍷 Enoteca     │
│     Tony Affari     Hash           DOP Digital│
└─────────────────────────────────────────────┘
```

- **Movimento**: tap su un punto e l'avatar ci cammina (pathfinding semplice sulla griglia).
- **NPC ed edifici**: con un tap l'avatar cammina fino all'NPC e il pannello si apre all'arrivo. Così il gioco resta un gioco, ma senza far perdere tempo.
- **Altri giocatori**: appaiono come avatar con il nickname sopra; si vedono solo quelli entro `world.visible_radius_px`. Si possono mandare **emote** (👋 🔥 😂 👟 💸 🤝). Niente chat libera.

## 5. La prima run (5 minuti)

Gli eventi sono scanditi da `first_run.beats`. Ogni beat è un tooltip o un banner che non blocca il gioco e si chiude con un tap.

| t | Beat | Cosa vede il giocatore |
|---|---|---|
| 0:00 | `welcome` | "Benvenuto al villaggio! Hai 100 monete e il tuo primo paio." |
| 0:15 | `tooltip_move` | "Tocca dove vuoi andare." |
| 0:30 | `tooltip_passport` | "Apri il passaporto della tua scarpa: per ora c'è solo il tuo nome." |
| 0:45 | `objective` | "Obiettivo: fai crescere del 30% il valore del tuo armadio prima che chiuda il mercato." |
| 1:30 | `hint_stall` | "Da Tony Affari i prezzi sono bassi. Troppo bassi?" |
| 2:30 | `hint_legend` | "MC Suola può far entrare la tua scarpa nella storia." |
| 3:30 | `hint_market` | "Guarda la bacheca: qualcuno svende?" |
| 4:30 | `closing_warning` | "Il mercato della tua prima giornata chiude tra 30 secondi." |
| 5:00 | `reveal` | Schermata reveal (§12) |

Nel frattempo partono anche i **drop di mondo** ogni 3 minuti (§11), quindi in una run se ne vedono 1 o 2.

**Obiettivo della run**: valore armadio finale ≥ valore iniziale × `first_run.objective.multiplier` (1,3, da tarare in playtest).
- Valore armadio = monete + somma dei valori percepiti delle scarpe possedute.
- Chi lo raggiunge riceve il badge "Mercante" nel reveal. Chi non lo raggiunge non perde nulla.

Come si fa crescere il valore (nessuna di queste strade viene spiegata a parole, si scoprono giocando):
- comprando ai **drop**: la scarpa ha Upthere come primo proprietario e vale subito +25%;
- facendo indossare una scarpa a **MC Suola**: +40%;
- comprando in **bacheca** annunci sottoprezzo di altri giocatori o dei bot;
- **evitando i falsi** di Tony Affari.

## 6. Mondo aperto

Dopo la prima run il timer sparisce e restano tutte le meccaniche: negozio, bacheca, drop ogni 3', Tony Affari, Dott.ssa Hash, MC Suola, classifica.

Chi torna giorni dopo ritrova tutto: con lo stesso telefono basta riaprire il link, da un altro dispositivo serve il codice di recupero (§14).

## 7. Il passaporto digitale

È il cuore del gioco. Si apre da ogni scarpa: nel proprio inventario, in un annuncio della bacheca o in un'offerta di Tony Affari. **Si può aprire prima di comprare**, ed è proprio questa la lezione.

**Intestazione**
- Sprite, nome, colorway.
- Numero di serie: "n. 3 di 4" per i drop, "n. 128" per le scarpe del negozio.
- Valore percepito.
- Stato:
  - ✅ **Autentica**, se verificata;
  - ❌ **Falsa**, se smascherata;
  - nessun badge, se non è mai stata verificata.

**Timeline**: un anello per ogni evento, dal più vecchio al più recente.

| Evento | Testo |
|---|---|
| `MINT` (negozio, `minted_by = 2`) | "Prodotta dal Negozio del villaggio per {nickname}" (prezzo 0 = "Regalo di benvenuto per {nickname}") |
| `MINT` (drop, `minted_by = 1`) | "Creata da Upthere per {nickname} — drop n. X di Y" |
| `FAKE_MINT` | "Origine sconosciuta" ⚠️ |
| `TRANSFER` | "Venduta a {nickname} per {price} monete" |
| `LEGEND_IN` / `LEGEND_OUT` | "Indossata da MC Suola" (i due eventi si mostrano come un solo anello) |

Ogni anello porta un badge di certificazione:

| Stato | Badge |
|---|---|
| `PENDING` / `SENDING` | ⏳ in certificazione… |
| `CONFIRMED` | ✅ certificato on-chain (tap → explorer della testnet) |
| `FAILED` | ⚠️ certificazione non riuscita (raro; il worker ritenta) |
| `NONE` (FAKE_MINT) | ⚠️ origine non certificata |

**Piè di pagina**: "Ogni anello ha un'impronta (hash) che dipende da quello prima. Se qualcuno cambia un passaggio, la catena si rompe."

## 8. Valore percepito

È una funzione unica in `packages/shared` (`perceivedValue`), usata dal server (autoritativo) e dal client (solo per la visualizzazione).

```ts
// cfg = game_config.valuation
export function perceivedValue(a: AssetView, baseValue: number, cfg: ValuationCfg): number {
  if (a.isFake && a.fakeRevealed) return cfg.fake_value_after_auth;          // 2

  let mult = 1;
  mult += cfg.legend_bonus_per_wear * Math.min(a.legendCount, cfg.legend_max_counted);
  if (a.mintedByUpthere && !a.originGap) mult += cfg.upthere_mint_bonus;

  const extraOwners = Math.max(0, a.humanOwnersCount - cfg.flip_free_owners);
  mult *= Math.max(cfg.flip_floor, 1 - cfg.flip_penalty_per_owner * extraOwners);

  if (a.originGap) mult *= cfg.gap_multiplier;                               // primo evento = FAKE_MINT

  return Math.max(cfg.min_value, Math.round(baseValue * mult));
}
```

Esempio con **Salto 4 Club** (base 84):

| Storia | Valore |
|---|---|
| Comprata al drop (Upthere primo proprietario) | 84 × 1,25 = **105** |
| + indossata una volta da MC Suola | 84 × 1,65 = **139** |
| …poi passata per 8 proprietari umani (3 oltre la soglia, −15%) | 139 × 0,85 = **118** |
| Falso di Tony Affari, non ancora verificato | 84 × 0,40 = **34** |
| Falso smascherato dalla Dott.ssa Hash | **2** |

Lezioni implicite:
- una storia certificata e "famosa" aumenta il valore;
- troppi passaggi in poco tempo lo abbassano;
- un'origine non certificata lo distrugge.

## 9. Falsi: Tony Affari e Dott.ssa Hash

**Tony Affari (bancarella)**
- Tiene in vendita al massimo `economy.stall.max_fakes_on_sale` (3) falsi di item hype, limited o Upthere One, a `price_pct_of_base` (50%) del valore base.
- Rifornisce ogni `restock_sec` (90 s).
- **Lo sprite è identico all'originale.** Solo il passaporto è diverso: primo anello `FAKE_MINT`, "Origine sconosciuta ⚠️", valore mostrato al 40% del base.
- Chi apre il passaporto prima di comprare se ne accorge. Chi non lo apre cade nella trappola.

**Dott.ssa Hash (autenticatore)**
- Per `auth_cost` (3 monete) verifica una scarpa del giocatore.
- Se è autentica: badge ✅ "Autentica" e la battuta `genuine`.
- Se è falsa: `fake_revealed = 1`, timbro ❌ sullo sprite in UI, valore 2, battuta `fake`.

I falsi si possono rivendere in bacheca, come succede nel mondo reale. Il passaporto però li tradisce: ⚠️ se non sono ancora stati verificati, ❌ se sono già stati smascherati.

## 10. MC Suola (la Leggenda)

- Costo: `economy.legend.cost` (15 monete).
- La scarpa resta "in prestito" per `wear_duration_sec` (10 s). In quel tempo è bloccata, non vendibile, e mostra l'etichetta "in prestito a MC Suola".
- Nel passaporto si aggiungono due eventi certificati, `LEGEND_IN` e `LEGEND_OUT`, e `legend_count` sale di 1.
- È un **prestito**, non una vendita: la scarpa resta del giocatore (nell'armadio con l'etichetta "In prestito a MC Suola"), la catena registra la custodia.
- Il bonus +40% conta al massimo `legend_max_counted` (2) volte per scarpa.
- Cooldown per giocatore: `cooldown_sec` (60 s).
- La battuta chiave di MC Suola: "Non conta che le ho messe. Conta che si può dimostrare."

## 11. Drop di mondo

- **Frequenza**: ogni `drops.interval_sec` (180 s) su un orologio di mondo, uguale per tutti.
- **Annuncio**: banner e suono, per esempio "Drop alla Banca Upthere: 4 paia di Shiro 66 a 64 monete. Hai 60 secondi."
- **Item**: estratto a caso tra i tier `hype`, `limited` e `upthere`, pesato con `drop_weight`.
- **Quantità**: `quantity` (4). Chi arriva prima compra, al massimo 1 paio per giocatore per drop.
- **Prezzo**: `base_value`, pagato alla tesoreria.
- **Mint**: la scarpa viene coniata dalla **Banca Upthere** (`minted_by = 1`) direttamente al compratore. Nel passaporto il primo anello è "Creata da Upthere", quindi vale subito +25%.
- **Numero di serie**: "n. X di 4".

## 12. Reveal di fine prima run

È il momento da mostrare anche sul palco. Una schermata scrollabile:

1. **"La tua giornata al mercato"**: valore armadio iniziale → finale, badge "Mercante" se l'obiettivo è raggiunto, numero di scambi, falsi evitati o presi.
2. **Il passaporto della tua scarpa più preziosa**, con timeline completa e badge on-chain.
3. **Il ponte**: "Questa scarpa ha avuto {N} proprietari. Ogni passaggio è certificato su blockchain. DOP Digital fa la stessa cosa con le bottiglie di vino: inquadri il QR e vedi tutta la storia, dal vigneto al tavolo." Bottone **"Scopri DOP Digital"** → https://dopdigital.it/
4. **Codice di recupero**, grande, con "Salvalo: ti serve per rientrare da un altro telefono".
5. Bottoni: **"Continua a giocare"** e **"Condividi"** (§16, tagliabile).

## 13. Classifica

- Top 10 per valore armadio (`leaderboard`), con nickname e avatar.
- Si apre da un'icona nell'HUD.
- È sempre visibile anche la propria posizione.

## 14. Codice di recupero

- 6 caratteri dall'alfabeto senza caratteri ambigui (`player.recovery_code`), mostrati come `XXX-XXX`.
- Si genera alla creazione del giocatore e si mostra nel reveal e nel profilo.
- Nel DB si salva solo l'hash SHA-256.
- Inserendo il codice sulla landing, il `device_id` corrente viene associato al giocatore esistente. Il vecchio device resta valido.

## 15. Enoteca DOP Digital

- È un NPC con una bottiglia. Al tap si apre **la stessa UI del passaporto**, ma per una bottiglia demo: vigneto → cantina → etichetta elettronica → distributore → enoteca → tu.
- Tutti gli anelli sono ✅ ed è etichettata in modo esplicito **"ESEMPIO DIMOSTRATIVO"**. I dati statici sono in `data/npcs.json`.
- In fondo, il bottone "Scopri DOP Digital".
- La bottiglia non si può comprare né scambiare.

## 16. Card condivisibile (tagliabile)

- PNG 1080×1920 generato su canvas lato client e condiviso con la Web Share API; se l'API non c'è, si scarica il file.
- Contenuto: avatar, scarpa più preziosa, "{N} proprietari · certificata on-chain", link alla **pagina pubblica del passaporto** `/p/{public_id}` (sola lettura).
- **Mai un link diretto all'explorer della testnet**: le testnet vengono resettate e il link morirebbe.

## 17. Schermo per il palco (tagliabile)

Pagina `/schermo` per il proiettore. Mostra un ticker live degli eventi appena certificati ("Volpe17 ha comprato Shiro 66 n. 2 di 4 ✅") e la classifica. Serve a far vedere a tutta la sala che la catena si muove davvero.

## 18. Testi chiave

| Chiave | Testo |
|---|---|
| landing.title | Ogni scarpa ha una storia. La tua inizia adesso. |
| landing.cta | Entra nel mercato |
| landing.recover | Hai già giocato? Inserisci il codice |
| avatar.title | Crea il tuo personaggio |
| avatar.labels | Pelle · Capelli · Felpa |
| avatar.cta | Entra |
| hud.coins | {n} monete |
| hud.wardrobe | Armadio: {n} |
| passport.footer | Ogni anello ha un'impronta (hash) che dipende da quello prima. Se qualcuno cambia un passaggio, la catena si rompe. |
| cert.pending | ⏳ in certificazione… |
| cert.confirmed | ✅ certificato on-chain |
| cert.none | ⚠️ origine non certificata |
| auth.genuine | ✅ Autentica. Ogni passaggio torna, dal primo all'ultimo. |
| auth.fake | ❌ Falsa. Il passaporto non parte da un produttore certificato. |
| error.NO_FUNDS | Non hai abbastanza monete. |
| error.NOT_OWNER | Questa scarpa non è più tua. |
| error.LISTING_CLOSED | Troppo tardi: venduta. |
| error.DROP_SOLDOUT | Finite! Al prossimo drop. |
| error.INVENTORY_FULL | Armadio pieno: vendi qualcosa prima. |
| error.BUSY | Il mercato è affollato, riprova. |
| reveal.bridge | Questa scarpa ha avuto {N} proprietari. Ogni passaggio è certificato su blockchain. DOP Digital fa la stessa cosa con le bottiglie di vino: inquadri il QR e vedi tutta la storia, dal vigneto al tavolo. |
| reveal.cta_dop | Scopri DOP Digital |
| reveal.code | Il tuo codice: {CODE}. Salvalo: ti serve per rientrare da un altro telefono. |
| reveal.continue | Continua a giocare |

## 19. Fuori scope

- Chat libera.
- Login, email, social.
- Pagamenti reali.
- NFT o wallet personali dei giocatori.
- Scarpe con marchi reali.
- Personalizzazione delle scarpe.
- Scambi diretti tra giocatori senza passare dalla bacheca.
- Regia dal palco.
- Drop giornalieri o chiusura del gioco.
