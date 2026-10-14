# ARCHITECTURE — Sneaker Passport

## 1. Panoramica

```
 telefono (Safari/Chrome/in-app)
   │  HTTPS + WSS
   ▼
 nginx ── file statici client (Vite build) + proxy /socket.io e /api
   │
   ▼
 NestJS (PM2 fork, 1 istanza)
   ├─ GameGateway (socket.io)     sessioni, presenza, azioni di gioco
   ├─ Market / World services     negozio, bacheca, bancarella, MC Suola, drop, bot, run
   ├─ ChainWorker (@Interval)     outbox → ChainNotary (Mock | testnet)
   ├─ PrivacyJob (@Cron)          anonimizzazione inattivi
   └─ REST /api                   passaporto pubblico, schermo palco, health
   │
   ▼
 MySQL 8.0.16+  (stored procedure = unico punto di scrittura per monete e proprietà)
```

Dimensionamento per circa 100 giocatori:
- un'istanza basta, con broadcast posizioni a 10 Hz solo entro il raggio visibile;
- la chain fa circa 1–1,5 eventi certificabili al secondo nel picco, che un batch ogni 2 secondi con un solo wallet regge senza problemi.

**Niente RabbitMQ**: con questi volumi l'outbox letto da un poller interno al processo è più semplice e altrettanto robusto.

## 2. Struttura repo

```
sneaker-passport/
├── CLAUDE.md
├── docs/                      GAME_DESIGN, ECONOMY, ARCHITECTURE, PLAN
├── data/                      game_config, game_items, npcs, catalog_reference
├── sql/
│   ├── 001_schema.sql
│   ├── 002_functions.sql
│   ├── 003_procedures.sql     procedure interne, giocatore, bacheca
│   ├── 004_chain_procedures.sql
│   ├── 005_economy_check.sql  invarianti I1–I6
│   └── seed/                  generato da tools/seed-from-json.ts
├── packages/shared/src/       events.ts, types.ts, valuation.ts, config.ts
├── apps/server/src/
│   ├── db/                    pool mysql2, call(sp, args), mappa errori SP → codici
│   ├── game/                  gateway, sessione, presenza, rate limit
│   ├── market/                negozio, bacheca, bancarella, autenticatore, MC Suola
│   ├── world/                 drop, bot, timer prima run
│   ├── chain/                 ChainNotary, MockNotary, implementazione testnet, worker
│   ├── privacy/               job di anonimizzazione
│   └── public/                REST /api/passport/:publicId, /api/screen, /api/health
├── apps/client/
│   ├── src/main.ts, scenes/ (Boot, Avatar, Village), ui/ (overlay HTML), net/
│   └── public/assets/         GIÀ PRESENTE: manifest.json, avatar/, shoes/, vendor/pixel-crawler/ (vedi ASSETS.md)
│                              da aggiungere: tilemap Tiled del villaggio, suoni
├── tools/                     seed-from-json.ts, sim-economy.ts, loadtest.yml (da creare)
│   ├── build_data.py          rigenera data/*.json
│   └── assets/                gen_avatar.py, gen_shoes.py, preview_avatar.py (rigenerano gli asset placeholder)
├── vendor/                    pack originale Pixel Crawler (zip, con i sorgenti .aseprite): non servito al client
└── ecosystem.config.js
```

## 3. Schema MySQL (`sql/001_schema.sql`)

