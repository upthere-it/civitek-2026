# PLAN — dal 14 al 23 ottobre 2026

Lo sviluppo è di **Claude Code**; review, test su telefoni e asset sono di **Simone**. Si lavora una milestone per sessione e alla fine si aggiornano checkbox e note. Il weekend 17–18/10 è buffer.

## Milestone

### M0 — Fondamenta (mer 14/10)
- [x] Monorepo `apps/server`, `apps/client`, `packages/shared`, script npm (vedi CLAUDE.md)
- [x] `sql/001–005`: schema, `fn_setting`, procedure interne, `sp_listing_create`/`sp_listing_buy`, outbox chain, `sp_economy_check`
- [x] `tools/seed-from-json.ts`: `items`, `game_settings`, giocatori di sistema, `GRANT` della tesoreria
- [x] `packages/shared/valuation.ts` con test sugli esempi di GAME_DESIGN §8
- [x] `economy.invariants.spec` (I1–I6) verde su DB di test
- [x] `ChainNotary` + `MockNotary` + `ChainWorker` funzionanti (gli eventi passano a `CONFIRMED`)

**Accettazione**: `npm test` verde; un acquisto da bacheca simulato via test produce ledger, catena hash e certificazione mock corretti.

### M1 — Entrare nel villaggio (gio 15/10)
- [x] Landing, `device_id`, handshake, `sp_player_get_or_create` (nickname, 100 monete, scarpa regalo)
- [x] Boot che carica tutto da `apps/client/public/assets/manifest.json`
- [x] Schermata avatar (3 tratti) con il compositore a layer descritto in `docs/ASSETS.md`
- [x] Tilemap del villaggio in Tiled (tile da 16 px) con gli asset di `vendor/pixel-crawler`, secondo la mappa di GAME_DESIGN §4 — generata da `tools/assets/gen_village.py`, ritoccabile in Tiled
- [x] Scena Village: tap-to-move, camera, presenza degli altri giocatori nel raggio, emote
- [x] HUD: monete, valore armadio

**Accettazione**: 3 telefoni veri nel villaggio contemporaneamente si vedono e si mandano emote; dal QR al villaggio in meno di 45 s.

> Verificato in automatico con 3 browser mobili headless (iPhone 13, Pixel 7, iPhone SE): si vedono, si muovono, si mandano emote; circa 5 s dall'apertura al villaggio. **Da fare: prova su 3 telefoni veri (Simone).**

