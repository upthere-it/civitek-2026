# ECONOMY — economia chiusa con tesoreria

I numeri stanno in `data/game_config.json` → `economy`, `valuation`, `drops`.

## 1. Principio

Le monete **non si distruggono mai**: circolano. Tutto quello che esce dalle tasche dei giocatori finisce nella **Banca Upthere** (tesoreria, `players.id = 1`). La tesoreria finanzia i bot che comprano dai giocatori.

Ne seguono tre cose:
- la massa monetaria cresce **solo** quando entra un nuovo giocatore (+100), quindi l'inflazione è impossibile per costruzione, anche con il gioco aperto per mesi;
- se la tesoreria si svuota, i bot smettono di comprare e i prezzi scendono da soli: il circuito si autoregola;
- ogni moneta ha una storia tracciata nel ledger, coerente con il messaggio del gioco.

Gli **asset** (le scarpe) invece si creano: negozio, drop, Tony Affari e scorte dei bot coniano nuovi asset. Non è un problema, perché il valore delle scarpe è percepito, mentre le monete sono conservate.

## 2. Account di sistema

| id | Ruolo | Note |
|---|---|---|
| 1 | `TREASURY` — Banca Upthere | Riceve tutte le uscite, paga i bot, conia i drop (`minted_by = 1` → bonus Upthere) |
| 2 | `SHOP` — Il Negozio | Conia gli asset del negozio. Non tiene monete: gli incassi vanno alla tesoreria |
| 3 | `STALL` — Tony Affari | Conia i falsi (`FAKE_MINT`). Non tiene monete: gli incassi vanno alla tesoreria |
| 4 | `LEGEND` — MC Suola | Possiede temporaneamente le scarpe durante il prestito |
| 10–17 | `BOT` | Hanno un inventario ma 0 monete: comprano con i soldi della tesoreria e incassano per la tesoreria |

## 3. Flussi di monete

| Flusso | Da → A | `reason` | Quanto |
|---|---|---|---|
| Nuovo giocatore | emissione → giocatore | `GRANT` | `player.start_coins` (100) |
| Dotazione iniziale tesoreria | emissione → tesoreria | `GRANT` | `treasury_initial` (5000) |
| Acquisto in negozio | giocatore → tesoreria | `SHOP` | `base_value` |
| Vendita tra giocatori | compratore → venditore | `TRADE` | prezzo − commissione |
| Commissione | compratore → tesoreria | `FEE` | `max(market_fee_min, ceil(prezzo × 5%))` |
| Acquisto da un bot | giocatore → tesoreria | `BOT_SELL` | prezzo dell'annuncio |
| Un bot compra da un giocatore | tesoreria → giocatore | `BOT_BUY` | prezzo dell'annuncio, senza commissione |
| Autenticazione | giocatore → tesoreria | `AUTH` | `auth_cost` (3) |
| MC Suola | giocatore → tesoreria | `LEGEND` | `legend.cost` (15) |
| Drop | giocatore → tesoreria | `DROP` | `base_value` |
| Bancarella | giocatore → tesoreria | `STALL` | `base_value × 50%` |

La scarpa regalata al nuovo giocatore è un asset, non monete: un `MINT` diretto al giocatore (`minted_by = 2`, prezzo 0), nessuna riga nel ledger. Lo stesso vale per negozio e drop: l'asset viene coniato direttamente al compratore, con un solo evento `MINT`.

**Commissione**: la paga di fatto il venditore. Nel ledger risultano due righe dal compratore: `TRADE` verso il venditore (prezzo − fee) e `FEE` verso la tesoreria.

## 4. Bot di mercato

Servono a dare liquidità quando ci sono pochi umani online. Quando gli umani aumentano, i bot si fanno da parte.

Ogni `tick_sec` (5 s) ciascun bot agisce con probabilità `activity`:

```
humans = giocatori umani online
activity = 1                                  se humans <= full_activity_below_humans_online (10)
activity = min_activity (0.2)                 se humans >= min_activity_at_humans_online (40)
activity = interpolazione lineare             in mezzo
```

Cosa fa un bot quando agisce:
- **Vende**: se ha inventario e meno di 2 annunci aperti, mette in bacheca un suo asset a `round(perceivedValue × sell_pct)` (115%).
- **Compra**: prende l'annuncio umano più conveniente con `price ≤ perceivedValue × buy_pct` (70%), solo se
  - tesoreria ≥ `treasury_initial × min_treasury_pct_to_buy` (20%), e
  - inventario del bot < `max_inventory_per_bot` (6).