```sql
SET NAMES utf8mb4;

CREATE TABLE game_settings (            -- config appiattita da game_config.json (chiavi "economy.market_fee_pct")
  name  VARCHAR(96)  NOT NULL PRIMARY KEY,
  value VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE items (                    -- seed da game_items.json
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  tier        ENUM('base','trend','hype','limited','upthere') NOT NULL,
  rarity      ENUM('common','popular','hyped','limited') NOT NULL,
  base_value  INT NOT NULL,
  fakeable    TINYINT(1) NOT NULL DEFAULT 0,
  drop_weight INT NOT NULL DEFAULT 0,
  sources     JSON NOT NULL,
  CONSTRAINT ck_items_value CHECK (base_value > 0)
) ENGINE=InnoDB;

CREATE TABLE item_counters (
  item_id     VARCHAR(64) NOT NULL PRIMARY KEY,
  last_serial INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE players (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_hash   CHAR(64) NULL,                  -- sha256(device_id): il device_id in chiaro non si salva
  is_system     TINYINT(1) NOT NULL DEFAULT 0,
  system_role   ENUM('TREASURY','SHOP','STALL','LEGEND','BOT') NULL,
  nickname      VARCHAR(32) NOT NULL,
  avatar_skin   TINYINT UNSIGNED NULL,
  avatar_hair   TINYINT UNSIGNED NULL,             -- indice in avatar.hair_styles
  avatar_hair_color TINYINT UNSIGNED NULL,         -- indice in avatar.hair_colors
  avatar_outfit TINYINT UNSIGNED NULL,
  coins         INT NOT NULL DEFAULT 0,
  recovery_hash CHAR(64) NULL,
  first_run_started_at   DATETIME(6) NULL,
  first_run_completed_at DATETIME(6) NULL,
  last_seen_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  anonymized_at DATETIME(6) NULL,
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT ck_players_coins CHECK (coins >= 0),
  UNIQUE KEY uq_players_device (device_hash),
  UNIQUE KEY uq_players_recovery (recovery_hash),
  UNIQUE KEY uq_players_nickname (nickname),
  KEY ix_players_last_seen (is_system, last_seen_at)
) ENGINE=InnoDB;

CREATE TABLE player_devices (           -- un giocatore può avere più device (codice di recupero)
  device_hash CHAR(64) NOT NULL PRIMARY KEY,
  player_id   BIGINT NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_pd_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB;

CREATE TABLE drops (
  id         BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id    VARCHAR(64) NOT NULL,
  quantity   INT NOT NULL,
  sold       INT NOT NULL DEFAULT 0,
  opens_at   DATETIME(6) NOT NULL,
  closes_at  DATETIME(6) NOT NULL,
  CONSTRAINT fk_drops_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT ck_drops_sold CHECK (sold <= quantity)
) ENGINE=InnoDB;

CREATE TABLE assets (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id     CHAR(12) NOT NULL,             -- per la pagina pubblica /p/:publicId
  item_id       VARCHAR(64) NOT NULL,
  serial        INT NOT NULL,
  owner_id      BIGINT NOT NULL,
  minted_by     BIGINT NOT NULL,               -- 1 = Banca Upthere (drop), 2 = Negozio, 3 = Tony Affari (falsi)
  drop_id       BIGINT NULL,
  drop_serial   INT NULL,                      -- "n. X di Y" nel drop (= drops.sold dopo l'incremento)
  is_fake       TINYINT(1) NOT NULL DEFAULT 0,
  fake_revealed TINYINT(1) NOT NULL DEFAULT 0,
  auth_verified TINYINT(1) NOT NULL DEFAULT 0, -- badge ✅ Autentica
  legend_count  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until  DATETIME(6) NULL,              -- prestito a MC Suola
  head_hash     CHAR(64) NULL,                 -- hash dell'ultimo anello (vedi _sp_append_event)
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_assets_public (public_id),
  UNIQUE KEY uq_assets_item_serial (item_id, serial, is_fake),
  KEY ix_assets_owner (owner_id),
  CONSTRAINT fk_assets_item  FOREIGN KEY (item_id)  REFERENCES items(id),
  CONSTRAINT fk_assets_owner FOREIGN KEY (owner_id) REFERENCES players(id),
  CONSTRAINT fk_assets_drop  FOREIGN KEY (drop_id)  REFERENCES drops(id)
) ENGINE=InnoDB;

CREATE TABLE drop_claims (
  drop_id   BIGINT NOT NULL,
  player_id BIGINT NOT NULL,
  asset_id  BIGINT NOT NULL,
  PRIMARY KEY (drop_id, player_id),            -- 1 per giocatore per drop
  CONSTRAINT fk_dc_drop  FOREIGN KEY (drop_id)  REFERENCES drops(id),
  CONSTRAINT fk_dc_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
) ENGINE=InnoDB;

CREATE TABLE asset_events (             -- catena di proprietà + outbox per la certificazione
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_id      BIGINT NOT NULL,
  event         ENUM('MINT','FAKE_MINT','TRANSFER','LEGEND_IN','LEGEND_OUT') NOT NULL,
  from_id       BIGINT NULL,
  to_id         BIGINT NOT NULL,
  price         INT NOT NULL DEFAULT 0,
  prev_hash     CHAR(64) NULL,
  hash          CHAR(64) NOT NULL,
  created_at    DATETIME(6) NOT NULL,
  chain_status  ENUM('NONE','PENDING','SENDING','CONFIRMED','FAILED') NOT NULL DEFAULT 'NONE',
  chain_batch   CHAR(36) NULL,
  chain_tx      VARCHAR(128) NULL,
  chain_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  chain_error   VARCHAR(255) NULL,
  chain_confirmed_at DATETIME(6) NULL,
  KEY ix_ev_asset (asset_id, id),
  KEY ix_ev_chain (chain_status, id),
  KEY ix_ev_batch (chain_batch),
  CONSTRAINT fk_ev_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
) ENGINE=InnoDB;

CREATE TABLE market_listings (
  id         BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_id   BIGINT NOT NULL,
  seller_id  BIGINT NOT NULL,
  price      INT NOT NULL,
  status     ENUM('OPEN','SOLD','CANCELLED') NOT NULL DEFAULT 'OPEN',
  buyer_id   BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at  DATETIME(6) NULL,
  open_asset_id BIGINT AS (IF(status = 'OPEN', asset_id, NULL)) STORED,
  UNIQUE KEY uq_listing_open_asset (open_asset_id),   -- max 1 annuncio OPEN per asset (I6)
  KEY ix_listing_open (status, created_at),
  CONSTRAINT ck_listing_price CHECK (price > 0),
  CONSTRAINT fk_listing_asset FOREIGN KEY (asset_id) REFERENCES assets(id)
) ENGINE=InnoDB;

CREATE TABLE coin_ledger (
  id         BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  from_id    BIGINT NULL,                     -- NULL = emissione
  to_id      BIGINT NOT NULL,
  amount     INT NOT NULL,
  reason     ENUM('GRANT','TRADE','FEE','SHOP','AUTH','LEGEND','BOT_BUY','BOT_SELL','DROP','STALL') NOT NULL,
  ref_id     BIGINT NULL,                     -- asset_id quando applicabile
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT ck_ledger_amount CHECK (amount > 0),
  KEY ix_ledger_from (from_id),
  KEY ix_ledger_to (to_id)
) ENGINE=InnoDB;
```

