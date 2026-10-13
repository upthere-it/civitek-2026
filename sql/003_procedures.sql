-- Procedure interne e pubbliche del nucleo economico (ARCHITECTURE §4).
--
-- Regole:
-- - le `sp_*` pubbliche aprono e chiudono la transazione (EXIT HANDLER → ROLLBACK; RESIGNAL);
-- - le `_sp_*` interne non aprono transazioni: il chiamante ha già preso i lock;
-- - ordine di lock globale: market_listings / drops → players (id crescente, tesoreria inclusa) → assets;
-- - errori: SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UPPER_SNAKE'.
--
-- Letture dentro le procedure (MySQL 8, verificato con performance_schema.data_locks):
-- - `SET v = (SELECT …)` è una lettura CON lock condiviso, anche con binlog ROW. Su un range o su una
--   riga che non c'è prende anche i gap lock: due transazioni che poi inseriscono nello stesso gap vanno
--   in deadlock (è successo con i mint concorrenti dei nuovi giocatori). Va bene solo per PK/unique su
--   righe che esistono, meglio se già bloccate da noi;
-- - `SELECT agg(…) INTO v` è una lettura consistente senza lock e restituisce sempre una riga (niente
--   warning "no data"). Vede lo snapshot creato dalla PRIMA lettura consistente della transazione: in una
--   sp_* va fatta dopo aver preso i lock, mai prima.

DROP PROCEDURE IF EXISTS _sp_append_event;
DROP PROCEDURE IF EXISTS _sp_move_coins;
DROP PROCEDURE IF EXISTS _sp_mint;
DROP PROCEDURE IF EXISTS sp_treasury_seed;
DROP PROCEDURE IF EXISTS sp_player_get_or_create;
DROP PROCEDURE IF EXISTS sp_listing_create;
DROP PROCEDURE IF EXISTS sp_listing_buy;

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

  -- Testa della catena dalla riga dell'asset, che il chiamante ha già bloccato (o appena inserito):
  -- lock sulla PK, nessun range su asset_events.
  SELECT head_hash INTO v_prev FROM assets WHERE id = p_asset_id FOR UPDATE;

  SET v_hash = SHA2(CONCAT_WS('|', p_asset_id, p_event, IFNULL(p_from, ''), p_to, p_price,
                              IFNULL(v_prev, ''), DATE_FORMAT(v_now, '%Y-%m-%d %H:%i:%s.%f')), 256);

  -- regola: ogni MINT autentico + ogni evento (non FAKE_MINT) con almeno un umano
  IF p_event = 'MINT' THEN
    SET v_status = 'PENDING';
  ELSEIF p_event <> 'FAKE_MINT' THEN
    SELECT COUNT(*) INTO v_humans FROM players WHERE id IN (p_from, p_to) AND is_system = 0;  -- is_system non cambia mai
    IF v_humans > 0 THEN SET v_status = 'PENDING'; END IF;
  END IF;

  INSERT INTO asset_events (asset_id, event, from_id, to_id, price, prev_hash, hash, created_at, chain_status)
  VALUES (p_asset_id, p_event, p_from, p_to, p_price, v_prev, v_hash, v_now, v_status);
  UPDATE assets SET head_hash = v_hash WHERE id = p_asset_id;
END$$

-- Sposta monete e scrive il ledger. Il CHECK coins >= 0 blocca i saldi negativi.
-- p_from NULL = emissione, ammessa solo come GRANT (I1: la massa cresce solo con i GRANT).
-- Se uno dei due giocatori non esiste la procedura fallisce: niente monete create dal nulla.
CREATE PROCEDURE _sp_move_coins(
  IN p_from BIGINT, IN p_to BIGINT, IN p_amount INT, IN p_reason VARCHAR(16), IN p_ref BIGINT)
BEGIN
  IF p_amount < 0 OR (p_from IS NULL AND p_reason <> 'GRANT') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_INVALID';
  END IF;

  IF p_amount > 0 THEN
    IF p_from IS NOT NULL THEN
      UPDATE players SET coins = coins - p_amount WHERE id = p_from;
      IF ROW_COUNT() <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
    END IF;
    UPDATE players SET coins = coins + p_amount WHERE id = p_to;
    IF ROW_COUNT() <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
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

