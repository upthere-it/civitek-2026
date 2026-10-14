-- Le meccaniche del messaggio (M3): Tony Affari e i falsi, Dott.ssa Hash, MC Suola, drop della Banca, bot.
-- Ordine dei lock: market_listings / drops → players (id crescente) → assets.
-- MC Suola è un PRESTITO: la proprietà resta al giocatore (assets.owner_id), la catena registra la custodia
-- con LEGEND_IN (giocatore → MC Suola) e LEGEND_OUT (MC Suola → giocatore). assets.locked_until NOT NULL
-- vuol dire "la scarpa è da MC Suola"; sp_legend_return la azzera.

ALTER TABLE players ADD COLUMN legend_ready_at DATETIME(6) NULL AFTER first_run_completed_at;

DROP PROCEDURE IF EXISTS sp_stall_restock;
DROP PROCEDURE IF EXISTS sp_stall_buy;
DROP PROCEDURE IF EXISTS sp_auth_request;
DROP PROCEDURE IF EXISTS sp_legend_wear;
DROP PROCEDURE IF EXISTS sp_legend_return;
DROP PROCEDURE IF EXISTS sp_drop_open;
DROP PROCEDURE IF EXISTS sp_drop_claim;
DROP PROCEDURE IF EXISTS sp_bot_restock;
DROP PROCEDURE IF EXISTS sp_bot_buy;
DROP PROCEDURE IF EXISTS sp_economy_check;

DELIMITER $$

-- Tony Affari conia un falso di un item "fakeable" (FAKE_MINT, minted_by = bancarella). Il server decide
-- quando (restock_sec) e quanti (max_fakes_on_sale).
CREATE PROCEDURE sp_stall_restock(IN p_item VARCHAR(64))
BEGIN
  DECLARE v_stall    BIGINT;
  DECLARE v_fakeable TINYINT;
  DECLARE v_asset    BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_stall = CAST(fn_setting('economy.system_players.stall') AS UNSIGNED);

  START TRANSACTION;
  SELECT MAX(fakeable) INTO v_fakeable FROM items WHERE id = p_item;
  IF v_fakeable IS NULL OR v_fakeable <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOR_SALE'; END IF;
  CALL _sp_mint(p_item, v_stall, v_stall, 1, 0, NULL, v_asset);
  COMMIT;
  SELECT v_asset AS asset_id;
END$$

-- Compra da Tony Affari una scarpa della bancarella a base_value × stall.price_pct_of_base: monete alla
-- tesoreria (STALL), TRANSFER bancarella → giocatore.
CREATE PROCEDURE sp_stall_buy(IN p_player BIGINT, IN p_asset BIGINT)
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_stall    BIGINT;
  DECLARE v_n        INT;
  DECLARE v_coins    INT;
  DECLARE v_system   TINYINT;
  DECLARE v_owner    BIGINT;
  DECLARE v_item     VARCHAR(64);
  DECLARE v_price    INT;
  DECLARE v_inv      INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);
  SET v_stall    = CAST(fn_setting('economy.system_players.stall') AS UNSIGNED);

  START TRANSACTION;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, p_player) FOR UPDATE;
  SELECT owner_id, item_id INTO v_owner, v_item FROM assets WHERE id = p_asset FOR UPDATE;
  IF v_owner IS NULL OR v_owner <> v_stall THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOR_SALE'; END IF;

  SELECT COUNT(*), MAX(coins), MAX(is_system) INTO v_n, v_coins, v_system FROM players WHERE id = p_player;
  IF v_n = 0 OR v_system = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;

  SELECT GREATEST(1, ROUND(MAX(base_value) * CAST(fn_setting('economy.stall.price_pct_of_base') AS DECIMAL(10,4))))
    INTO v_price FROM items WHERE id = v_item;
  IF v_coins < v_price THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  SELECT COUNT(*) INTO v_inv FROM assets WHERE owner_id = p_player;
  IF v_inv >= CAST(fn_setting('player.max_inventory') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_FULL';
  END IF;

  CALL _sp_move_coins(p_player, v_treasury, v_price, 'STALL', p_asset);
  UPDATE assets SET owner_id = p_player WHERE id = p_asset;
  CALL _sp_append_event(p_asset, 'TRANSFER', v_stall, p_player, v_price);

  COMMIT;
  SELECT p_asset AS asset_id, v_price AS price;
END$$

-- Dott.ssa Hash: per auth_cost verifica una scarpa del giocatore. Falsa → fake_revealed (valore 2),
-- autentica → auth_verified (badge ✅). Una scarpa già verificata non si paga due volte: ALREADY_VERIFIED.
CREATE PROCEDURE sp_auth_request(IN p_player BIGINT, IN p_asset BIGINT)
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_n        INT;
  DECLARE v_coins    INT;
  DECLARE v_cost     INT;
  DECLARE v_owner    BIGINT;
  DECLARE v_locked   DATETIME(6);
  DECLARE v_fake     TINYINT;
  DECLARE v_revealed TINYINT;
  DECLARE v_verified TINYINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);
  SET v_cost     = CAST(fn_setting('economy.auth_cost') AS UNSIGNED);

  START TRANSACTION;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, p_player) FOR UPDATE;
  SELECT owner_id, locked_until, is_fake, fake_revealed, auth_verified
    INTO v_owner, v_locked, v_fake, v_revealed, v_verified
    FROM assets WHERE id = p_asset FOR UPDATE;
  IF v_owner IS NULL OR v_owner <> p_player THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  IF v_locked IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ASSET_LOCKED'; END IF;
  IF v_revealed = 1 OR v_verified = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALREADY_VERIFIED'; END IF;

  SELECT MAX(coins) INTO v_coins FROM players WHERE id = p_player;
  IF v_coins < v_cost THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  CALL _sp_move_coins(p_player, v_treasury, v_cost, 'AUTH', p_asset);
  IF v_fake = 1 THEN
    UPDATE assets SET fake_revealed = 1 WHERE id = p_asset;
  ELSE
    UPDATE assets SET auth_verified = 1 WHERE id = p_asset;
  END IF;

  COMMIT;
  SELECT p_asset AS asset_id, IF(v_fake = 1, 'fake', 'genuine') AS verdict, v_cost AS cost;