Seed di sistema (generato): `players` con id 1–4 e i bot 10–17, `GRANT` iniziale della tesoreria, `items` da `game_items.json`, `game_settings` da `game_config.json`.

## 4. Funzioni e stored procedure

### Regole
- `sp_*` pubbliche: aprono e chiudono la transazione, con `EXIT HANDLER FOR SQLEXCEPTION → ROLLBACK; RESIGNAL`.
- `_sp_*` interne: niente transazioni, il chiamante ha già preso i lock.
- **Ordine di lock globale**: `market_listings` / `drops` → `players` (id crescente, tesoreria sempre inclusa) → `assets`.
- I lock sui giocatori si prendono così: `SELECT COUNT(*) INTO v_n FROM players WHERE id IN (1, a, b) FOR UPDATE;`. Il range sulla PK acquisisce i lock in ordine crescente di id.

### `sql/002_functions.sql`

```sql
DELIMITER $$
CREATE FUNCTION fn_setting(p_name VARCHAR(96)) RETURNS VARCHAR(255)
  READS SQL DATA
BEGIN
  RETURN (SELECT value FROM game_settings WHERE name = p_name);
END$$
DELIMITER ;
```

### Procedure interne di riferimento (`sql/003_procedures.sql`)

```sql
DELIMITER $$

-- Aggiunge un anello alla catena. Decide se l'evento va certificato on-chain.
CREATE PROCEDURE _sp_append_event(
  IN p_asset_id BIGINT, IN p_event VARCHAR(16),
  IN p_from BIGINT, IN p_to BIGINT, IN p_price INT)
BEGIN
  DECLARE v_prev   CHAR(64);
  DECLARE v_now    DATETIME(6) DEFAULT NOW(6);
  DECLARE v_hash   CHAR(64);
  DECLARE v_status VARCHAR(10) DEFAULT 'NONE';
  DECLARE v_humans INT;

  -- testa della catena dalla riga dell'asset, già bloccata dal chiamante: lock sulla PK, nessun range
  -- su asset_events (con SET v_prev = (SELECT … ORDER BY id DESC LIMIT 1) i mint concorrenti andavano
  -- in deadlock sul gap in fondo all'indice: vedi la nota sotto)
  SELECT head_hash INTO v_prev FROM assets WHERE id = p_asset_id FOR UPDATE;

  SET v_hash = SHA2(CONCAT_WS('|', p_asset_id, p_event, IFNULL(p_from, ''), p_to, p_price,
                              IFNULL(v_prev, ''), DATE_FORMAT(v_now, '%Y-%m-%d %H:%i:%s.%f')), 256);

  -- regola: ogni MINT autentico + ogni evento (non FAKE_MINT) con almeno un umano
  IF p_event = 'MINT' THEN
    SET v_status = 'PENDING';
  ELSEIF p_event <> 'FAKE_MINT' THEN
    SELECT COUNT(*) INTO v_humans FROM players WHERE id IN (p_from, p_to) AND is_system = 0;
    IF v_humans > 0 THEN SET v_status = 'PENDING'; END IF;
  END IF;

  INSERT INTO asset_events (asset_id, event, from_id, to_id, price, prev_hash, hash, created_at, chain_status)
  VALUES (p_asset_id, p_event, p_from, p_to, p_price, v_prev, v_hash, v_now, v_status);
  UPDATE assets SET head_hash = v_hash WHERE id = p_asset_id;
END$$

-- Sposta monete e scrive il ledger. Il CHECK coins >= 0 blocca i saldi negativi.
CREATE PROCEDURE _sp_move_coins(
  IN p_from BIGINT, IN p_to BIGINT, IN p_amount INT, IN p_reason VARCHAR(16), IN p_ref BIGINT)
BEGIN
  IF p_amount > 0 THEN
    UPDATE players SET coins = coins - p_amount WHERE id = p_from;
    UPDATE players SET coins = coins + p_amount WHERE id = p_to;
    INSERT INTO coin_ledger (from_id, to_id, amount, reason, ref_id)
    VALUES (p_from, p_to, p_amount, p_reason, p_ref);
  END IF;
END$$

-- Conia un asset direttamente al destinatario (negozio, drop, regalo, bot, falso).
CREATE PROCEDURE _sp_mint(
  IN p_item_id VARCHAR(64), IN p_to BIGINT, IN p_minted_by BIGINT, IN p_is_fake TINYINT,
  IN p_price INT, IN p_drop_id BIGINT, OUT p_asset_id BIGINT)
BEGIN
  DECLARE v_serial INT;

  INSERT INTO item_counters (item_id, last_serial) VALUES (p_item_id, 0)
    ON DUPLICATE KEY UPDATE item_id = item_id;
  UPDATE item_counters SET last_serial = last_serial + 1 WHERE item_id = p_item_id;
  SET v_serial = (SELECT last_serial FROM item_counters WHERE item_id = p_item_id);

  INSERT INTO assets (public_id, item_id, serial, owner_id, minted_by, drop_id, is_fake)
  VALUES (SUBSTRING(SHA2(CONCAT(UUID(), RAND()), 256), 1, 12),
          p_item_id, v_serial, p_to, p_minted_by, p_drop_id, p_is_fake);
  SET p_asset_id = LAST_INSERT_ID();

  CALL _sp_append_event(p_asset_id, IF(p_is_fake = 1, 'FAKE_MINT', 'MINT'), NULL, p_to, p_price);
END$$
```

