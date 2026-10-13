# Sneaker Passport — Upthere × DOP Digital

Gioco web per la conferenza del 23/10/2026: un mercato di sneaker in pixel art dove ogni scarpa ha un passaporto digitale certificato su blockchain testnet.

**Da dove partire**
- Claude Code → `CLAUDE.md`
- Design → `docs/GAME_DESIGN.md` · Economia → `docs/ECONOMY.md` · Tecnica → `docs/ARCHITECTURE.md`
- Asset → `docs/ASSETS.md` (anteprime: `apps/client/public/assets/PREVIEW_*.png`)
- Piano e decisioni aperte → `docs/PLAN.md`

**Rigenerare dati e asset**
```bash
python3 tools/build_data.py                      # data/*.json
python3 tools/assets/gen_shoes.py data/game_items.json apps/client/public/assets/shoes
# avatar: vedi docs/ASSETS.md §3
```

Pixel art: Pixel Crawler di Anokolisa (termini in `apps/client/public/assets/vendor/pixel-crawler/Terms.txt`).
