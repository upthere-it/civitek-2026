# PLAN — dal 14 al 23 ottobre 2026

Lo sviluppo è di **Claude Code**; review, test su telefoni e asset sono di **Simone**. Si lavora una milestone per sessione e alla fine si aggiornano checkbox e note. Il weekend 17–18/10 è buffer.

## Milestone

### M0 — Fondamenta (mer 14/10)
- [ ] Monorepo `apps/server`, `apps/client`, `packages/shared`, script npm (vedi CLAUDE.md)
- [ ] `sql/001–003`: schema, `fn_setting`, procedure interne, `sp_listing_buy`
- [ ] `tools/seed-from-json.ts`: `items`, `game_settings`, giocatori di sistema, `GRANT` della tesoreria
- [ ] `packages/shared/valuation.ts` con test sugli esempi di GAME_DESIGN §8
- [ ] `economy.invariants.spec` (I1–I6) verde su DB di test
- [ ] `ChainNotary` + `MockNotary` + `ChainWorker` funzionanti (gli eventi passano a `CONFIRMED`)

**Accettazione**: `npm test` verde; un acquisto da bacheca simulato via test produce ledger, catena hash e certificazione mock corretti.

### M1 — Entrare nel villaggio (gio 15/10)
- [ ] Landing, `device_id`, handshake, `sp_player_get_or_create` (nickname, 100 monete, scarpa regalo)
- [ ] Boot che carica tutto da `apps/client/public/assets/manifest.json`
- [ ] Schermata avatar (3 tratti) con il compositore a layer descritto in `docs/ASSETS.md`
- [ ] Tilemap del villaggio in Tiled (tile da 16 px) con gli asset di `vendor/pixel-crawler`, secondo la mappa di GAME_DESIGN §4
- [ ] Scena Village: tap-to-move, camera, presenza degli altri giocatori nel raggio, emote
- [ ] HUD: monete, valore armadio

**Accettazione**: 3 telefoni veri nel villaggio contemporaneamente si vedono e si mandano emote; dal QR al villaggio in meno di 45 s.

### M2 — Mercato e passaporto (ven 16/10)
- [ ] Negozio (`sp_shop_buy`), inventario
- [ ] Bacheca: crea, annulla, compra annuncio
- [ ] UI passaporto completa (timeline, badge certificazione, aggiornamento live su `asset.certified`)
- [ ] Mappa errori SP → messaggi italiani (GAME_DESIGN §18)

**Accettazione**: due giocatori si scambiano una scarpa; il passaporto mostra il passaggio ⏳ → ✅ in pochi secondi.

### M3 — Le meccaniche del messaggio (lun 19/10)
- [ ] Tony Affari: restock dei falsi, acquisto, passaporto con ⚠️
- [ ] Dott.ssa Hash: verifica, badge ✅ / timbro ❌, valore 2
- [ ] MC Suola: prestito di 10 s, `LEGEND_IN` / `LEGEND_OUT`, bonus, cooldown
- [ ] Drop di mondo ogni 3' con annuncio a tutti
- [ ] Bot di mercato con attività in funzione degli umani online

**Accettazione**: un giocatore da solo, senza altri umani online, riesce a fare tutte le azioni del gioco grazie ai bot.

### M4 — Prima run e reveal (mar 20/10)
- [ ] Timer della prima run e beat (`run.beat`), obiettivo, badge "Mercante"
- [ ] Schermata reveal completa, con codice di recupero e CTA verso DOP Digital
- [ ] Recupero da un altro device (`sp_player_recover`)
- [ ] Enoteca DOP Digital con la bottiglia demo
- [ ] Classifica
- [ ] Implementazione testnet di `ChainNotary` (se D1 è chiusa), altrimenti si resta su Mock

**Accettazione**: run completa di 5 minuti su telefono vero, dal QR al reveal, senza intoppi.

### M5 — Feature freeze e collaudo (mer 21/10)
- [ ] **Feature freeze**: da qui solo bugfix
- [ ] Test su Safari iOS, Chrome Android e browser in-app della fotocamera (iOS e Android)
- [ ] `npm run loadtest`: 150 client socket.io per 10 minuti, nessun errore, p95 delle azioni < 300 ms
- [ ] `npm run sim:economy`: taratura di `first_run.objective.multiplier`, invarianti verdi
- [ ] Pagina `/privacy`, job di anonimizzazione
- [ ] Brand Upthere in UI: `fonts.css` + variabili colore, logo SVG in landing/HUD/reveal, insegne sugli edifici nella tilemap
- [ ] Crediti in `/privacy`: Pixel Crawler (Anokolisa), Chillax (ITF/Fontshare), DM Sans (OFL)
- [ ] (facoltativo) ritocco in Aseprite dei layer avatar e delle icone delle scarpe

### M6 — Messa in produzione (gio 22/10)
- [ ] Deploy (PM2 fork, nginx, HTTPS) sul dominio definitivo (D3)
- [ ] Reset del DB di produzione con script SQL a mano (non via MCP) + seed
- [ ] Faucet della testnet ricaricato, se D1 è attiva
- [ ] QR definitivo stampato e provato
- [ ] Prova generale con il team: 5+ telefoni, run completa

### Giorno della conferenza (ven 23/10)
- [ ] Health check 1 ora prima (`/api/health`): DB, worker chain, saldo del faucet
- [ ] `pm2 logs` aperto su un portatile
- [ ] Hotspot 4G di riserva
- [ ] Pagina `/schermo` pronta sul proiettore (se non tagliata)

## Ordine di taglio se si va lunghi

1. Schermo per il palco (`/schermo`)
2. Card condivisibile e pagina pubblica `/p/:publicId`
3. Drop ogni 3' (i drop restano, ma solo a intervalli più lunghi o all'apertura)
4. Bot "intelligenti" → bot con ordini fissi

**Non si tagliano mai**: passaporto, falsi + Dott.ssa Hash, MC Suola, certificazione (anche solo mock), reveal con il ponte verso DOP Digital.

## Decisioni aperte

| # | Decisione | Chi | Entro | Default se non decisa |
|---|---|---|---|---|
| D1 | Testnet e metodo di notarizzazione (Commercio.network testnet? endpoint, faucet, tipo di messaggio) | Simone | 15/10 | `MockNotary` |
| ~~D2~~ | ✅ **Chiusa (13/10)**: palette, logo (SVG dal sito), font Chillax + DM Sans self-hosted, insegne pixel. Tutto in `assets/brand/` | Simone | — | — |
| D3 | Dominio e hosting, certificato TLS | Simone | 19/10 | — (bloccante per M6) |
| ~~D4~~ | ✅ **Chiusa (13/10)**: Pixel Crawler Free Pack (Anokolisa), uso commerciale ammesso. Avatar e icone delle scarpe sono placeholder generati; il ritocco in Aseprite è facoltativo | Simone | — | — |
| D5 | Testo della pagina privacy (revisione interna) | Simone | 20/10 | testo bozza di Claude Code |
| D6 | Nomi definitivi degli NPC (proposte in `npcs.json`) | Simone | 19/10 | nomi proposti |

## Note di sessione

_(Claude Code: aggiungi qui una riga per sessione con data, milestone, cosa è stato fatto e i problemi aperti.)_
