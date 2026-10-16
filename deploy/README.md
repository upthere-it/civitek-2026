# Deploy di Sneaker Passport su civitek.upthere.it

Runbook per la messa in produzione (PLAN M6) e per gli aggiornamenti. La produzione la toccano solo i dev di
Upthere: il DB si allinea **a mano** (dbForge o client `mysql`), mai via MCP.

| File | A cosa serve |
|---|---|
| `ecosystem.config.js` (root) | PM2: una istanza in **fork mode** su `127.0.0.1:3000` |
| `deploy/nginx/civitek.upthere.it.conf` | HTTPS, proxy di `/socket.io/` e `/api/`, cache, IP troncati nei log |
| `npm run db:bundle` → `deploy/out/*.sql` | Script SQL unico per il DB di produzione (non versionato: si rigenera) |
| `deploy/qr/civitek-qr.svg` / `.png` | QR definitivo verso https://civitek.upthere.it (`tools/make_qr.py`) |

## 0. Prerequisiti del server

- Node.js ≥ 22.12, `npm i -g pm2`
- MySQL ≥ 8.0.16 (servono i `CHECK`)
- nginx + certbot
- DNS: record di `civitek.upthere.it` verso il server (D3)

## 1. Database (prima installazione)

1. Su una macchina di sviluppo, dal repo aggiornato: `npm run db:bundle`. Scrive
   `deploy/out/civitek_completo_<data>.sql`: tutte le migrazioni, le righe di `schema_migrations` con i
   checksum (così `npm run db:migrate` le vede già applicate) e il seed (impostazioni, catalogo, account di
   sistema, bot, dotazione della tesoreria).
2. Sul server MySQL: creare il database (utf8mb4, `utf8mb4_0900_ai_ci`) e l'utente dell'applicazione con i
   permessi su quel database.
3. `fn_setting` è una FUNCTION: con il binlog attivo chi lancia lo script deve avere SUPER oppure serve
   `log_bin_trust_function_creators = 1`.
4. Lanciare lo script **sul database selezionato**. Si ferma da solo (`DB_NOT_EMPTY`) se trova già la tabella
   `players`: non sovrascrive un database in uso.

Per un **reset** della produzione (prima della prova generale o della conferenza): svuotare il database a mano
(DROP + CREATE) e rilanciare lo script completo.

### Oggetti del database (per la task di rilascio, in ordine alfabetico)

- **Funzioni**: `fn_setting`
- **Procedure**: `_sp_append_event`, `_sp_mint`, `_sp_move_coins`, `sp_anonymize_inactive`, `sp_auth_request`,
  `sp_bot_buy`, `sp_bot_restock`, `sp_chain_claim_batch`, `sp_chain_mark_confirmed`, `sp_chain_mark_failed`,
  `sp_chain_recover_sending`, `sp_drop_claim`, `sp_drop_open`, `sp_economy_check`, `sp_legend_return`,
  `sp_legend_wear`, `sp_listing_buy`, `sp_listing_cancel`, `sp_listing_create`, `sp_player_get_or_create`,
  `sp_player_recover` (non più usata), `sp_player_set_avatar`, `sp_player_set_profile`, `sp_run_complete` (non più usata),
  `sp_run_start`, `sp_shop_buy`, `sp_stall_buy`, `sp_stall_restock`, `sp_treasury_seed`
- **Tabelle**: `asset_events`, `assets`, `coin_ledger`, `drop_claims`, `drops`, `game_settings`,
  `item_counters`, `items`, `market_listings`, `player_devices`, `players`, `schema_migrations`

## 2. Codice e `.env`

```bash
git clone <repo> /srv/civitek && cd /srv/civitek
npm ci
npm run build          # shared, server (apps/server/dist) e client (apps/client/dist)
mkdir -p logs
```

`.env` nella root del repo (mai nel repository; modello in `.env.example`):

| Chiave | Valore |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | il database del passo 1 |
| `CN_USERNAME` `CN_PASSWORD` `CN_RECIPIENT_ADDRESS` | commercio.app (D11). In produzione senza queste il server **non parte** |
| `HEALTH_TOKEN` | casuale (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`): abilita `/api/health?full=1` |

`NODE_ENV=production`, `HOST=127.0.0.1` e `PORT=3000` li imposta `ecosystem.config.js`.

## 3. Avvio con PM2

```bash
pm2 start ecosystem.config.js
pm2 save && pm2 startup        # riparte da solo al riavvio della macchina
pm2 install pm2-logrotate      # i log non crescono all'infinito
pm2 logs civitek               # deve comparire "login commercio.app riuscito" alla prima certificazione
```

**Una sola istanza, fork mode**: lo stato dei socket e del villaggio è in memoria. Mai `-i max` né cluster.

All'avvio il server riallinea `game_settings` a `data/game_config.json` e parte con i loop (bot, Tony, drop,
MC Suola, classifica, anonimizzazione, worker della certificazione).

## 4. nginx e HTTPS

```bash
sudo cp deploy/nginx/civitek.upthere.it.conf /etc/nginx/conf.d/
sudo certbot --nginx -d civitek.upthere.it      # oppure certonly --webroot -w /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS è obbligatorio: senza, il browser non dà `crypto.randomUUID()` e il gioco non genera il `device_id`.
I log di accesso hanno l'IP troncato (utenti minorenni) e vanno tenuti al massimo 7 giorni (logrotate:
`rotate 7`, `daily`).

## 5. Verifiche dopo il deploy

```bash
curl -s https://civitek.upthere.it/api/health | jq            # status ok, db.ok, chain.notary "commercio-…"
curl -s -H "x-health-token: $HEALTH_TOKEN" "https://civitek.upthere.it/api/health?full=1" | jq .notary
#   → ok: true e il saldo del wallet (balance)
```

- `warnings` vuoto. Se dice "certificazione simulata (MockNotary)", mancano le `CN_*`.
- Da telefono (rete mobile, non il Wi‑Fi dell'ufficio): QR → landing → avatar → villaggio, un acquisto al
  Negozio e il passaporto che passa da ⏳ a ✅ con il link all'explorer.
- `https://civitek.upthere.it/privacy/` raggiungibile dal link della landing.

## 6. Aggiornare

```bash
cd /srv/civitek && git pull
npm ci && npm run build
# solo se ci sono migrazioni nuove (es. dalla 012): sulla macchina di sviluppo
#   npm run db:bundle -- --from 012      → deploy/out/civitek_da_012_<data>.sql, da lanciare a mano
pm2 reload civitek
```

Con una sola istanza il reload è un riavvio: i telefoni si riconnettono da soli in pochi secondi e il server
rimanda `state.init`. Meglio non farlo durante l'intervento.

## 7. Giorno della conferenza (23/10)

- 1 ora prima: `/api/health?full=1` (DB, coda della certificazione, login e saldo commercio.app).
- `pm2 logs civitek` aperto su un portatile.
- Hotspot 4G di riserva.
- QR proiettato e stampato (`deploy/qr/`).

## Rollback

`git checkout <commit precedente> && npm ci && npm run build && pm2 reload civitek`. Le migrazioni non si
annullano: se una release ne ha portate, il codice vecchio deve restare compatibile (una SP con un parametro in
più si affianca con `_v2`, non si cambia).
