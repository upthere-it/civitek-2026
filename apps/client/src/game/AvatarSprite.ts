import Phaser from 'phaser';
import type { AvatarLook, Facing } from '@sp/shared';
import { gameConfig } from '../config';

/** Colori risolti dei layer: dagli indici del giocatore o espliciti (MC Suola, npcs.json). */
export interface AvatarParts {
  skin: number;
  hairStyle: string;
  hairColor: string;
  outfitColor: string;
  shoesColor: string;
}

export function partsFromLook(look: AvatarLook, shoesColor: string | null): AvatarParts {
  const a = gameConfig.avatar;
  return {
    skin: look.skin,
    hairStyle: a.hair_styles[look.hair],
    hairColor: a.hair_colors[look.hairColor],
    outfitColor: a.outfit_colors[look.outfit],
    shoesColor: shoesColor ?? a.shoes_default_color,
  };
}

const hex = (h: string) => parseInt(h.replace('#', ''), 16);

/**
 * Avatar a 5 layer sovrapposti (docs/ASSETS.md §3): corpo, pantaloni, scarpe, felpa, capelli.
 * Gli overlay sono in grigi e vengono tinti (solo WebGL). Gli sheet `side` guardano a destra.
 */
export class AvatarSprite extends Phaser.GameObjects.Container {
  private readonly layers: { sprite: Phaser.GameObjects.Sprite; prefix: string }[] = [];
  private current = { anim: '', facing: '' };

  constructor(scene: Phaser.Scene, x: number, y: number, parts: AvatarParts) {
    super(scene, x, y);
    const a = gameConfig.avatar;
    const defs: [string, string | null][] = [
      [`skin_${parts.skin}`, null],
      ['pants', a.pants_color],
      ['shoes', parts.shoesColor],
      ['hoodie', parts.outfitColor],
      [`hair_${parts.hairStyle}`, parts.hairColor],
    ];
    for (const [prefix, tint] of defs) {
      const s = scene.add.sprite(0, 0, `${prefix}_idle_down`).setOrigin(a.frame.origin_x, a.frame.origin_y);
      if (tint) s.setTint(hex(tint));
      this.add(s);
      this.layers.push({ sprite: s, prefix });
    }
    scene.add.existing(this);
    this.animate('idle', 'down');
  }

  animate(anim: 'idle' | 'walk', facing: Facing): this {
    if (anim === this.current.anim && facing === this.current.facing) return this;
    this.current = { anim, facing };
    const sheet = facing === 'left' || facing === 'right' ? 'side' : facing;
    for (const { sprite, prefix } of this.layers) sprite.setFlipX(facing === 'left').play(`${prefix}_${anim}_${sheet}`, true);
    return this;
  }

  setShoesColor(color: string): void {
    this.layers.find((l) => l.prefix === 'shoes')?.sprite.setTint(hex(color));
  }
}
