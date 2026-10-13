-- Invarianti I1–I6 (ECONOMY §6). Restituisce una riga per violazione: 0 righe = tutto in ordine.
-- Non apre transazioni: i test la chiamano anche dentro una transazione propria, dopo una
-- manomissione, per verificare che le violazioni vengano viste.

DROP PROCEDURE IF EXISTS sp_economy_check;

DELIMITER $$

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
  -- I3: il proprietario è il destinatario dell'ultimo evento
  SELECT 'I3', CONCAT('asset ', a.id, ': proprietario ', a.owner_id, ', ultimo evento verso ', ev.to_id)
    FROM assets a
    JOIN asset_events ev ON ev.id = (SELECT MAX(id) FROM asset_events WHERE asset_id = a.id)
   WHERE ev.to_id <> a.owner_id
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
