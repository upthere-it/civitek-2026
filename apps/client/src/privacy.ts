import type { GameConfig } from '@sp/shared';
import gameConfigJson from '../../../data/game_config.json';

// Pagina /privacy: colori del brand e numeri da config (CLAUDE.md regole 7 e 10), niente altro.
const cfg = gameConfigJson as unknown as GameConfig;
for (const [name, value] of Object.entries(cfg.brand.colors)) {
  document.documentElement.style.setProperty(`--up-${name}`, value);
}
for (const el of document.querySelectorAll<HTMLElement>('[data-days]')) {
  el.textContent = String(cfg.player.inactivity_anonymize_days);
}
