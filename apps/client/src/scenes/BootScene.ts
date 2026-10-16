import Phaser from 'phaser';
import { registerAnims } from '../game/anims';
import { MANIFEST_KEY, type Manifest } from '../game/manifest';

export const BOOT_PROGRESS = 'boot-progress';
export const BOOT_READY = 'boot-ready';

/** Carica tutto da assets/manifest.json (docs/ASSETS.md §3) e registra le animazioni. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.json(MANIFEST_KEY, 'assets/manifest.json');
  }

  create(): void {
    const m = this.cache.json.get(MANIFEST_KEY) as Manifest;
    for (const s of m.spritesheets) this.load.spritesheet(s.key, s.path, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    for (const i of m.images) this.load.image(i.key, i.path);
    for (const a of m.atlases) this.load.atlas(a.key, a.image, a.json);
    for (const t of m.tilemaps) this.load.tilemapTiledJSON(t.key, t.path);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => this.game.events.emit(BOOT_PROGRESS, p));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      registerAnims(this, m);
      this.registry.set(MANIFEST_KEY, m);
      this.registry.set(BOOT_READY, true);
      this.game.events.emit(BOOT_READY);
    });
    this.load.start();
  }
}
