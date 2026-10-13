import Phaser from 'phaser';
import type { GameConfig } from '@sp/shared';
import gameConfigJson from '../../../data/game_config.json';

const gameConfig = gameConfigJson as unknown as GameConfig;

// Colori del brand solo da config (CLAUDE.md, regola 10)
for (const [name, value] of Object.entries(gameConfig.brand.colors)) {
  document.documentElement.style.setProperty(`--up-${name}`, value);
}

/** Segnaposto di M0: le scene Boot, Avatar e Village arrivano in M1. */
class PlaceholderScene extends Phaser.Scene {
  constructor() {
    super('Placeholder');
  }

  create(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Sneaker Passport', {
        fontFamily: 'Chillax, "DM Sans", sans-serif',
        fontStyle: '600',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
  }
}

// Il testo nel canvas va creato a font caricati. `document.fonts.ready` da solo non basta: un @font-face
// che nessun elemento del DOM usa non viene scaricato, quindi va richiesto esplicitamente.
void Promise.all([document.fonts.load('600 24px Chillax'), document.fonts.load('400 16px "DM Sans"')]).then(() => {
  new Phaser.Game({
    // Solo WebGL: il tint dei layer dell'avatar non funziona col renderer Canvas (docs/ASSETS.md §3)
    type: Phaser.WEBGL,
    parent: 'game',
    pixelArt: true,
    backgroundColor: gameConfig.brand.colors['accent-900'],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [PlaceholderScene],
  });
});