END$$

-- MC Suola indossa la scarpa per legend.wear_duration_sec: LEGEND (monete alla tesoreria), LEGEND_IN
-- giocatore → MC Suola, scarpa bloccata. Cooldown per giocatore, bonus al massimo legend_max_counted volte.
CREATE PROCEDURE sp_legend_wear(IN p_player BIGINT, IN p_asset BIGINT)
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_legend   BIGINT;
  DECLARE v_n        INT;
  DECLARE v_coins    INT;
  DECLARE v_system   TINYINT;
  DECLARE v_ready    DATETIME(6);
  DECLARE v_cost     INT;
  DECLARE v_owner    BIGINT;
  DECLARE v_locked   DATETIME(6);
  DECLARE v_count    INT;
  DECLARE v_listed   INT;
  DECLARE v_until    DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);
  SET v_legend   = CAST(fn_setting('economy.system_players.legend') AS UNSIGNED);
  SET v_cost     = CAST(fn_setting('economy.legend.cost') AS UNSIGNED);

  START TRANSACTION;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, p_player) FOR UPDATE;
  SELECT owner_id, locked_until, legend_count INTO v_owner, v_locked, v_count FROM assets WHERE id = p_asset FOR UPDATE;
  IF v_owner IS NULL OR v_owner <> p_player THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  -- NOT NULL e non "> NOW": finché sp_legend_return non l'ha restituita, la scarpa è ancora da MC Suola
  IF v_locked IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ASSET_LOCKED'; END IF;

  SELECT COUNT(*) INTO v_listed FROM market_listings WHERE asset_id = p_asset AND status = 'OPEN';
  IF v_listed > 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ALREADY_LISTED'; END IF;
  IF v_count >= CAST(fn_setting('valuation.legend_max_counted') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEGEND_MAXED';
  END IF;

  SELECT COUNT(*), MAX(coins), MAX(is_system), MAX(legend_ready_at) INTO v_n, v_coins, v_system, v_ready
    FROM players WHERE id = p_player;
  IF v_n = 0 OR v_system = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  IF v_ready IS NOT NULL AND v_ready > NOW(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEGEND_COOLDOWN'; END IF;
  IF v_coins < v_cost THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  SET v_until = NOW(6) + INTERVAL CAST(fn_setting('economy.legend.wear_duration_sec') AS UNSIGNED) SECOND;
  CALL _sp_move_coins(p_player, v_treasury, v_cost, 'LEGEND', p_asset);
  UPDATE players SET legend_ready_at = NOW(6) + INTERVAL CAST(fn_setting('economy.legend.cooldown_sec') AS UNSIGNED) SECOND
   WHERE id = p_player;
  UPDATE assets SET locked_until = v_until WHERE id = p_asset;
  CALL _sp_append_event(p_asset, 'LEGEND_IN', p_player, v_legend, 0);

  COMMIT;
  SELECT p_asset AS asset_id, ROUND(UNIX_TIMESTAMP(v_until) * 1000) AS until_ms;
END$$

-- MC Suola restituisce la scarpa (chiamata dallo scheduler a prestito scaduto): LEGEND_OUT, legend_count + 1,
-- sblocco. Idempotente: se la scarpa non è da MC Suola o il prestito non è finito, non fa niente.
CREATE PROCEDURE sp_legend_return(IN p_asset BIGINT)
BEGIN
  DECLARE v_legend BIGINT;
  DECLARE v_owner  BIGINT;
  DECLARE v_locked DATETIME(6);
  DECLARE v_done   TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_legend = CAST(fn_setting('economy.system_players.legend') AS UNSIGNED);

  START TRANSACTION;
  SELECT owner_id, locked_until INTO v_owner, v_locked FROM assets WHERE id = p_asset FOR UPDATE;
  IF v_locked IS NOT NULL AND v_locked <= NOW(6) THEN
    UPDATE assets SET locked_until = NULL, legend_count = legend_count + 1 WHERE id = p_asset;
    CALL _sp_append_event(p_asset, 'LEGEND_OUT', v_legend, v_owner, 0);
    SET v_done = 1;
  END IF;
  COMMIT;
  SELECT p_asset AS asset_id, v_owner AS owner_id, v_done AS returned;
END$$

-- Apre un drop della Banca Upthere: item con "drop" tra le sources, quantity paia, chiude dopo window_sec.
CREATE PROCEDURE sp_drop_open(IN p_item VARCHAR(64), IN p_quantity INT, IN p_window_sec INT)
BEGIN
  DECLARE v_in_drop INT;
  DECLARE v_closes  DATETIME(6);
  DECLARE v_id      BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT MAX(JSON_CONTAINS(sources, '"drop"')) INTO v_in_drop FROM items WHERE id = p_item;
  IF v_in_drop IS NULL OR v_in_drop <> 1 OR p_quantity < 1 OR p_window_sec < 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOR_SALE';
  END IF;
  SET v_closes = NOW(6) + INTERVAL p_window_sec SECOND;
  INSERT INTO drops (item_id, quantity, opens_at, closes_at) VALUES (p_item, p_quantity, NOW(6), v_closes);
  SET v_id = LAST_INSERT_ID();
  COMMIT;
  SELECT v_id AS drop_id, ROUND(UNIX_TIMESTAMP(v_closes) * 1000) AS closes_at_ms;
END$$

-- Compra al drop: un paio per giocatore, chi arriva prima. DROP (monete alla tesoreria), MINT dalla Banca
-- Upthere direttamente al giocatore, con drop_serial = "n. X di quantity".
CREATE PROCEDURE sp_drop_claim(IN p_drop BIGINT, IN p_player BIGINT)
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_item     VARCHAR(64);
  DECLARE v_quantity INT;
  DECLARE v_sold     INT;
  DECLARE v_closes   DATETIME(6);
  DECLARE v_claimed  INT;
  DECLARE v_n        INT;
  DECLARE v_coins    INT;
  DECLARE v_system   TINYINT;
  DECLARE v_price    INT;
  DECLARE v_inv      INT;
  DECLARE v_asset    BIGINT;
  DECLARE EXIT HANDLER FOR 1062 BEGIN ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DROP_ALREADY_CLAIMED'; END;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);

  START TRANSACTION;

  SELECT item_id, quantity, sold, closes_at INTO v_item, v_quantity, v_sold, v_closes
    FROM drops WHERE id = p_drop FOR UPDATE;
  IF v_item IS NULL OR v_closes <= NOW(6) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DROP_CLOSED'; END IF;
  IF v_sold >= v_quantity THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DROP_SOLDOUT'; END IF;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, p_player) FOR UPDATE;

  -- dopo il lock sulla riga del drop: i claim dello stesso drop sono serializzati
  SELECT COUNT(*) INTO v_claimed FROM drop_claims WHERE drop_id = p_drop AND player_id = p_player;
  IF v_claimed > 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DROP_ALREADY_CLAIMED'; END IF;

  SELECT COUNT(*), MAX(coins), MAX(is_system) INTO v_n, v_coins, v_system FROM players WHERE id = p_player;
  IF v_n = 0 OR v_system = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  SELECT MAX(base_value) INTO v_price FROM items WHERE id = v_item;
  IF v_coins < v_price THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  SELECT COUNT(*) INTO v_inv FROM assets WHERE owner_id = p_player;
  IF v_inv >= CAST(fn_setting('player.max_inventory') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_FULL';
  END IF;

  UPDATE drops SET sold = sold + 1 WHERE id = p_drop;
  CALL _sp_mint(v_item, p_player, v_treasury, 0, v_price, p_drop, v_asset);
  UPDATE assets SET drop_serial = v_sold + 1 WHERE id = v_asset;
  INSERT INTO drop_claims (drop_id, player_id, asset_id) VALUES (p_drop, p_player, v_asset);
  CALL _sp_move_coins(p_player, v_treasury, v_price, 'DROP', v_asset);

  COMMIT;
  SELECT v_asset AS asset_id, v_price AS price, v_sold + 1 AS sold, v_quantity AS quantity;
END$$

-- Scorta di un bot: MINT dal Negozio direttamente al bot (nessuna moneta). Certificato come ogni MINT.
CREATE PROCEDURE sp_bot_restock(IN p_bot BIGINT, IN p_item VARCHAR(64))
BEGIN
  DECLARE v_role  VARCHAR(16);
  DECLARE v_asset BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT MAX(system_role) INTO v_role FROM players WHERE id = p_bot;
  IF v_role IS NULL OR v_role <> 'BOT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  CALL _sp_mint(p_item, p_bot, CAST(fn_setting('economy.system_players.shop') AS UNSIGNED), 0, 0, NULL, v_asset);
  COMMIT;
  SELECT v_asset AS asset_id;
END$$

-- Un bot compra l'annuncio di un umano con i soldi della tesoreria (BOT_BUY, senza commissione). p_max_price
-- è perceivedValue × bots.buy_pct calcolato dal server: la SP lo ricontrolla. Sotto la soglia di tesoreria
-- i bot smettono di comprare (TREASURY_LOW).
CREATE PROCEDURE sp_bot_buy(IN p_listing_id BIGINT, IN p_bot BIGINT, IN p_max_price INT)
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_asset    BIGINT;
  DECLARE v_seller   BIGINT;
  DECLARE v_price    INT;
  DECLARE v_status   VARCHAR(10);
  DECLARE v_n        INT;
  DECLARE v_owner    BIGINT;
  DECLARE v_locked   DATETIME(6);
  DECLARE v_role     VARCHAR(16);
  DECLARE v_seller_sys TINYINT;
  DECLARE v_tcoins   INT;
  DECLARE v_inv      INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);

  START TRANSACTION;

  SELECT asset_id, seller_id, price, status INTO v_asset, v_seller, v_price, v_status
    FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_status IS NULL   THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_NOT_FOUND'; END IF;
  IF v_status <> 'OPEN' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_CLOSED';    END IF;
  IF v_price > p_max_price THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PRICE_OUT_OF_RANGE'; END IF;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, v_seller, p_bot) FOR UPDATE;

  SELECT owner_id, locked_until INTO v_owner, v_locked FROM assets WHERE id = v_asset FOR UPDATE;
  IF v_owner <> v_seller THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  IF v_locked IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ASSET_LOCKED'; END IF;

  SELECT MAX(system_role) INTO v_role FROM players WHERE id = p_bot;
  IF v_role IS NULL OR v_role <> 'BOT' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  -- i bot non comprano da altri bot né dagli account di sistema
  SELECT MAX(is_system) INTO v_seller_sys FROM players WHERE id = v_seller;
  IF v_seller_sys = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOR_SALE'; END IF;

  SELECT MAX(coins) INTO v_tcoins FROM players WHERE id = v_treasury;
  IF v_tcoins < v_price
     OR v_tcoins < CAST(fn_setting('economy.treasury_initial') AS UNSIGNED)
                   * CAST(fn_setting('economy.bots.min_treasury_pct_to_buy') AS DECIMAL(10,4)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TREASURY_LOW';
  END IF;

  SELECT COUNT(*) INTO v_inv FROM assets WHERE owner_id = p_bot;
  IF v_inv >= CAST(fn_setting('economy.bots.max_inventory_per_bot') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_FULL';
  END IF;

  CALL _sp_move_coins(v_treasury, v_seller, v_price, 'BOT_BUY', v_asset);
  UPDATE assets SET owner_id = p_bot WHERE id = v_asset;
  CALL _sp_append_event(v_asset, 'TRANSFER', v_seller, p_bot, v_price);
  UPDATE market_listings SET status = 'SOLD', buyer_id = p_bot, closed_at = NOW(6) WHERE id = p_listing_id;

  COMMIT;
  SELECT v_asset AS asset_id, v_seller AS seller_id, v_price AS price;
END$$

-- Invarianti I1–I6 (come in 005), con I3 che tiene conto del prestito a MC Suola: dopo un LEGEND_IN
-- il proprietario resta chi l'ha prestata (from_id), non MC Suola.
CREATE PROCEDURE sp_economy_check()
  READS SQL DATA
BEGIN
  -- I1: monete in circolazione = monete emesse
  SELECT 'I1' AS invariant, CONCAT('circolante ', c.circolante, ' <> emesso ', e.emesso) AS detail
    FROM (SELECT IFNULL(SUM(coins), 0) AS circolante FROM players) c,
         (SELECT IFNULL(SUM(amount), 0) AS emesso FROM coin_ledger WHERE from_id IS NULL) e
   WHERE c.circolante <> e.emesso
  UNION ALL
  -- I1 (per giocatore): ogni saldo è la somma dei suoi movimenti nel ledger
  SELECT 'I1', CONCAT('giocatore ', p.id, ': saldo ', p.coins, ' <> ledger ', IFNULL(l.net, 0))
    FROM players p
    LEFT JOIN (SELECT pid, SUM(delta) AS net
                 FROM (SELECT to_id AS pid, amount AS delta FROM coin_ledger
                       UNION ALL
                       SELECT from_id, -amount FROM coin_ledger WHERE from_id IS NOT NULL) m
                GROUP BY pid) l ON l.pid = p.id
   WHERE p.coins <> IFNULL(l.net, 0)
  UNION ALL
  -- I2: nessun saldo negativo (il CHECK lo impedisce già)
  SELECT 'I2', CONCAT('giocatore ', id, ': saldo ', coins) FROM players WHERE coins < 0
  UNION ALL
  -- I3: il proprietario è il destinatario dell'ultimo evento (per un LEGEND_IN: chi l'ha prestata)
  SELECT 'I3', CONCAT('asset ', a.id, ': proprietario ', a.owner_id, ', ultimo evento ', ev.event, ' verso ', ev.to_id)
    FROM assets a
    JOIN asset_events ev ON ev.id = (SELECT MAX(id) FROM asset_events WHERE asset_id = a.id)
   WHERE a.owner_id <> IF(ev.event = 'LEGEND_IN', ev.from_id, ev.to_id)
  UNION ALL
  SELECT 'I3', CONCAT('asset ', a.id, ': nessun evento')
    FROM assets a
   WHERE NOT EXISTS (SELECT 1 FROM asset_events ev WHERE ev.asset_id = a.id)
  UNION ALL
  -- I4: catena hash valida (hash ricalcolato e prev_hash = hash dell'anello precedente)
  SELECT 'I4', CONCAT('evento ', x.id, IF(x.hash <> x.calc, ': hash non corrisponde', ': prev_hash non corrisponde'))
    FROM (SELECT id, hash, prev_hash,
                 LAG(hash) OVER (PARTITION BY asset_id ORDER BY id) AS expected_prev,
                 SHA2(CONCAT_WS('|', asset_id, event, IFNULL(from_id, ''), to_id, price, IFNULL(prev_hash, ''),
                                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f')), 256) AS calc
            FROM asset_events) x
   WHERE x.hash <> x.calc OR NOT (x.prev_hash <=> x.expected_prev)
  UNION ALL
  SELECT 'I4', CONCAT('asset ', a.id, ': head_hash diverso dall''ultimo anello')
    FROM assets a
    LEFT JOIN asset_events ev ON ev.id = (SELECT MAX(id) FROM asset_events WHERE asset_id = a.id)
   WHERE NOT (a.head_hash <=> ev.hash)
  UNION ALL
  -- I5: ogni evento con un umano coinvolto va certificato
  SELECT 'I5', CONCAT('evento ', ev.id, ' (', ev.event, ') con un umano ma chain_status NONE')
    FROM asset_events ev
   WHERE ev.chain_status = 'NONE'
     AND EXISTS (SELECT 1 FROM players p WHERE p.id IN (ev.from_id, ev.to_id) AND p.is_system = 0)
  UNION ALL
  -- I6: al massimo un annuncio OPEN per asset (il vincolo unico lo impedisce già)
  SELECT 'I6', CONCAT('asset ', asset_id, ': ', COUNT(*), ' annunci OPEN')
    FROM market_listings
   WHERE status = 'OPEN'
   GROUP BY asset_id
  HAVING COUNT(*) > 1;
END$$

DELIMITER ;
