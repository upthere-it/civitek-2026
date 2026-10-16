-- Anonimizzazione dei giocatori inattivi (CLAUDE.md regola 6, ARCHITECTURE §4): dopo
-- player.inactivity_anonymize_days senza connessioni (last_seen_at, aggiornato da sp_player_get_or_create)
-- si tolgono device, codice di recupero, aspetto e il nome scelto. Restano monete, scarpe e catene: i passaggi
-- già certificati non cambiano, e nei passaporti al posto del nome compare "Anonimo <id>".
-- Il nome nuovo contiene uno spazio, che nei nomi dei giocatori non è ammesso: non può scontrarsi con uno scelto.

DROP PROCEDURE IF EXISTS sp_anonymize_inactive;

DELIMITER $$

-- Anonimizza al massimo p_limit giocatori per chiamata, i più vecchi prima: il job la richiama finché ne trova.
-- Restituisce quanti ne ha anonimizzati.
CREATE PROCEDURE sp_anonymize_inactive(IN p_days INT, IN p_limit INT)
BEGIN
  DECLARE v_n INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF p_days IS NULL OR p_days < 1 OR p_limit IS NULL OR p_limit < 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_PAYLOAD';
  END IF;

  START TRANSACTION;

  -- i giocatori da anonimizzare, bloccati in ordine di id (stesso ordine di lock delle altre SP)
  CREATE TEMPORARY TABLE IF NOT EXISTS tmp_anonymize (id BIGINT PRIMARY KEY) ENGINE = MEMORY;
  DELETE FROM tmp_anonymize;
  INSERT INTO tmp_anonymize (id)
    SELECT id FROM players
     WHERE is_system = 0 AND anonymized_at IS NULL
       AND last_seen_at < NOW(6) - INTERVAL p_days DAY
     ORDER BY id
     LIMIT p_limit
     FOR UPDATE;
  SELECT COUNT(*) INTO v_n FROM tmp_anonymize;

  DELETE pd FROM player_devices pd JOIN tmp_anonymize t ON t.id = pd.player_id;
  UPDATE players p JOIN tmp_anonymize t ON t.id = p.id
     SET p.device_hash = NULL, p.recovery_hash = NULL,
         p.nickname = CONCAT('Anonimo ', p.id),
         p.avatar_body = NULL, p.avatar_skin = NULL, p.avatar_hair = NULL,
         p.avatar_hair_color = NULL, p.avatar_outfit = NULL,
         p.anonymized_at = NOW(6);

  DROP TEMPORARY TABLE tmp_anonymize;
  COMMIT;

  SELECT v_n AS anonymized;
END$$

DELIMITER ;
