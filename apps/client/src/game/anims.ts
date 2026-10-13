import Phaser from 'phaser';
import { gameConfig } from '../config';
import type { Manifest } from './manifest';

// Solo le texture {layer}_{idle|walk}_{dir}: 'shoes' da solo è l'atlas delle icone (docs/ASSETS.md §3).
const AVATAR_SHEET = /^(?:skin_\d|pants|shoes|hoodie|hair_[a-z]+)_(idle|walk)_(?:down|side|up)$/;

/** Un'animazione per ogni sheet dell'avatar e degli NPC, con chiave = chiave della texture. */
export function registerAnims(scene: Phaser.Scene, manifest: Manifest): void {
  const { animations } = gameConfig.avatar;
  for (const s of manifest.spritesheets) {
    if (scene.anims.exists(s.key)) continue;
    const avatar = AVATAR_SHEET.exec(s.key);
    const kind = avatar ? (avatar[1] as 'idle' | 'walk') : s.key.startsWith('npc_') ? (s.key.endsWith('_walk') ? 'walk' : 'idle') : null;
    if (!kind) continue;
    scene.anims.create({
      key: s.key,
      frames: scene.anims.generateFrameNumbers(s.key, { start: 0, end: s.frames - 1 }),
      frameRate: animations[kind].frameRate,
      repeat: -1,
    });
  }
}
