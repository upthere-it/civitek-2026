-- Funzioni di supporto (ARCHITECTURE §4).
--
-- Con il binary log attivo (default in MySQL 8) creare una FUNCTION richiede il privilegio SUPER
-- oppure `log_bin_trust_function_creators = 1`. In produzione: lanciare questo file con un utente
-- amministratore, oppure impostare la variabile una volta (SET PERSIST, o parameter group se gestito).
-- Le PROCEDURE non hanno questo vincolo.

DROP FUNCTION IF EXISTS fn_setting;

DELIMITER $$
-- Un'impostazione mancante è un errore, non un NULL: CAST(NULL ...) farebbe passare in silenzio
-- controlli come "inventario >= max_inventory".
CREATE FUNCTION fn_setting(p_name VARCHAR(96)) RETURNS VARCHAR(255)
  READS SQL DATA
BEGIN
  DECLARE v_value VARCHAR(255);
  DECLARE v_msg   VARCHAR(128);
  SET v_value = (SELECT value FROM game_settings WHERE name = p_name);
  IF v_value IS NULL THEN
    SET v_msg = CONCAT('SETTING_MISSING:', p_name);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
  RETURN v_value;
END$$
DELIMITER ;
