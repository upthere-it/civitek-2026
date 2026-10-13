# Sneaker Passport — Upthere × DOP Digital

Gioco web per la conferenza del 23/10/2026: un mercato di sneaker in pixel art dove ogni scarpa ha un passaporto digitale certificato su blockchain testnet.

**Da dove partire**
- Claude Code → `CLAUDE.md`
- Design → `docs/GAME_DESIGN.md` · Economia → `docs/ECONOMY.md` · Tecnica → `docs/ARCHITECTURE.md`
- Asset → `docs/ASSETS.md` (anteprime: `apps/client/public/assets/PREVIEW_*.png`)
- Piano e decisioni aperte → `docs/PLAN.md`

**Avvio in locale** (Node ≥ 22.12, MySQL ≥ 8.0.16)
```bash
cp .env.example .env          # credenziali MySQL
npm install
npm run db:reset              # crea sneaker_passport_dev: migrazioni + seed
npm test                      # shared + server (usa sneaker_passport_test, che viene azzerato)
npm run dev:server            # :3000
npm run dev:client            # Vite, raggiungibile dal telefono sulla stessa rete
```

**Provarlo dal telefono** (stessa rete WiFi del portatile): con `dev:server` e `dev:client` avviati, apri `http://<IP del portatile>:5173`. Vite fa da proxy a `/socket.io`, quindi basta quella porta. In HTTP il `device_id` usa il fallback con `crypto.getRandomValues`: funziona anche fuori da HTTPS.

**Rigenerare dati e asset**
```bash
python3 tools/build_data.py                      # data/*.json
npm run db:seed                                  # sql/seed/001_seed.sql dai JSON, poi applicato
python3 tools/assets/gen_shoes.py data/game_items.json apps/client/public/assets/shoes
# avatar: vedi docs/ASSETS.md §3
```

Pixel art: Pixel Crawler di Anokolisa (termini in `apps/client/public/assets/vendor/pixel-crawler/Terms.txt`).