**Letture e lock nelle SP (MySQL 8).** `SET v = (SELECT …)` dentro una stored procedure è una lettura con lock condiviso, anche con binlog ROW (verificato con `performance_schema.data_locks`). Su un range o su una riga che non c'è prende anche i gap lock. In M0 i test di registrazione simultanea andavano in deadlock proprio così: due mint prendevano lo stesso gap in fondo a `ix_ev_asset` e poi ci inserivano. Per questo:
- la testa della catena sta in `assets.head_hash`;
- le letture che possono mancare, i conteggi e i range usano `SELECT agg(…) INTO`, senza lock, dopo aver preso i lock della transazione;
- `SET v = (SELECT …)` resta solo per PK su righe esistenti e già bloccate.

Lo stress test (200 registrazioni e 150 acquisti incrociati su 50 connessioni) chiude con 0 deadlock.

Per i falsi il numero di serie viene dallo stesso contatore dell'originale: il falso "sembra" un numero valido. Il vincolo `UNIQUE (item_id, serial, is_fake)` lo permette.

### Procedura pubblica di riferimento: acquisto da bacheca

```sql
CREATE PROCEDURE sp_listing_buy(IN p_listing_id BIGINT, IN p_buyer_id BIGINT)
BEGIN
  DECLARE v_asset BIGINT; DECLARE v_seller BIGINT; DECLARE v_price INT; DECLARE v_status VARCHAR(10);
  DECLARE v_owner BIGINT; DECLARE v_locked DATETIME(6); DECLARE v_seller_sys TINYINT;
  DECLARE v_coins INT; DECLARE v_fee INT; DECLARE v_n INT; DECLARE v_inv INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT asset_id, seller_id, price, status INTO v_asset, v_seller, v_price, v_status
    FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_status IS NULL     THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_NOT_FOUND'; END IF;
  IF v_status <> 'OPEN'   THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_CLOSED';    END IF;
  IF v_seller = p_buyer_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SELF_BUY';        END IF;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (1, v_seller, p_buyer_id) FOR UPDATE;

  SELECT owner_id, locked_until INTO v_owner, v_locked FROM assets WHERE id = v_asset FOR UPDATE;
  IF v_owner <> v_seller THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  IF v_locked IS NOT NULL AND v_locked > NOW(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ASSET_LOCKED'; END IF;

  SET v_coins = (SELECT coins FROM players WHERE id = p_buyer_id);
  IF v_coins < v_price THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  SELECT COUNT(*) INTO v_inv FROM assets WHERE owner_id = p_buyer_id;  -- senza lock: niente gap su ix_assets_owner
  IF v_inv >= CAST(fn_setting('player.max_inventory') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_FULL';
  END IF;

  SET v_seller_sys = (SELECT is_system FROM players WHERE id = v_seller);
  IF v_seller_sys = 1 THEN
    -- annuncio di un bot: l'incasso va alla tesoreria, senza commissione
    CALL _sp_move_coins(p_buyer_id, 1, v_price, 'BOT_SELL', v_asset);
    SET v_fee = 0;
  ELSE
    SET v_fee = GREATEST(CAST(fn_setting('economy.market_fee_min') AS UNSIGNED),
                         CEIL(v_price * CAST(fn_setting('economy.market_fee_pct') AS UNSIGNED) / 100));
    SET v_fee = LEAST(v_fee, v_price);
    CALL _sp_move_coins(p_buyer_id, v_seller, v_price - v_fee, 'TRADE', v_asset);
    CALL _sp_move_coins(p_buyer_id, 1, v_fee, 'FEE', v_asset);
  END IF;

  UPDATE assets SET owner_id = p_buyer_id WHERE id = v_asset;
  CALL _sp_append_event(v_asset, 'TRANSFER', v_seller, p_buyer_id, v_price);

  UPDATE market_listings SET status = 'SOLD', buyer_id = p_buyer_id, closed_at = NOW(6)
   WHERE id = p_listing_id;

  COMMIT;
  SELECT v_asset AS asset_id, v_price AS price, v_fee AS fee;
END$$

DELIMITER ;
```

### Elenco delle procedure da implementare