### M2 — Mercato e passaporto (ven 16/10)
- [x] Negozio (`sp_shop_buy`), inventario (Armadio dall'HUD, con Vendi/Ritira)
- [x] Bacheca: crea, annulla, compra annuncio (`sp_listing_cancel` in 007; si compra dal passaporto)
- [x] UI passaporto completa (timeline, badge certificazione, aggiornamento live su `asset.certified` e `asset.updated`)
- [x] Mappa errori SP → messaggi italiani (GAME_DESIGN §18), con un test che la controlla su tutti i `SIGNAL` di `sql/`

**Accettazione**: due giocatori si scambiano una scarpa; il passaporto mostra il passaggio ⏳ → ✅ in pochi secondi.

> Verificato in automatico: test end-to-end sul gateway (due giocatori, scambio, `inventory.updated` / `market.updated` / `asset.updated` / `asset.certified`) e smoke con 2 browser mobili headless (iPhone 13 + iPhone SE). A compra al Negozio e vede ⏳ → ✅, mette in bacheca; B apre il passaporto dalla bacheca, compra e vede l'anello "Venduta a te" diventare ✅; A riceve "Hai venduto…". Con `MockNotary` ci vogliono circa 2 s. **Da fare: prova su 2 telefoni veri (Simone) e, con le credenziali (D11), la latenza reale di Commercio.**

### M3 — Le meccaniche del messaggio (lun 19/10)
- [x] Tony Affari: restock dei falsi, acquisto, passaporto con ⚠️
- [x] Dott.ssa Hash: verifica, badge ✅ / timbro ❌, valore 2
- [x] MC Suola: prestito di 10 s, `LEGEND_IN` / `LEGEND_OUT`, bonus, cooldown
- [x] Drop di mondo ogni 3' con annuncio a tutti
- [x] Bot di mercato con attività in funzione degli umani online

**Accettazione**: un giocatore da solo, senza altri umani online, riesce a fare tutte le azioni del gioco grazie ai bot.

> Verificato in automatico: `mechanics.spec` (SP a livello DB) e `m3.gateway.spec` (via socket, un giocatore da solo), più uno smoke in browser con un giocatore e i bot attivi:
> - bacheca piena di annunci dei bot;
> - falso comprato da Tony senza guardare il passaporto e smascherato dalla Dott.ssa Hash (timbro ❌, valore 2);
> - MC Suola: prestito, ritorno dopo 10 s, +40%;
> - un bot compra l'annuncio sottoprezzo ("Hai venduto…");
> - banner del drop → "Vai" → Banca → acquisto → passaporto "Creata da Upthere — drop n. 1 di 4".
>
> **Da fare: prova su un telefono vero (Simone).**

### M4 — Prima run e reveal (mar 20/10)
- [ ] Timer della prima run e beat (`run.beat`), obiettivo, badge "Mercante"
- [ ] Schermata reveal completa, con codice di recupero e CTA verso DOP Digital
- [ ] Recupero da un altro device (`sp_player_recover`)
- [ ] Enoteca DOP Digital con la bottiglia demo
- [ ] Classifica
- [x] `CommercioNotary` via API commercio.app (porting di `@mvl/commercio-network`, ARCHITECTURE §6), anticipato il 14/10: provato contro un finto commercio.app
- [ ] Credenziali nel `.env` (D11), prima notarizzazione vera sulla testnet, `chain.notary = "commercio"`. Senza credenziali entro il 20/10 si resta su Mock

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
- [ ] Deploy (PM2 fork, nginx, HTTPS) su **civitek.upthere.it** (D3), con `RECOVERY_SECRET` e `CN_*` nel `.env` di produzione
- [ ] Reset del DB di produzione con script SQL a mano (non via MCP) + seed
- [ ] Credito dell'account commercio.app sufficiente per la giornata
- [ ] QR definitivo verso https://civitek.upthere.it stampato e provato
- [ ] Prova generale con il team: 5+ telefoni, run completa

### Giorno della conferenza (ven 23/10)
- [ ] Health check 1 ora prima (`/api/health`): DB, worker chain, login commercio.app e saldo (`/wallet/balance`)
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
| ~~D1~~ | ✅ **Chiusa (14/10)**: **Commercio.network testnet** (`commercio-testnet11k`), notarizzazione con `MsgShareDocument` del modulo `documents`. Dettagli verificati in ARCHITECTURE §6 | Simone | — | — |
| ~~D2~~ | ✅ **Chiusa (13/10)**: palette, logo (SVG dal sito), font Chillax + DM Sans self-hosted, insegne pixel. Tutto in `assets/brand/` | Simone | — | — |
| ~~D3~~ | ✅ **Chiusa (14/10)**: dominio **civitek.upthere.it** (config `links.game`). Restano da fare: record DNS verso il server, certificato TLS, hosting | Simone | 19/10 | — (bloccante per M6) |
| ~~D4~~ | ✅ **Chiusa (13/10)**: Pixel Crawler Free Pack (Anokolisa), uso commerciale ammesso. Avatar e icone delle scarpe sono placeholder generati; il ritocco in Aseprite è facoltativo | Simone | — | — |
| D5 | Testo della pagina privacy (revisione interna) | Simone | 20/10 | testo bozza di Claude Code |
| D6 | Nomi definitivi degli NPC (proposte in `npcs.json`) | Simone | 19/10 | nomi proposti |
| D7 | `humanOwnersCount` nel valore percepito: conta i **passaggi** verso umani (scelta attuale: anche il ping-pong A→B→A pesa) oppure i giocatori **distinti**? | Simone | 16/10 | passaggi |
| D8 | Tentativi della certificazione: oggi `max_attempts` (5) × `batch_interval_ms` (2 s) vuol dire che 10 s di testnet giù mandano gli eventi in `FAILED` per sempre. Proposta: backoff (`chain_next_attempt_at`) oppure job che rimette in coda i `FAILED` ogni N minuti | Simone | con D1 | backoff |
| D9 | Budget "primo caricamento < 1 MB": Phaser 3 da solo pesa 322 KB gzip (1,2 MB minificato), che `ASSETS.md` §8 non conta. Con asset (~330 KB) e font (~88 KB) si arriva a ~740 KB gzip prima di tilemap e suoni. Il budget è sul trasferito (gzip/brotli) o sul peso dei file? Se serve margine: build custom di Phaser senza Matter/fisica | Simone | 19/10 | gzip, margine da tenere d'occhio in M5 |
| D10 | Commercio: un `sharedoc` **per batch** (hash cumulativo, come in Carma: già compatibile col worker) oppure **per evento** (l'hash del passaporto è esattamente quello on-chain, ma 1–1,5 chiamate API/s al picco) | Simone | 17/10 | per batch |
| ~~D12~~ | ✅ **Chiusa (14/10)**: nome **scelto dal giocatore** con un default generato, modificabile solo alla creazione (formato da config, filtro `data/nickname_blocklist.json`, invito a non usare il vero nome); **stile Ragazzo/Ragazza** come tratto dell'avatar. Cambia la regola 6 di CLAUDE.md. Da riflettere nel testo privacy (D5) | Simone | — | — |
| D11 | Credenziali commercio.app per il gioco (`CN_USERNAME`/`CN_PASSWORD`/`CN_RECIPIENT_ADDRESS`, ambiente dev = testnet): account dedicato o quello Upthere esistente. Vanno solo nel `.env`, mai nel repo | Simone | 18/10 | si resta su `MockNotary` |

## Note di sessione

_(Claude Code: aggiungi qui una riga per sessione con data, milestone, cosa è stato fatto e i problemi aperti.)_

- **13/10 — M0 completata.**
  - **Fatto**:
    - monorepo npm workspaces: `packages/shared` CJS; server NestJS 11 CJS con `tsc` e `node --watch`, senza `@nestjs/cli`; client Vite 8 + Phaser 3.90 in WebGL;
    - SQL 001–005 e seed generato e idempotente; `db:migrate`, `db:seed` e `db:reset` con guardia sul nome del DB;
    - `DbService.call`: SpError e retry del deadlock;
    - sync di `game_settings` all'avvio;
    - `ChainWorker` con intervallo da config e conferma ritentata se il DB cade dopo la notarizzazione;
    - `sp_player_get_or_create` anticipata da M1, perché serve ai test.
  - **Test**:
    - `npm test`: 20 test di shared + 22 del server, verdi 6 volte di fila;
    - stress fuori dalla suite: 200 registrazioni e 150 acquisti incrociati su 50 connessioni, 0 deadlock e 0 violazioni;
    - server compilato avviato sul DB dev: certifica il regalo con il ritardo mock reale;
    - client provato in Chromium headless (viewport iPhone 13): WebGL attivo e Chillax caricato. Su telefono reale va provato in M1.
  - **Trovato e corretto**:
    - deadlock nella `_sp_append_event` di riferimento: `SET v = (SELECT …)` in una SP prende gap lock. Ora la testa della catena sta in `assets.head_hash`, e la convenzione in CLAUDE.md è aggiornata;
    - `fn_setting` ora va in errore se manca una chiave, invece di restituire NULL e far passare i controlli;
    - `_sp_move_coins` rifiuta emissioni che non siano GRANT e giocatori inesistenti;
    - I1 controlla anche il saldo di ogni giocatore contro il ledger;
    - I4 controlla anche `head_hash`;
    - `document.fonts.ready` non basta per il testo nel canvas (ASSETS.md §7 corretto).
  - **Aperto**:
    - D7, D8, D9;
    - in produzione `fn_setting` richiede SUPER oppure `log_bin_trust_function_creators=1`;
    - su GitHub va impostato `main` come branch di default.
- **13/10 — M1 completata (in attesa della prova su telefoni veri).**
  - **Fatto**:
    - gateway socket.io con eventi tipizzati in `shared/protocol.ts`, ack `{ok, data | code, message}` in italiano, rate limit, una sessione per giocatore;
    - nickname dal pattern di config;
    - codice di recupero ricavato con HMAC dal device: nel DB solo l'hash, rimostrabile sempre;
    - `sp_player_set_avatar` (006);
    - mappa generata (`gen_village.py`), con griglia e A* condivisi tra server e client;
    - client: landing, Boot dal manifest, schermata avatar con anteprima live, villaggio con camera, NPC che parlano all'arrivo, emote, HUD;
    - nuove chiavi `world.*` in config.
  - **Test**:
    - `npm test`: 28 test di shared (incluso: ogni punto di interazione è raggiungibile dallo spawn) + 33 del server (11 end-to-end sul gateway);
    - 3 browser mobili in parallelo: si vedono, il movimento si propaga, le emote arrivano a tutti, nessun errore in console;
    - carico: 100 client entrano in circa 0,55 s, p95 di `move.to` 13 ms, nessun errore nel log.
  - **Scelta fuori documento**: `world.players` non manda più la posizione a ogni tick (10 Hz) ma il percorso alla partenza e un messaggio all'arrivo. Il client simula il cammino con la stessa `advance()`. Nella prova a 100 giocatori la banda è scesa da 18,5 MB a 4,4 MB in 10 s. ARCHITECTURE §5 è aggiornata.
  - **Aperto**:
    - prova su telefoni veri;
    - acqua della fontana non animata;
    - pannelli degli NPC da M2 (per ora dicono una battuta);
    - il link "Hai già giocato? Inserisci il codice" arriva con il recupero (M4).
- **14/10 — CommercioNotary e M2 completata (in attesa di telefoni veri e credenziali).**
  - **Fatto**:
    - `CommercioNotary`, che usa le API commercio.app come `@mvl/commercio-network`: login Keycloak con token in cache, `POST /sharedoc/process` con l'hash cumulativo del batch, polling fino a `doc_tx_hash`. `GET /api/chain/batch/:batchId` è il `content_uri` pubblico, da cui chiunque ricalcola l'hash. Si attiva con `chain.notary = "commercio"` e `CN_*` nel `.env`; finché mancano si resta su `MockNotary`;
    - `sql/007_market.sql`: `sp_shop_buy` (monete alla tesoreria, MINT dal Negozio direttamente al giocatore) e `sp_listing_cancel`;
    - gateway: `shop.*`, `market.list` (paginata), `listing.*`, `passport.get` con room `asset:<id>`; `inventory.updated` va anche al venditore;
    - client: pannelli impilabili Negozio, Bacheca, Armadio e Passaporto, selettore di prezzo con commissione visibile, toast "Hai venduto";
    - `shared`: `listingPriceRange` e `marketFee` (le stesse regole delle SP, il client le mostra soltanto);
    - errori: `INTERNAL_SP_CODES` per i codici che il giocatore non vede mai.
  - **Test**:
    - `npm test`: 30 test di shared + 68 del server, tutti verdi;
    - smoke con 2 browser mobili (sopra);
    - nessun overflow orizzontale a 320 px, emote su una riga;
    - nessun errore in console né nel log del server.
  - **Scelte fuori documento**:
    - in bacheca si compra solo dal passaporto, così la lezione "guarda la storia prima di comprare" è nel gesto;
    - dopo un acquisto al Negozio si apre il passaporto, per vedere subito il primo anello certificarsi;
    - orari del passaporto in epoch ms (`UNIX_TIMESTAMP` lato DB): così niente fusi e niente date MySQL che Safari non sa leggere;
    - il plugin Vite `sp-client-items` toglie dal bundle `reference_ids` (modelli reali), valori base e pesi dei drop.
  - **Aperto**:
    - D7–D11;
    - credenziali commercio.app (D11) per la prima notarizzazione vera sulla testnet;
    - prova su telefoni veri di M1 e M2;
    - pannelli di Banca, Tony Affari, Dott.ssa Hash, MC Suola ed Enoteca in M3.
- **14/10 — M3 completata (in attesa del telefono vero).**
  - **Fatto**:
    - `sql/008_mechanics.sql`: bancarella, autenticazione, MC Suola, drop, scorte e acquisti dei bot; `sp_economy_check` ridefinita (I3 tiene conto del prestito);
    - server: `MechanicsService`, `DropService` (orologio di mondo), `BotService` (attività in funzione degli umani nel villaggio), `GameEventsService`;
    - client: pannelli di Tony, Dott.ssa Hash, MC Suola e Banca, banner del drop con "Vai", timbro ✅/❌ sulle icone, "In prestito a MC Suola" nell'armadio, toast impilati, battute che si sostituiscono invece di sovrapporsi;
    - `npm run dev` avvia solo server e client, senza toccare il DB; su Windows lancia `npm-cli.js` (lo spawn di `npm.cmd` dà `EINVAL` con Node ≥ 18.20).
  - **Test**: `npm test` 30 di shared + 88 del server; smoke M3 (sopra) e regressione dello smoke M2 con i bot attivi, nessun errore in console.
  - **Scelte fuori documento**:
    - MC Suola è un prestito: `owner_id` non cambia, la catena registra `LEGEND_IN` (giocatore → MC Suola) e `LEGEND_OUT`. Così armadio, valore e bacheca non si rompono per 10 secondi;
    - da Tony il "Compra" sta nella riga e la lista non mostra il valore: chi apre il passaporto vede il ⚠️, chi non lo apre ci casca;
    - la Dott.ssa Hash non fa pagare due volte la stessa scarpa (`ALREADY_VERIFIED`);
    - i numeri dei bot sono in `economy.bots.*` (stili compresi), non nel codice;
    - i loop partono subito all'avvio: Tony ha il banco pieno e i bot hanno le scorte;
    - etichetta del nickname più bassa (da 46 a 34 px): prima finiva sull'NPC davanti.
  - **Aperto**:
    - Enoteca DOP Digital (§15) e prima run in M4;
    - D6 (nomi NPC);
    - il DB `civitek` sul server di test non ha ancora la 008;
    - un drop lasciato aperto durante un riavvio del server resta in DB ma non viene ripreso: il prossimo si apre all'orario successivo.
- **14/10 — Onboarding: nome scelto e stile Ragazzo/Ragazza (D12).**
  - **Fatto**:
    - creazione del personaggio in due passi: "Chi sei" (stile e nome proposto, 🎲 per un altro) e "Il tuo look";
    - `sql/009_player_profile.sql`: `players.avatar_body` e `sp_player_set_profile` (nome e aspetto una volta sola, `NICKNAME_TAKEN` sull'unicità);
    - nome: `nicknameFormatError`/`suggestNickname` in shared, filtro `NicknameFilter` lato server con `data/nickname_blocklist.json` (minuscole, accenti, numeri al posto delle lettere, lettere doppie);
    - asset: corpo "ragazza" (`skinf_*`: ciglia e guance), gonna (`skirt_*`) e acconciatura `coda` per tutti, generati da `gen_avatar.py`. Boot a ~405 KB.
  - **Test**: `nickname.spec` (formato, filtro, nessun falso positivo sui nomi proposti), gateway (nome valido, già preso anche con maiuscole diverse, non valido, vietato, stile al rientro); smoke su iPhone SE e regressione degli smoke M2 e M3.
  - **Aperto**:
    - nessun filtro di parole è perfetto: la lista va ampliata quando serve;
    - il DB `civitek` non ha ancora la 009;
    - testo privacy (D5) da aggiornare con il nome scelto.
  - **Rivisto dopo il feedback di Simone ("la ragazza non si riconosce")**: ciglia e guance a 64 px non bastavano. Ora la ragazza ha il vestito (gonna corta e svasata tinta come la felpa, gambe scoperte), acconciature dedicate (lunghi, coda, codini, caschetto: `avatar.hair_by_body`, il server rifiuta le altre), bocca e ciglia marcate.
