-- Schema di Sneaker Passport (ARCHITECTURE §3). MySQL >= 8.0.16 (servono i CHECK).
-- Il database va creato con:
--   CREATE DATABASE <nome> CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- (le stored procedure ereditano la collation del database: se è diversa da quella delle tabelle,
--  i confronti tra parametri e colonne falliscono con "Illegal mix of collations").

SET NAMES utf8mb4;

CREATE TABLE game_settings (            -- config appiattita da game_config.json (chiavi "economy.market_fee_pct")
  name  VARCHAR(96)  NOT NULL PRIMARY KEY,
  value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE items (                    -- seed da game_items.json
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  tier        ENUM('base','trend','hype','limited','upthere') NOT NULL,
  rarity      ENUM('common','popular','hyped','limited') NOT NULL,
  base_value  INT NOT NULL,
  fakeable    TINYINT(1) NOT NULL DEFAULT 0,
  drop_weight INT NOT NULL DEFAULT 0,
  sources     JSON NOT NULL,
  CONSTRAINT ck_items_value CHECK (base_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE item_counters (            -- una riga per item già dal seed: niente INSERT concorrenti in _sp_mint
  item_id     VARCHAR(64) NOT NULL PRIMARY KEY,
  last_serial INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  AUTO_INCREMENT=1000;                           -- 1–999 riservati agli account di sistema e ai bot

CREATE TABLE player_devices (           -- un giocatore può avere più device (codice di recupero)
  device_hash CHAR(64) NOT NULL PRIMARY KEY,
  player_id   BIGINT NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_pd_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE drops (
  id         BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id    VARCHAR(64) NOT NULL,
  quantity   INT NOT NULL,
  sold       INT NOT NULL DEFAULT 0,
  opens_at   DATETIME(6) NOT NULL,
  closes_at  DATETIME(6) NOT NULL,
  CONSTRAINT fk_drops_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT ck_drops_sold CHECK (sold <= quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  head_hash     CHAR(64) NULL,                 -- hash dell'ultimo anello: _sp_append_event ci collega il prossimo
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_assets_public (public_id),
  UNIQUE KEY uq_assets_item_serial (item_id, serial, is_fake),
  KEY ix_assets_owner (owner_id),
  CONSTRAINT fk_assets_item  FOREIGN KEY (item_id)  REFERENCES items(id),
  CONSTRAINT fk_assets_owner FOREIGN KEY (owner_id) REFERENCES players(id),
  CONSTRAINT fk_assets_drop  FOREIGN KEY (drop_id)  REFERENCES drops(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE drop_claims (
  drop_id   BIGINT NOT NULL,
  player_id BIGINT NOT NULL,
  asset_id  BIGINT NOT NULL,
  PRIMARY KEY (drop_id, player_id),            -- 1 per giocatore per drop
  CONSTRAINT fk_dc_drop   FOREIGN KEY (drop_id)   REFERENCES drops(id),
  CONSTRAINT fk_dc_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_dc_asset  FOREIGN KEY (asset_id)  REFERENCES assets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