| Procedura | Cosa fa | Errori |
|---|---|---|
| `sp_player_get_or_create(device_hash, nickname_candidate, recovery_hash)` ✅ M0 | Trova il giocatore dal device o lo crea: `GRANT` di 100 monete + `_sp_mint` della scarpa regalo a prezzo 0. Restituisce `player_id`, `created`, `gift_asset_id` | `NICKNAME_TAKEN` / `RECOVERY_TAKEN` (il server riprova con un altro valore), `DEVICE_TAKEN` (stesso device in parallelo: il server richiama la SP) |
| `sp_player_set_avatar(player, skin, hair, hair_color, outfit)` | Solo se l'avatar non è ancora impostato. Gli indici sono validati contro `game_settings`. Resta per i chiamanti vecchi: la creazione del personaggio usa `sp_player_set_profile` | `AVATAR_ALREADY_SET`, `AVATAR_INVALID` |
| `sp_player_set_profile(player, nickname, body, skin, hair, hair_color, outfit)` ✅ 009 | Creazione del personaggio (D12): stile, aspetto e nome, una volta sola. Ricontrolla la lunghezza del nome; il formato e le parole vietate li controlla il server prima. Un nome già usato (collation `_ai_ci`: maiuscole e accenti non contano) → 1062 → `NICKNAME_TAKEN` | `AVATAR_ALREADY_SET`, `AVATAR_INVALID`, `NICKNAME_INVALID`, `NICKNAME_TAKEN` |
| `sp_player_recover(recovery_hash, device_hash)` | Associa il device al giocatore esistente | `CODE_NOT_FOUND` |
| `sp_shop_buy(player, item)` ✅ M2 | Item con `"shop"` tra le sources: `_sp_move_coins(player→1, SHOP)` + `_sp_mint(minted_by 2)` | `NOT_FOR_SALE`, `NO_FUNDS`, `INVENTORY_FULL` |
| `sp_listing_create(player, asset, price, perceived_value)` ✅ M0 | Prezzo tra `listing_min_price` e `perceived_value × listing_max_multiplier` (il valore lo passa il server, calcolato da `shared`) | `NOT_OWNER`, `ASSET_LOCKED`, `PRICE_OUT_OF_RANGE`, duplicato → `ALREADY_LISTED` |
| `sp_listing_cancel(player, listing)` ✅ M2 | | `NOT_OWNER`, `LISTING_CLOSED` |
| `sp_listing_buy(listing, buyer)` ✅ M0 | Vedi sopra | `LISTING_NOT_FOUND`, `LISTING_CLOSED`, `SELF_BUY`, `NOT_OWNER`, `ASSET_LOCKED`, `NO_FUNDS`, `INVENTORY_FULL`, `PLAYER_NOT_FOUND` |
| `sp_treasury_seed(amount)` ✅ M0 | `GRANT` iniziale della tesoreria, una sola volta (il seed è rilanciabile) | |
| `sp_bot_buy(listing, bot, max_price)` ✅ M3 | Come `listing_buy`, ma paga la tesoreria (`BOT_BUY`) e non c'è commissione. Ricontrolla `price ≤ max_price` (perceivedValue × buy_pct, dal server), la soglia di tesoreria e l'inventario del bot. Mai da account di sistema | `TREASURY_LOW`, `PRICE_OUT_OF_RANGE`, `NOT_FOR_SALE`, `INVENTORY_FULL` |
| `sp_stall_restock(item)` ✅ M3 | `_sp_mint(to 3, minted_by 3, is_fake 1)` | |
| `sp_stall_buy(player, asset)` ✅ M3 | `STALL` verso la tesoreria (`base_value × stall.price_pct_of_base`), `TRANSFER 3→player` | `NOT_FOR_SALE`, `NO_FUNDS`, `INVENTORY_FULL` |
| `sp_auth_request(player, asset)` ✅ M3 | `AUTH` verso la tesoreria. Se falso: `fake_revealed = 1`, altrimenti `auth_verified = 1`. Restituisce il verdetto. Una scarpa già verificata non si paga due volte | `NOT_OWNER`, `ASSET_LOCKED`, `ALREADY_VERIFIED`, `NO_FUNDS` |
| `sp_legend_wear(player, asset)` ✅ M3 | `LEGEND` verso la tesoreria, evento `LEGEND_IN` player→4, `locked_until = now + wear_duration_sec`, `players.legend_ready_at = now + cooldown_sec`. **È un prestito**: `owner_id` resta il giocatore (I3 lo sa) | `NOT_OWNER`, `ASSET_LOCKED`, `ALREADY_LISTED`, `LEGEND_COOLDOWN`, `LEGEND_MAXED`, `NO_FUNDS` |
| `sp_legend_return(asset)` ✅ M3 | Chiamata dallo scheduler a prestito scaduto: `LEGEND_OUT` 4→proprietario, `legend_count + 1`, `locked_until = NULL`. Idempotente | |
| `sp_drop_open(item, quantity, window_sec)` ✅ M3 | Crea il drop | |
| `sp_drop_claim(drop, player)` ✅ M3 | `DROP` verso la tesoreria, `_sp_mint(minted_by 1, drop_id)`, `sold + 1`, `assets.drop_serial = sold` | `DROP_CLOSED`, `DROP_SOLDOUT`, `DROP_ALREADY_CLAIMED`, `NO_FUNDS`, `INVENTORY_FULL` |
| `sp_bot_restock(bot, item)` ✅ M3 | `_sp_mint(to bot, minted_by 2)` | |
| `sp_chain_recover_sending()` ✅ M0 | All'avvio: `SENDING` → `PENDING` (rischio accettato: un hash notarizzato due volte) | |
| `sp_chain_claim_batch(limit, batch_id)` ✅ M0 | `UPDATE … SET SENDING, chain_batch, attempts+1 WHERE PENDING ORDER BY id LIMIT n`, poi `SELECT` del batch | |
| `sp_chain_mark_confirmed(batch_id, tx)` ✅ M0 | `CONFIRMED` + `chain_tx`. Restituisce `asset_id`, `from_id`, `to_id` per le notifiche | |
| `sp_chain_mark_failed(batch_id, error, max_attempts)` ✅ M0 | Torna `PENDING`, oppure `FAILED` oltre `max_attempts` | |
| `sp_economy_check()` ✅ M0 | Esegue gli invarianti I1–I6 e restituisce le violazioni | |
| `sp_anonymize_inactive(days)` | Per i giocatori inattivi: azzera `device_hash`, `recovery_hash` e avatar, **rimette un nickname generato al posto di quello scelto** (D12), cancella `player_devices`, imposta `anonymized_at`. Le catene restano integre | |

