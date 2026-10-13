import Phaser from 'phaser';
import type { Facing } from '@sp/shared';
import { AvatarSprite, type AvatarParts } from '../game/AvatarSprite';

const TURN: Facing[] = ['down', 'right', 'up', 'left'];

/** Anteprima live dell'avatar nella schermata di creazione: i controlli sono nell'overlay HTML. */
export class AvatarScene extends Phaser.Scene {
  private avatar?: AvatarSprite;
  private parts?: AvatarParts;
  private turn = 0;
  private box: { top: number; bottom: number } | null = null;

  constructor() {
    super('Avatar');
  }

  create(data: { parts: AvatarParts }): void {
    this.parts ??= data.parts;
    this.draw();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.place, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.place, this));
    this.time.addEvent({ delay: 1600, loop: true, callback: () => this.avatar?.animate('walk', TURN[++this.turn % TURN.length]) });
  }

  /** Spazio libero (in pixel CSS) dove disegnare l'anteprima. */
  setBox(box: { top: number; bottom: number }): void {
    this.box = box;
    this.place();
  }

  setParts(parts: AvatarParts): void {
    this.parts = parts;
    if (this.sys.isActive()) this.draw(); // prima di create() basta ricordarsele
  }

  private draw(): void {
    const facing = TURN[this.turn % TURN.length];
    this.avatar?.destroy();
    this.avatar = new AvatarSprite(this, 0, 0, this.parts!).animate('walk', facing);
    this.place();
  }

  /**
   * Avatar centrato nello spazio libero, ingrandito a numero intero (pixel art nitida). Nel frame da 64 px
   * il personaggio occupa circa 36 px sopra i piedi (origine a 0.75).
   */
  private place(): void {
    if (!this.avatar) return;
    const { width, height } = this.scale;
    const top = this.box?.top ?? 0;
    const bottom = this.box?.bottom ?? height * 0.4;
    const scale = Math.max(2, Math.min(5, Math.floor(Math.min(width, bottom - top) / 44)));
    const feetY = (top + bottom) / 2 + 18 * scale;
    this.avatar.setScale(scale).setPosition(Math.round(width / 2), Math.round(feetY));
  }
}