-- Dotazione iniziale della tesoreria. Idempotente: il seed si può rilanciare.
CREATE PROCEDURE sp_treasury_seed(IN p_amount INT)
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_n INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);

  START TRANSACTION;
  SELECT COUNT(*) INTO v_n FROM players WHERE id = v_treasury FOR UPDATE;
  IF v_n = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM coin_ledger WHERE from_id IS NULL AND to_id = v_treasury) THEN
    CALL _sp_move_coins(NULL, v_treasury, p_amount, 'GRANT', NULL);
  END IF;
  COMMIT;
END$$

-- Trova il giocatore dal device o lo crea: GRANT di player.start_coins + scarpa regalo (MINT dal
-- Negozio a prezzo 0). Nickname e codice di recupero li genera il server: in caso di collisione
-- riceve NICKNAME_TAKEN / RECOVERY_TAKEN e riprova con un altro valore. DEVICE_TAKEN = due
-- richieste simultanee dallo stesso device: il server richiama la procedura e trova il giocatore.
CREATE PROCEDURE sp_player_get_or_create(
  IN p_device_hash CHAR(64), IN p_nickname VARCHAR(32), IN p_recovery_hash CHAR(64))
BEGIN
  DECLARE v_id      BIGINT;
  DECLARE v_created TINYINT DEFAULT 0;
  DECLARE v_pool    VARCHAR(255);
  DECLARE v_item    VARCHAR(64);
  DECLARE v_asset   BIGINT;
  DECLARE v_msg     TEXT;
  DECLARE EXIT HANDLER FOR 1062
  BEGIN
    GET DIAGNOSTICS CONDITION 1 v_msg = MESSAGE_TEXT;
    ROLLBACK;
    IF v_msg LIKE '%uq_players_nickname%' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NICKNAME_TAKEN';
    ELSEIF v_msg LIKE '%uq_players_recovery%' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECOVERY_TAKEN';
    ELSE
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEVICE_TAKEN';
    END IF;
  END;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  -- lettura senza lock: con SET (SELECT) un device nuovo prenderebbe un gap lock e le registrazioni
  -- simultanee al QR andrebbero in deadlock. Lo stesso device in parallelo → 1062 → DEVICE_TAKEN.
  SELECT MAX(player_id) INTO v_id FROM player_devices WHERE device_hash = p_device_hash;

  IF v_id IS NULL THEN
    INSERT INTO players (device_hash, nickname, recovery_hash)
    VALUES (p_device_hash, p_nickname, p_recovery_hash);
    SET v_id = LAST_INSERT_ID();
    INSERT INTO player_devices (device_hash, player_id) VALUES (p_device_hash, v_id);

    CALL _sp_move_coins(NULL, v_id, CAST(fn_setting('player.start_coins') AS UNSIGNED), 'GRANT', NULL);

    SET v_pool = fn_setting('player.starter_item_pool');
    SET v_item = JSON_UNQUOTE(JSON_EXTRACT(v_pool, CONCAT('$[', FLOOR(RAND() * JSON_LENGTH(v_pool)), ']')));
    CALL _sp_mint(v_item, v_id, CAST(fn_setting('economy.system_players.shop') AS UNSIGNED), 0, 0, NULL, v_asset);
    SET v_created = 1;
  ELSE
    UPDATE players SET last_seen_at = NOW(6) WHERE id = v_id;
  END IF;

  COMMIT;
  SELECT v_id AS player_id, v_created AS created, v_asset AS gift_asset_id;
END$$

-- Mette in bacheca un asset. p_perceived è il valore percepito calcolato dal server con
-- perceivedValue() (packages/shared): il prezzo deve stare tra listing_min_price e
-- valore × listing_max_multiplier.
-- Lock: solo l'asset, poi l'INSERT. Non incrocia sp_listing_buy (annuncio → giocatori → asset)
-- perché l'unico record di market_listings che può collidere (annuncio OPEN dello stesso asset)
-- fa scattare il vincolo unico, mappato su ALREADY_LISTED.
CREATE PROCEDURE sp_listing_create(
  IN p_player BIGINT, IN p_asset BIGINT, IN p_price INT, IN p_perceived INT)