Nota sul calcolo del valore. Il valore percepito si calcola in **TypeScript** (`shared/valuation.ts`), non in SQL, ed è l'unica implementazione. Le SP che ne hanno bisogno (limiti di prezzo, bot) lo ricevono dal server come parametro, già calcolato sugli stessi dati letti nella transazione.

## 5. Protocollo socket

Handshake: `io(url, { auth: { deviceId } })`. Il server calcola `sha256(deviceId)` con `crypto` e risolve il giocatore.

- `deviceId` deve essere un UUID v4, altrimenti `error DEVICE_INVALID` e disconnessione.
- **Una sessione per giocatore**: una seconda scheda sostituisce la prima, che riceve `SESSION_REPLACED`.
- **Codice di recupero**: è `HMAC-SHA256(RECOVERY_SECRET, deviceId)` mappato sull'alfabeto di `player.recovery_code`. Nel DB va solo `sha256(codice)`, ma il server può sempre rimostrarlo al device che l'ha generato (`state.init.player.recoveryCode`) senza salvarlo. In produzione `RECOVERY_SECRET` è obbligatorio e non va cambiato dopo il lancio, altrimenti i codici già mostrati non tornano più.
- Ogni richiesta client → server ha un ack `{ ok: true, data } | { ok: false, code, message }`, con il messaggio già in italiano (`packages/shared/src/errors.ts`).
- I tipi degli eventi sono in `packages/shared/src/protocol.ts` (`ServerToClientEvents`, `ClientToServerEvents`) e tipizzano socket.io su entrambi i lati.

**Client → server**

| Evento | Payload |
|---|---|
| `session.recover` | `{ code }` |
| `avatar.set` | `{ body, skin, hair, hairColor, outfit, nickname }` (indici + nome). Ack `{ x, y, nickname }` con il nome salvato. Errori del nome: `NICKNAME_INVALID`, `NICKNAME_BLOCKED`, `NICKNAME_TAKEN` |
| `move.to` | `{ x, y }` |
| `emote.send` | `{ emote }` (solo emote da config) |
| `shop.list` / `shop.buy` | `{}` / `{ itemId }` |
| `market.list` | `{ cursor? }` |
| `listing.create` / `listing.cancel` / `listing.buy` | `{ assetId, price }` / `{ listingId }` / `{ listingId }` |
| `stall.list` / `stall.buy` | `{}` / `{ assetId }` |
| `auth.request` | `{ assetId }` |
| `legend.request` | `{ assetId }` |
| `drop.claim` / `drop.state` | `{ dropId }` / `{}` |
| `passport.get` | `{ assetId }` |
| `leaderboard.get` | `{}` |

**Server → client**

| Evento | Payload |
|---|---|
| `state.init` | giocatore, inventario, saldo, valore armadio, stato prima run, config pubblica, NPC |
| `world.players` | cambi nel raggio: partenza (posizione + **percorso**), arrivo, ingresso/uscita dal raggio, profilo alla prima apparizione. Il server simula a `tick_hz` ma non manda una posizione a ogni tick: il client fa camminare gli altri lungo il percorso con la stessa `advance()` di `shared`. Con 100 giocatori nella piazza la banda scende di circa 4 volte rispetto ai delta a 10 Hz |
| `world.emote` | `{ playerId, emote }` |
| `wallet.updated` | `{ coins, wardrobeValue }` |
| `inventory.updated` | `{ coins, wardrobeValue, inventory }` dopo ogni azione economica, a chi l'ha fatta e alla controparte (il venditore riceve il suo appena qualcuno compra) |
| `asset.updated` | `{ assetId }`: il passaporto ha un anello nuovo o un annuncio aperto/chiuso. Va alla room `asset:<id>` (chi ha il passaporto aperto), che ricarica con `passport.get` |
| `asset.certified` | `{ assetId, eventId, txHash, explorerUrl }`, alla room `asset:<id>` e ai giocatori coinvolti nell'anello |
| `market.updated` | `()`: la bacheca è cambiata; chi la sta guardando ricarica la prima pagina con `market.list` |
| `drop.announce` | `{ dropId, itemId, quantity, sold, price, closesAt }` a tutti; `state.init.drop` dà lo stesso stato a chi entra dopo |
| `drop.update` / `drop.closed` | `{ dropId, sold }` / `{ dropId, nextAt }` |
| `stall.updated` | `()`: il banco di Tony è cambiato (rifornimento o vendita) |
| `legend.returned` | `{ assetId }` al proprietario: MC Suola ha restituito la scarpa |
| `run.beat` | `{ beatId }` |
| `run.end` | dati del reveal (§12 del GAME_DESIGN) |
| `error` | `{ code, message }` (messaggio in italiano da mappa codici) |

`passport.get` fa entrare il socket nella room `asset:<id>` (e uscire da quella del passaporto precedente). Così gli avvisi di un asset vanno solo a chi lo sta guardando, non a tutti.

Il passaporto non espone mai `is_fake`: `status` è `fake` solo se il falso è stato smascherato. Gli orari (`events[].at`, `lockedUntil`) viaggiano come epoch ms, calcolati con `UNIX_TIMESTAMP` lato DB. Così non dipendono dal fuso del server né da quello del telefono, e Safari non deve leggere date in formato MySQL.

