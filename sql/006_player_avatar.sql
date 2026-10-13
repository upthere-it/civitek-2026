-- Avatar del giocatore (GAME_DESIGN §3): si sceglie una volta sola, indici validati sulla config.

DROP PROCEDURE IF EXISTS sp_player_set_avatar;

DELIMITER $$

CREATE PROCEDURE sp_player_set_avatar(
  IN p_player BIGINT, IN p_skin INT, IN p_hair INT, IN p_hair_color INT, IN p_outfit INT)
BEGIN
  DECLARE v_skin_now TINYINT UNSIGNED;
  DECLARE v_n INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  START TRANSACTION;

  SELECT COUNT(*), MAX(avatar_skin) INTO v_n, v_skin_now FROM players WHERE id = p_player AND is_system = 0 FOR UPDATE;
  IF v_n = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PLAYER_NOT_FOUND'; END IF;
  IF v_skin_now IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AVATAR_ALREADY_SET'; END IF;

  IF p_skin IS NULL OR p_hair IS NULL OR p_hair_color IS NULL OR p_outfit IS NULL
     OR p_skin < 0 OR p_skin >= JSON_LENGTH(fn_setting('avatar.skin_tones'))
     OR p_hair < 0 OR p_hair >= JSON_LENGTH(fn_setting('avatar.hair_styles'))
     OR p_hair_color < 0 OR p_hair_color >= JSON_LENGTH(fn_setting('avatar.hair_colors'))
     OR p_outfit < 0 OR p_outfit >= JSON_LENGTH(fn_setting('avatar.outfit_colors')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AVATAR_INVALID';
  END IF;

  UPDATE players
     SET avatar_skin = p_skin, avatar_hair = p_hair, avatar_hair_color = p_hair_color, avatar_outfit = p_outfit
   WHERE id = p_player;

  COMMIT;
END$$

DELIMITER ;
