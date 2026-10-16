-- Outbox della certificazione on-chain (ARCHITECTURE §6). Le usa solo il ChainWorker, che è l'unico
-- a scrivere chain_status/chain_batch/chain_tx: le procedure di gioco inseriscono solo PENDING o NONE.

DROP PROCEDURE IF EXISTS sp_chain_recover_sending;
DROP PROCEDURE IF EXISTS sp_chain_claim_batch;
DROP PROCEDURE IF EXISTS sp_chain_mark_confirmed;
DROP PROCEDURE IF EXISTS sp_chain_mark_failed;

DELIMITER $$

-- All'avvio: un batch rimasto SENDING (processo morto durante l'invio) torna PENDING.
-- Rischio accettato: lo stesso hash può finire on-chain due volte.
CREATE PROCEDURE sp_chain_recover_sending()
BEGIN
  DECLARE v_n INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  UPDATE asset_events SET chain_status = 'PENDING' WHERE chain_status = 'SENDING';
  SET v_n = ROW_COUNT();
  COMMIT;
  SELECT v_n AS recovered;
END$$

-- Prende fino a p_limit eventi PENDING (i più vecchi), li marca SENDING con il batch e li restituisce.
CREATE PROCEDURE sp_chain_claim_batch(IN p_limit INT, IN p_batch_id CHAR(36))
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  UPDATE asset_events
     SET chain_status = 'SENDING', chain_batch = p_batch_id, chain_attempts = chain_attempts + 1
   WHERE chain_status = 'PENDING'
   ORDER BY id
   LIMIT p_limit;
  COMMIT;

  SELECT id, hash FROM asset_events
   WHERE chain_batch = p_batch_id AND chain_status = 'SENDING'
   ORDER BY id;
END$$

-- Batch notarizzato: CONFIRMED + tx. Restituisce gli eventi per le notifiche `asset.certified`.
CREATE PROCEDURE sp_chain_mark_confirmed(IN p_batch_id CHAR(36), IN p_tx VARCHAR(128))
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  UPDATE asset_events
     SET chain_status = 'CONFIRMED', chain_tx = p_tx, chain_confirmed_at = NOW(6), chain_error = NULL
   WHERE chain_batch = p_batch_id AND chain_status = 'SENDING';
  COMMIT;

  SELECT id AS event_id, asset_id, from_id, to_id, chain_tx
    FROM asset_events
   WHERE chain_batch = p_batch_id AND chain_status = 'CONFIRMED'
   ORDER BY id;
END$$

-- Batch fallito: torna PENDING per un nuovo tentativo, oppure FAILED oltre p_max_attempts.
CREATE PROCEDURE sp_chain_mark_failed(IN p_batch_id CHAR(36), IN p_error VARCHAR(255), IN p_max_attempts INT)
BEGIN
  DECLARE v_n INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;
  UPDATE asset_events
     SET chain_status = IF(chain_attempts >= p_max_attempts, 'FAILED', 'PENDING'),
         chain_error  = LEFT(p_error, 255)
   WHERE chain_batch = p_batch_id AND chain_status = 'SENDING';
  SET v_n = ROW_COUNT();
  COMMIT;

  SELECT
    v_n AS updated,
    (SELECT COUNT(*) FROM asset_events WHERE chain_batch = p_batch_id AND chain_status = 'FAILED') AS failed;
END$$

DELIMITER ;
