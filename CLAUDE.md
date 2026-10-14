# CLAUDE.md — Sneaker Passport (Upthere × DOP Digital)

Leggi questo file all'inizio di ogni sessione, poi il documento in `docs/` che riguarda il task. Lavora una milestone alla volta (`docs/PLAN.md`) e aggiorna le checkbox a fine sessione.

## Il progetto in breve

Gioco web mobile-first, brandizzato Upthere, per presentare **DOP Digital** (https://dopdigital.it/) a circa **100 studenti delle superiori** durante un intervento di 10 minuti alla conferenza del **23 ottobre 2026**.

I ragazzi scansionano un QR, creano un avatar pixel art con 3 tratti ed entrano in un villaggio (Phaser 3). Lì comprano, vendono e verificano sneaker con marchi fittizi. Ogni scarpa ha un **passaporto digitale**: la catena dei suoi proprietari, con ogni passaggio certificato su **blockchain testnet**.

Il messaggio da far arrivare giocando, senza spiegarlo:
1. la tracciabilità della proprietà protegge dai falsi;
2. la storia di chi ha posseduto un oggetto cambia il suo valore percepito.

DOP Digital fa la stessa cosa con le bottiglie di vino. Il gioco funziona **in autonomia** (nessuna regia dal palco) e **resta aperto** dopo la conferenza, senza data di chiusura.

## Documenti

| File | Contenuto |
|---|---|
| `docs/GAME_DESIGN.md` | Flusso del giocatore, villaggio, NPC, prima run, passaporto, valore, falsi, testi UI |
| `docs/ECONOMY.md` | Economia chiusa con tesoreria, flussi di monete, bot, invarianti |
| `docs/ARCHITECTURE.md` | Stack, struttura repo, schema MySQL, stored procedure, protocollo socket, certificazione on-chain, deploy |
| `docs/PLAN.md` | Milestone fino al 23/10, criteri di accettazione, ordine di taglio, decisioni aperte |
| `docs/ASSETS.md` | Pixel art: licenza, cosa è incluso, avatar a layer, icone scarpe, NPC, mappa, peso |
| `data/game_config.json` | **Tutti** i numeri del gioco |
| `data/game_items.json` | Catalogo in gioco (29 item, marchi fittizi, 16 silhouette) |
| `data/npcs.json` | NPC, ruoli, battute, bottiglia demo DOP |
| `data/catalog_reference.json` | Catalogo reale di riferimento (prezzi e rarità). **Uso interno, mai mostrato nel gioco** |
| `apps/client/public/assets/` | Asset pronti: `manifest.json` per il loader, avatar a layer, atlas delle scarpe, pixel art curata |
| `tools/` | Script Python che rigenerano dati e asset placeholder |
| `vendor/` | Pack originale Pixel Crawler (non servito al client) |

## Regole non negoziabili

1. **Server autoritativo.** Il client invia intenzioni (`listing.buy`), mai stati (saldi, prezzi, proprietari, valori).
2. **Monete solo via ledger.** Ogni movimento passa da `coin_ledger`. Invariante: monete in circolazione = monete emesse. Il test `economy.invariants.spec` è obbligatorio e deve restare verde.
3. **Proprietà e monete solo in stored procedure**, dentro una transazione, con l'ordine di lock definito in ARCHITECTURE: `market_listings` → `players` (id crescente) → `assets`.
4. **La blockchain non sta mai nel percorso critico.** Lo scambio è valido al COMMIT; la certificazione arriva dopo, dal worker, con il pattern outbox. Mai chiamare la chain dentro una transazione DB.
5. **Nessun marchio reale** nel gioco: nomi, loghi e silhouette sono fittizi. Gli sprite non devono riprodurre swoosh, tre strisce, jazz stripe o altri segni distintivi. Gli asset fantasy del pack (armi, orchi, scheletri, dungeon) sono esclusi apposta: non reintrodurli.
6. **Gli utenti sono minorenni.**
   - Nessun dato personale: niente nome, email, telefono, posizione o foto.
   - Niente chat libera, solo emote predefinite.
   - Nickname generati e non modificabili.
   - `device_id` = UUID v4 casuale generato dal client. **Niente fingerprinting.**
   - Anonimizzazione dopo 30 giorni di inattività.
   - Nessun analytics né tracker di terze parti.
   - On-chain vanno **solo hash**, mai id, nickname o altri dati.
7. **Numeri solo da config.** Nessuna costante di gioco nel codice: tutto viene da `data/game_config.json`. I valori che servono alle SP sono sincronizzati nella tabella `game_settings`.
8. **Mobile-first.**
   - Target: Safari iOS, Chrome Android e browser in-app aperti dalla fotocamera.
   - Primo caricamento sotto 1 MB.
   - Controlli touch: tap per muoversi.
9. **Testi UI in italiano**, frasi brevi, tono diretto da ragazzi. I testi chiave sono in `docs/GAME_DESIGN.md` §18.
10. **Brand Upthere ovunque, sempre dagli asset ufficiali.**
    - Colori solo da `brand.colors` in config (variabili CSS in `docs/ASSETS.md` §7), rispettando i contrasti: niente testo normale bianco su accent o su warn.
    - Font da `assets/brand/fonts.css`: Chillax per i titoli, DM Sans per il testo.
    - Logo solo dagli SVG/PNG in `assets/brand/`: mai ridisegnato o ricreato.

## Stack

- **server**:
  - NestJS + TypeScript (CommonJS) con gateway socket.io;
  - MySQL ≥ 8.0.16 (servono i `CHECK`) con stored procedure;
  - `@nestjs/schedule` per i loop: bot, drop, worker chain, anonimizzazione;
  - PM2 in **fork mode, 1 istanza**: lo stato socket è in memoria, quindi niente cluster mode.
- **client**: Vite + TypeScript + Phaser 3 (`pixelArt: true`). L'UI è un overlay HTML/CSS sopra il canvas.
- **shared**: tipi, nomi degli eventi socket, `perceivedValue()`. È la sorgente unica per server e client.
- **chain**: interfaccia `ChainNotary`, con `MockNotary` per lo sviluppo (default) e `CommercioNotary` per **Commercio.network testnet** (D1) tramite le API commercio.app, come `@mvl/commercio-network` nel repo `microservices` (vedi ARCHITECTURE §6).
- **dominio**: https://civitek.upthere.it (D3).
- **test**: Jest + ts-jest su server e shared. Lo script di load test usa Artillery con il motore socket.io.

### ESM / CommonJS
Ci sono già stati problemi con Jest + ESM, quindi il server resta **CommonJS**.
- `packages/shared` è compilato da `tsc` in CJS per il server; il client lo importa come sorgente TS tramite alias Vite.
- Non aggiungere al server dipendenze solo-ESM. Se una libreria lo è, segnalalo prima di usarla.
- Per hash e numeri casuali usa il modulo `crypto` nativo di Node: niente librerie esterne.

## Convenzioni

- Le stored procedure pubbliche `sp_*` gestiscono la transazione. Quelle interne `_sp_*` **non** aprono transazioni: in MySQL uno `START TRANSACTION` annidato fa un commit implicito.
- Letture dentro le SP (MySQL 8, verificato sui lock reali; dettagli in testa a `sql/003_procedures.sql`):
  - `SET v = (SELECT …)` è una lettura **con lock condiviso**, anche con binlog ROW. Su un range o su una riga che manca prende i gap lock, e due transazioni che poi inseriscono nello stesso gap vanno in deadlock. Usala solo per PK/unique su righe che esistono, meglio se già bloccate;
  - per valori che possono mancare, conteggi e range usa `SELECT MAX(…)/COUNT(*) … INTO v`: nessun lock e sempre una riga, quindi niente warning "no data". Fallo dopo aver preso i lock, perché lo snapshot nasce alla prima lettura consistente della transazione;
  - la testa della catena di un asset sta in `assets.head_hash`: non si legge l'ultimo evento da `asset_events`.
- Errori delle SP: `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UPPER_SNAKE'` (es. `NOT_OWNER`, `NO_FUNDS`). Ogni codice corrisponde 1:1 a un codice errore del gateway e a un messaggio UI in italiano.
- Deadlock (errore 1213): `DbService.call` riprova una volta, poi lancia `SpError('BUSY')`. Lo stesso vale per il timeout dei lock (1205).
- Eventi socket nel formato `dominio.azione` (es. `listing.buy`), con payload validati lato server.
- Migrazioni SQL numerate in `sql/` (`001_schema.sql`, `002_functions.sql`, …). Una migrazione già applicata non si modifica: se ne aggiunge una nuova (il runner controlla il checksum). I file girano sia con `npm run db:migrate` sia a mano con il client `mysql`.
- Il seed `sql/seed/001_seed.sql` è generato da `data/*.json` (`tools/seed-from-json.ts`) ed è idempotente. All'avvio il server riallinea comunque `game_settings` a `game_config.json`.
- `fn_setting` è una FUNCTION: con il binlog attivo crearla richiede SUPER oppure `log_bin_trust_function_creators = 1` (vedi `sql/002_functions.sql`).

## Comandi

`npm run dev:server` · `npm run dev:client` · `npm test` · `npm run typecheck` · `npm run build` · `npm run db:migrate` · `npm run db:seed` · `npm run db:reset` (solo database `*_dev`, `*_test`, `*_staging`)

Da creare in M5: `npm run loadtest` · `npm run sim:economy`.

`npm test` azzera e ricrea il database di test (`DB_TEST_NAME`, default `sneaker_passport_test`): serve un MySQL 8 raggiungibile con le credenziali di `.env` (vedi `.env.example`).

Versioni bloccate per CommonJS: NestJS **11** (la 12 è solo ESM), TypeScript **6.0** (ts-jest non supporta la 7), Phaser **3.90**.

## Definition of Done (per ogni milestone)

- Test verdi, compreso `economy.invariants.spec`.
- Provato su un telefono reale, non solo nei devtools.
- Nessun errore in console né nei log del server.
- `docs/PLAN.md` aggiornato con checkbox e note.

## Cosa NON fare

- Login, email, social, OAuth: non servono.
- Redis, RabbitMQ, microservizi, Kubernetes: per 100 utenti basta un'istanza.
- Salvare stato autoritativo in localStorage: lì sta solo il `device_id`.
- Inventare prezzi "reali": i valori in gioco sono in monete e vengono da `game_items.json`.
- Mostrare `catalog_reference.json` o nomi di marchi reali all'utente.
- Toccare a mano i numeri di gioco nel codice invece che in config.

## Database

L'MCP MySQL disponibile punta all'ambiente di **test**. Per la produzione prepara script SQL da lanciare a mano, non usare l'MCP.