Rate limit: `player.rate_limit_actions_per_sec` per socket. Oltre la soglia il server risponde `BUSY` e scarta l'azione.

## 6. Certificazione on-chain

```ts
// apps/server/src/chain/chain-notary.ts
export interface NotarizeItem { eventId: number; hash: string }
export interface ChainNotary {
  readonly network: string;
  /** batchId = UUID del batch nell'outbox: per Commercio è anche il document_uuid. */
  notarizeBatch(items: NotarizeItem[], batchId: string): Promise<{ txHash: string }>;
  explorerUrl(txHash: string): string;
}
export const CHAIN_NOTARY = Symbol('CHAIN_NOTARY');
```

`MockNotary`, il default in sviluppo e finché le credenziali commercio.app (D11) non sono nel `.env`: aspetta un ritardo casuale tra `chain.mock.min_delay_ms` e `max_delay_ms` e restituisce `mock-<sha256 del batch>`. Permette di sviluppare e provare tutta la UX senza testnet.

```ts
// apps/server/src/chain/chain.worker.ts
@Injectable()
export class ChainWorker implements OnModuleInit {
  private running = false;

  constructor(
    private readonly db: DbService,
    @Inject(CHAIN_NOTARY) private readonly notary: ChainNotary,
    private readonly gateway: GameGateway,
    private readonly cfg: GameConfigService,
  ) {}

  async onModuleInit() {
    await this.db.call('sp_chain_recover_sending');
  }

  // intervallo = chain.batch_interval_ms (registrato via SchedulerRegistry se va reso dinamico)
  @Interval(2000)
  async tick() {
    if (this.running || !this.cfg.chain.enabled) return;
    this.running = true;
    const batchId = randomUUID();
    try {
      const rows = await this.db.call<{ id: number; hash: string }>(
        'sp_chain_claim_batch', [this.cfg.chain.max_items_per_batch, batchId]);
      if (!rows.length) return;
      try {
        const { txHash } = await this.notary.notarizeBatch(rows.map(r => ({ eventId: r.id, hash: r.hash })), batchId);
        const done = await this.db.call<CertifiedRow>('sp_chain_mark_confirmed', [batchId, txHash]);
        this.gateway.notifyCertified(done, this.notary.explorerUrl(txHash));
      } catch (err) {
        await this.db.call('sp_chain_mark_failed',
          [batchId, String(err).slice(0, 255), this.cfg.chain.max_attempts]);
      }
    } finally {
      this.running = false;
    }
  }
}
```

**Cosa va on-chain**: solo `{ v: 1, app: "sneaker-passport", events: [[eventId, hash], …] }`. Niente nickname, niente device, niente id giocatore. L'`eventId` è un numero interno senza significato fuori dal DB. Questo punto è importante perché la chain è immutabile e gli utenti sono minorenni.

**Implementazione testnet: Commercio.network** (D1, chiusa il 14/10), tramite le **API di commercio.app**, come fa già `@mvl/commercio-network` nel repo `upthere-it/microservices` (es. `ms-carma-advisory`). Niente wallet, mnemonic o fee da gestire in proprio: firma e CCC li gestisce la piattaforma sull'account Upthere.

| | |
|---|---|
| Ambiente | `dev-api.commercio.app/v1` scrive sulla **testnet** (`commercio-testnet11k`, nodo verificato il 14/10); `api.commercio.app/v1` scrive su mainnet |
| Autenticazione | Keycloak `devlogin.commercio.app`, realm `commercio`, client `dev.commercio.app`, grant `password`. Variabili `CN_USERNAME` e `CN_PASSWORD`, solo nel `.env` |
| Notarizzazione | `POST /sharedoc/process` con `hash` (sha-256 hex), `hash_algorithm`, `document_uuid`, `content_uri`, `metadata.{content_uri, schema.{uri, version}}`, `recipients` (`CN_RECIPIENT_ADDRESS`, prefisso `did:com:`) e `back_url` facoltativo. Risponde 202 con un `process_id` |
| Esito | `GET /sharedoc/process/{process_id}` → `status` (`enqueued` … `success`/`failure`) e `doc_tx_hash`; oppure `POST` sul `back_url` quando ha finito. `GET /sharedoc/{document_uuid}` dà 404 finché la tx non è indicizzata |
| Explorer | `https://testnet.commercio.network/transactions/detail/{txHash}`, lo stesso formato usato in `ms-carma-advisory` |

