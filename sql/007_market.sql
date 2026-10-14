-- Negozio e bacheca (M2): acquisto dal Negozio, annullamento di un annuncio.
-- sp_listing_create e sp_listing_buy sono in 003_procedures.sql.

DROP PROCEDURE IF EXISTS sp_shop_buy;
DROP PROCEDURE IF EXISTS sp_listing_cancel;

DELIMITER $$

-- Compra dal Negozio un item con "shop" tra le sources, a base_value (economy.shop_price): le monete vanno
-- alla tesoreria (SHOP) e l'asset è coniato direttamente al giocatore (MINT, minted_by = Negozio).
CREATE PROCEDURE sp_shop_buy(IN p_player BIGINT, IN p_item VARCHAR(64))
BEGIN
  DECLARE v_treasury BIGINT;
  DECLARE v_shop     BIGINT;
  DECLARE v_price    INT;
  DECLARE v_in_shop  INT;
  DECLARE v_n        INT;
  DECLARE v_coins    INT;
  DECLARE v_system   TINYINT;
  DECLARE v_inv      INT;
  DECLARE v_asset    BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_treasury = CAST(fn_setting('economy.system_players.treasury') AS UNSIGNED);
  SET v_shop     = CAST(fn_setting('economy.system_players.shop') AS UNSIGNED);

  START TRANSACTION;

  SELECT COUNT(*) INTO v_n FROM players WHERE id IN (v_treasury, p_player) FOR UPDATE;
  SELECT COUNT(*), MAX(coins), MAX(is_system) INTO v_n, v_coins, v_system FROM players WHERE id = p_player;
  IF v_n = 0 OR v_system = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;

  -- il catalogo non cambia durante il gioco: lettura senza lock
  SELECT MAX(base_value), MAX(JSON_CONTAINS(sources, '"shop"')) INTO v_price, v_in_shop FROM items WHERE id = p_item;
  IF v_price IS NULL OR v_in_shop <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOR_SALE'; END IF;
  IF v_coins < v_price THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_FUNDS'; END IF;

  SELECT COUNT(*) INTO v_inv FROM assets WHERE owner_id = p_player;
  IF v_inv >= CAST(fn_setting('player.max_inventory') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_FULL';
  END IF;

  CALL _sp_mint(p_item, p_player, v_shop, 0, v_price, NULL, v_asset);
  CALL _sp_move_coins(p_player, v_treasury, v_price, 'SHOP', v_asset);

  COMMIT;
  SELECT v_asset AS asset_id, v_price AS price;
END$$

-- Ritira un proprio annuncio OPEN.
CREATE PROCEDURE sp_listing_cancel(IN p_player BIGINT, IN p_listing_id BIGINT)
BEGIN
  DECLARE v_seller BIGINT;
  DECLARE v_status VARCHAR(10);
  DECLARE v_asset  BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT seller_id, status, asset_id INTO v_seller, v_status, v_asset
    FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF v_status IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_NOT_FOUND'; END IF;
  IF v_seller <> p_player THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_OWNER'; END IF;
  IF v_status <> 'OPEN' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LISTING_CLOSED'; END IF;

  UPDATE market_listings SET status = 'CANCELLED', closed_at = NOW(6) WHERE id = p_listing_id;

  COMMIT;
  SELECT p_listing_id AS listing_id, v_asset AS asset_id;
END$$

DELIMITER ;