- **Rifornimento**: se l'inventario scende sotto 2, il bot conia 2 item `base` o `trend` a caso. È un `MINT` di sistema: non muove monete, ma viene certificato on-chain come ogni `MINT` autentico. Così, se poi la scarpa arriva a un umano, la sua origine risulta certificata.

Lo stile in `npcs.json` (`compra_sottoprezzo`, `vende_trend`, …) pesa le scelte: `economy.bots.styles` dice per ogni stile con che probabilità il bot prova prima a comprare (`buy_first`) e da quali tier si rifornisce. All'avvio ogni bot parte con `start_stock` (3) item; soglie e quantità di rifornimento sono `restock_below` / `restock_count`, gli annunci aperti al massimo `max_open_listings`.

I bot non comprano falsi (nemmeno quelli non smascherati) né scarpe in prestito a MC Suola. "Umani online" = giocatori nel villaggio.

I bot non comprano mai da altri bot né da Tony Affari, e non fanno annunci di falsi.

## 5. Drop e bancarella

- **Drop**: prezzo `base_value` alla tesoreria; la scarpa vale subito +25% grazie al bonus Upthere. È il modo legale e veloce di far crescere l'armadio.
- **Bancarella**: prezzo al 50% del base, alla tesoreria. Il falso vale il 40% finché non viene verificato e 2 monete dopo la verifica. È il modo veloce di perdere valore.

## 6. Invarianti (test obbligatori)

| # | Invariante | Come si verifica |
|---|---|---|
| I1 | Monete in circolazione = monete emesse | `SUM(players.coins) = SUM(coin_ledger.amount WHERE from_id IS NULL)` |
| I2 | Nessun saldo negativo | `CHECK (coins >= 0)` più test |
| I3 | Il proprietario corrente di un asset è il destinatario del suo ultimo evento | join `assets` ↔ ultimo `asset_events` |
| I4 | La catena hash di ogni asset è valida | ricalcolo `SHA2` per ogni evento e controllo `prev_hash` |
| I5 | Ogni evento con un umano coinvolto ha `chain_status <> 'NONE'` | query su `asset_events` ⋈ `players` |
| I6 | Al massimo un annuncio `OPEN` per asset | `UNIQUE` sulla colonna generata `open_asset_id` |

Query I1, da eseguire in test e in un cron ogni minuto (`sp_economy_check`):

```sql
-- deve restituire 0 righe
SELECT c.circolante, e.emesso
FROM (SELECT SUM(coins) AS circolante FROM players) c,
     (SELECT SUM(amount) AS emesso FROM coin_ledger WHERE from_id IS NULL) e
WHERE c.circolante <> e.emesso;
```

Query I3:

```sql
-- deve restituire 0 righe
SELECT a.id
FROM assets a
JOIN asset_events ev ON ev.id = (SELECT MAX(id) FROM asset_events WHERE asset_id = a.id)
WHERE ev.to_id <> a.owner_id;
```

## 7. Simulazione prima del 21/10

`npm run sim:economy`: 100 giocatori simulati per 30 minuti di gioco con comportamenti misti (compra al drop, compra dalla bancarella, usa MC Suola, vende in bacheca), più i bot.

L'output deve mostrare:
- l'andamento della tesoreria nel tempo;
- il valore medio dell'armadio a 5 e a 10 minuti, e la distanza fra primo e decimo in classifica (se il primo scappa via, la gara finisce);
- nessuna violazione di I1–I6.

## 8. Leve di taratura

| Sintomo | Leva |
|---|---|
| Il primo in classifica scappa via | `valuation.legend_max_counted`, `drops.quantity`, `economy.listing_max_multiplier` |
| Prezzi in bacheca che crollano | alzare `bots.buy_pct` (es. 0,75) |
| Tesoreria che si svuota | i bot si fermano già da soli; eventualmente abbassare `bots.buy_pct` |
| Tesoreria che si gonfia troppo | abbassare `market_fee_pct` o `auth_cost` |
| Falsi che non ingannano nessuno | alzare `stall.price_pct_of_base` (es. 0,65): l'affare sembra meno sospetto |
| MC Suola usata da tutti a ripetizione | alzare `legend.cost` o `cooldown_sec` |