**Uso nel gioco** (`apps/server/src/chain/commercio-notary.ts`, si attiva con `chain.notary = "commercio"`; i parametri sono in `chain.commercio`): porting minimo delle chiamate di `@mvl/commercio-network`, con `fetch` nativo e `crypto.randomUUID`, senza axios/qs/uuid. Le stesse variabili d'ambiente.
- **Per batch** (D10, proposta): un `sharedoc` per batch con `hash = sha256(notaryPayload(batch))`, cioè il pattern "hash cumulativo" già usato in Carma. `content_uri = https://civitek.upthere.it/api/chain/batch/<document_uuid>` restituisce `{ v, app, events: [[eventId, hash], …] }`: chiunque può ricalcolare l'hash del batch e confrontarlo con il checksum on-chain. Rientra nell'interfaccia `ChainNotary` attuale (un `txHash` per batch) senza toccare il worker.
- **Per evento** (alternativa): un `sharedoc` per anello, con checksum = hash dell'anello. È più diretto da mostrare ai ragazzi, ma fa 1–1,5 chiamate API/s al picco; limiti e costi dell'account vanno verificati con Commercio.
- `notarizeBatch` invia il processo e poi interroga `/sharedoc/process/{id}` finché non arriva `doc_tx_hash`, con timeout. Un solo batch in volo alla volta: durante l'attesa gli eventi si accumulano nel batch successivo. In produzione si può aggiungere il `back_url` (`/api/chain/commercio-callback`) per non dipendere solo dal polling.
- Latenza attesa ⏳ → ✅: coda di commercio.app + un blocco (~5 s) + indicizzazione. Va misurata alla prima prova.
- `GET /api/chain/batch/:batchId` (pubblico) è il `content_uri`. Restituisce `{ v, app, batchId, events, sha256, network, txHash, explorerUrl }`: `sha256` è il checksum on-chain, ricalcolabile dagli `events`.
- Il `batchId` del worker (UUID v4) è anche il `document_uuid` su Commercio.

## 7. Client

- **device_id**:
  ```ts
  const KEY = 'sp_device_id';
  export function getDeviceId(): string {
    let id = localStorage.getItem(KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
    return id;
  }
  ```
  `crypto.randomUUID` richiede HTTPS (secure context) e iOS 15.4+. Serve un fallback con `crypto.getRandomValues`. Se localStorage non è disponibile (alcune modalità private), si tiene il valore in memoria e si mostra subito il codice di recupero.
- **Phaser**:
  - scene `Boot` (carica tutto da `assets/manifest.json`: circa 330 KB), `Avatar`, `Village`;
  - camera che segue l'avatar, `pixelArt: true`;
  - gli altri giocatori camminano lungo il percorso ricevuto (stessa `findPath`/`advance` del server); il proprio avatar parte subito in locale e si riallinea solo oltre `world.reconcile_px`.
- **UI**:
  - overlay HTML/CSS sopra il canvas: HUD, inventario, passaporto, bacheca, pannelli NPC, reveal;
  - font leggibili, bottoni da almeno 44 px.
- **Pannelli del mercato** (M2, `apps/client/src/ui/`):
  - fogli dal basso impilabili (`panel.ts`): il passaporto si apre sopra la bacheca o il negozio, si chiude con ×, tap fuori o Esc;
  - `store.ts` tiene saldo e scarpe **come li manda il server** e avvisa i pannelli aperti (`inventory`, `market`, `asset`). Ogni pannello si disiscrive alla chiusura;
  - in bacheca si compra **solo dal passaporto**, così la storia si guarda sempre prima di pagare (GAME_DESIGN §7);
  - dopo un acquisto al Negozio si apre il passaporto, e l'anello passa da ⏳ a ✅ davanti al giocatore;
  - i bottoni d'azione restano disabilitati finché il server non risponde: niente doppi acquisti col doppio tap;
  - le icone scarpa sono solo a 32 o 64 px CSS, così la pixel art scala di un fattore intero.
- **Loop di gioco** (M3, server): bot (`economy.bots.tick_sec`), rifornimento di Tony (`stall.restock_sec`), drop (orologio di mondo: multipli di `drops.interval_sec` dall'epoch, uguali per tutti), ritorno da MC Suola (ogni secondo). Partono subito all'avvio e poi a intervallo. Inoltrano ai client tramite `GameEventsService`. Nei test sono spenti (`GAME_LOOPS=off`) e si chiamano i loro `tick()`.
- **Dati degli item**: il client importa `data/game_items.json` attraverso il plugin `sp-client-items` di `vite.config.ts`, che tiene solo i campi da mostrare. `reference_ids` (modelli reali), valori base e pesi dei drop non entrano nel bundle.
- **Riconnessione**: socket.io con riconnessione automatica; a ogni riconnessione il server rimanda `state.init`.

## 8. API REST pubbliche

| Endpoint | Uso |
|---|---|
| `GET /api/passport/:publicId` | Passaporto in sola lettura, per la pagina `/p/:publicId` e la card condivisibile |
| `GET /api/screen` | Ultimi eventi certificati e classifica, per la pagina `/schermo` |
| `GET /api/health` | DB raggiungibile, lag del worker chain, giocatori online |

## 9. Deploy

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sneaker-passport',
    cwd: './apps/server',
    script: 'dist/main.js',
    exec_mode: 'fork',     // NON cluster: stato socket in memoria
    instances: 1,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production' },
  }],
};
```

nginx su **civitek.upthere.it** (D3):
- HTTPS obbligatorio (serve anche per `crypto.randomUUID`), certificato Let's Encrypt;
- proxy di `/socket.io/` con gli header `Upgrade`/`Connection`;
- gzip/brotli e cache lunga sugli asset con hash nel nome;
- log di accesso con retention breve (7 giorni).

## 10. Privacy (implementazione)

- Nessun dato personale raccolto. Il `device_id` è salvato solo come hash.
- Il codice di recupero è salvato solo come hash.
- Job giornaliero `sp_anonymize_inactive(player.inactivity_anonymize_days)`.
- Nessun analytics, cookie di terze parti, font o CDN esterni a runtime: tutto è servito dal nostro dominio.
- Pagina `/privacy` con un testo breve da validare (D5).
- On-chain solo hash (§6).