BEGIN
  DECLARE v_owner  BIGINT;
  DECLARE v_locked DATETIME(6);
  DECLARE v_min    INT;
  DECLARE v_max    INT;
  DECLARE v_id     BIGINT;
  DECLARE EXIT HANDLER FOR 1062 BEGIN ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALREADY_LISTED'; END;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT owner_id, locked_until INTO v_owner, v_locked FROM assets WHERE id = p_asset FOR UPDATE;
  IF v_owner IS NULL OR v_owner <> p_player THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  IF v_locked IS NOT NULL AND v_locked > NOW(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ASSET_LOCKED'; END IF;

  SET v_min = CAST(fn_setting('economy.listing_min_price') AS UNSIGNED);
  SET v_max = GREATEST(v_min, FLOOR(p_perceived * CAST(fn_setting('economy.listing_max_multiplier') AS DECIMAL(10,4))));
  IF p_price IS NULL OR p_price < v_min OR p_price > v_max THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PRICE_OUT_OF_RANGE';
  END IF;

  INSERT INTO market_listings (asset_id, seller_id, price) VALUES (p_asset, p_player, p_price);
  SET v_id = LAST_INSERT_ID();

  COMMIT;
  SELECT v_id AS listing_id;
END$$

-- Acquisto da bacheca (ARCHITECTURE §4, procedura di riferimento).
CREATE PROCEDURE sp_listing_buy(IN p_listing_id BIGINT, IN p_buyer_id BIGINT)
BEGIN
  DECLARE v_asset BIGINT; DECLARE v_seller BIGINT; DECLARE v_price INT; DECLARE v_status VARCHAR(10);
  DECLARE v_owner BIGINT; DECLARE v_locked DATETIME(6); DECLARE v_seller_sys TINYINT;
  DECLARE v_coins INT; DECLARE v_fee INT; DECLARE v_n INT; DECLARE v_inv INT;
  DECLARE v_treasury BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);

  START TRANSACTION;

  SELECT asset_id, seller_id, price, status INTO v_asset, v_seller, v_price, v_status
    FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_status IS NULL     THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_NOT_FOUND'; END IF;
  IF v_status <> 'OPEN'   THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_CLOSED';    END IF;
  IF v_seller = p_buyer_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SELF_BUY';        END IF;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, v_seller, p_buyer_id) FOR UPDATE;

  SELECT owner_id, locked_until INTO v_owner, v_locked FROM assets WHERE id = v_asset FOR UPDATE;
  IF v_owner <> v_seller THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  IF v_locked IS NOT NULL AND v_locked > NOW(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ASSET_LOCKED'; END IF;

  SET v_coins = (SELECT coins FROM players WHERE id = p_buyer_id);
  IF v_coins IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  IF v_coins < v_price THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  -- conteggio senza lock (dopo aver bloccato il compratore: ogni SP che gli dà una scarpa blocca la sua riga)
  SELECT COUNT(*) INTO v_inv FROM assets WHERE owner_id = p_buyer_id;
  IF v_inv >= CAST(fn_setting('player.max_inventory') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_FULL';
  END IF;

  SET v_seller_sys = (SELECT is_system FROM players WHERE id = v_seller);
  IF v_seller_sys = 1 THEN
    -- annuncio di un bot: l'incasso va alla tesoreria, senza commissione
    CALL _sp_move_coins(p_buyer_id, v_treasury, v_price, 'BOT_SELL', v_asset);
    SET v_fee = 0;
  ELSE
    SET v_fee = GREATEST(CAST(fn_setting('economy.market_fee_min') AS UNSIGNED),
                         CEIL(v_price * CAST(fn_setting('economy.market_fee_pct') AS UNSIGNED) / 100));
    SET v_fee = LEAST(v_fee, v_price);
    CALL _sp_move_coins(p_buyer_id, v_seller, v_price - v_fee, 'TRADE', v_asset);
    CALL _sp_move_coins(p_buyer_id, v_treasury, v_fee, 'FEE', v_asset);
  END IF;

  UPDATE assets SET owner_id = p_buyer_id WHERE id = v_asset;
  CALL _sp_append_event(v_asset, 'TRANSFER', v_seller, p_buyer_id, v_price);

  UPDATE market_listings SET status = 'SOLD', buyer_id = p_buyer_id, closed_at = NOW(6)
   WHERE id = p_listing_id;

  COMMIT;
  SELECT v_asset AS asset_id, v_seller AS seller_id, v_price AS price, v_fee AS fee;
END$$

DELIMITER ;
