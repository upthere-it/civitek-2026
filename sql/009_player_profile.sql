-- Onboarding (D12): stile dell'avatar (ragazzo/ragazza) e nome scelto dal giocatore alla creazione.
-- sp_player_set_avatar (006) resta com'è per i chiamanti vecchi: la creazione del personaggio passa da
-- sp_player_set_profile, che in più salva stile e nome. Lunghezza del nome ricontrollata qui; formato e
-- parole vietate li controlla il server (nicknameFormatError + data/nickname_blocklist.json).

ALTER TABLE players ADD COLUMN avatar_body TINYINT UNSIGNED NULL AFTER avatar_skin;

DROP PROCEDURE IF EXISTS sp_player_set_profile;

DELIMITER $$

CREATE PROCEDURE sp_player_set_profile(
  IN p_player BIGINT, IN p_nickname VARCHAR(32), IN p_body INT,
  IN p_skin INT, IN p_hair INT, IN p_hair_color INT, IN p_outfit INT)
BEGIN
  DECLARE v_skin_now TINYINT UNSIGNED;
  DECLARE v_n INT;
  DECLARE EXIT HANDLER FOR 1062 BEGIN ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NICKNAME_TAKEN'; END;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT COUNT(*), MAX(avatar_skin) INTO v_n, v_skin_now FROM players WHERE id = p_player AND is_system = 0 FOR UPDATE;
  IF v_n = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  -- il personaggio (e quindi il nome) si sceglie una volta sola
  IF v_skin_now IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AVATAR_ALREADY_SET'; END IF;

  IF p_nickname IS NULL
     OR CHAR_LENGTH(p_nickname) < CAST(fn_setting('player.nickname.min_length') AS UNSIGNED)
     OR CHAR_LENGTH(p_nickname) > CAST(fn_setting('player.nickname.max_length') AS UNSIGNED) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NICKNAME_INVALID';
  END IF;

  IF p_body IS NULL OR p_skin IS NULL OR p_hair IS NULL OR p_hair_color IS NULL OR p_outfit IS NULL
     OR p_body < 0 OR p_body >= JSON_LENGTH(fn_setting('avatar.body_types'))
     OR p_skin < 0 OR p_skin >= JSON_LENGTH(fn_setting('avatar.skin_tones'))
     OR p_hair < 0 OR p_hair >= JSON_LENGTH(fn_setting('avatar.hair_styles'))
     OR p_hair_color < 0 OR p_hair_color >= JSON_LENGTH(fn_setting('avatar.hair_colors'))
     OR p_outfit < 0 OR p_outfit >= JSON_LENGTH(fn_setting('avatar.outfit_colors')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AVATAR_INVALID';
  END IF;

  -- un nome uguale a un altro (anche con maiuscole o accenti diversi: collation _ai_ci) → 1062 → NICKNAME_TAKEN
  UPDATE players
     SET nickname = p_nickname, avatar_body = p_body, avatar_skin = p_skin, avatar_hair = p_hair,
         avatar_hair_color = p_hair_color, avatar_outfit = p_outfit
   WHERE id = p_player;

  COMMIT;
  SELECT p_nickname AS nickname;
END$$

DELIMITER ;
