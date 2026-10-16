-- Prima run (GAME_DESIGN §5, §12) e recupero da un altro device (§14).
-- Il valore armadio lo calcola il server (perceivedValue di shared): le SP lo ricevono e lo salvano, così il
-- reveal confronta sempre lo stesso numero iniziale anche se la config dei valori cambia durante la run.

ALTER TABLE players
  ADD COLUMN first_run_start_value INT NULL AFTER first_run_completed_at,
  ADD COLUMN first_run_end_value   INT NULL AFTER first_run_start_value,
  ADD COLUMN first_run_merchant    TINYINT(1) NOT NULL DEFAULT 0 AFTER first_run_end_value;

DROP PROCEDURE IF EXISTS sp_run_start;
DROP PROCEDURE IF EXISTS sp_run_complete;
DROP PROCEDURE IF EXISTS sp_player_recover;

DELIMITER $$

-- Avvia la prima run (all'ingresso nel villaggio). Idempotente: una run già avviata non riparte.
-- Restituisce l'inizio in epoch ms, il valore iniziale, se è già finita e con quale esito.
CREATE PROCEDURE sp_run_start(IN p_player BIGINT, IN p_start_value INT)
BEGIN
  DECLARE v_n INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT COUNT(*) INTO v_n FROM players WHERE id = p_player AND is_system = 0 FOR UPDATE;
  IF v_n = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  IF p_start_value IS NULL OR p_start_value < 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_PAYLOAD'; END IF;

  UPDATE players
     SET first_run_started_at = NOW(6), first_run_start_value = p_start_value
   WHERE id = p_player AND first_run_started_at IS NULL;
  COMMIT;

  SELECT ROUND(UNIX_TIMESTAMP(first_run_started_at) * 1000) AS started_ms,
         first_run_start_value AS start_value,
         first_run_completed_at IS NOT NULL AS completed, first_run_merchant AS merchant
    FROM players WHERE id = p_player;
END$$

-- Chiude la prima run con il valore finale; "Mercante" se raggiunge il target (lo calcola il server da
-- first_run.objective.multiplier). Idempotente: la seconda chiamata restituisce i valori della prima.
CREATE PROCEDURE sp_run_complete(IN p_player BIGINT, IN p_end_value INT, IN p_merchant TINYINT)
BEGIN
  DECLARE v_n INT;
  DECLARE v_started DATETIME(6);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  SELECT COUNT(*), MAX(first_run_started_at) INTO v_n, v_started FROM players WHERE id = p_player AND is_system = 0 FOR UPDATE;
  IF v_n = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  IF v_started IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_NOT_STARTED'; END IF;
  IF p_end_value IS NULL OR p_end_value < 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_PAYLOAD'; END IF;
  IF TIMESTAMPDIFF(SECOND, v_started, NOW(6)) < CAST(fn_setting('first_run.duration_sec') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RUN_NOT_OVER';
  END IF;

  UPDATE players
     SET first_run_completed_at = NOW(6), first_run_end_value = p_end_value, first_run_merchant = IF(p_merchant = 1, 1, 0)
   WHERE id = p_player AND first_run_completed_at IS NULL;
  COMMIT;

  SELECT first_run_start_value AS start_value, first_run_end_value AS end_value, first_run_merchant AS merchant,
         ROUND(UNIX_TIMESTAMP(first_run_started_at) * 1000) AS started_ms
    FROM players WHERE id = p_player;
END$$

-- Associa il device al giocatore del codice (GAME_DESIGN §14). Il vecchio device resta valido; se questo
-- device era di un altro giocatore, ora apre quello del codice (l'altro resta raggiungibile col suo codice).
CREATE PROCEDURE sp_player_recover(IN p_recovery_hash CHAR(64), IN p_device_hash CHAR(64))
BEGIN
  DECLARE v_id BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  -- recovery_hash è unique: lock sulla riga che esiste; un codice sbagliato non trova righe (niente gap
  -- lock: lettura senza FOR UPDATE)
  SELECT MAX(id) INTO v_id FROM players
   WHERE recovery_hash = p_recovery_hash AND is_system = 0 AND anonymized_at IS NULL;
  IF v_id IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CODE_NOT_FOUND'; END IF;
  SELECT id INTO v_id FROM players WHERE id = v_id FOR UPDATE;

  INSERT INTO player_devices (device_hash, player_id) VALUES (p_device_hash, v_id)
    ON DUPLICATE KEY UPDATE player_id = VALUES(player_id);
  COMMIT;

  SELECT v_id AS player_id;
END$$

DELIMITER ;
