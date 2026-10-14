import type Phaser from 'phaser';
import { layerDefs, type AvatarParts } from './AvatarSprite';

/** Ritaglio del primo frame di idle_down (64×64) attorno al personaggio: testa a y 18, piedi a y 48. */
const CROP = { x: 20, y: 17, w: 24, h: 32 };

/**
 * Miniatura dell'avatar per le liste HTML (classifica): gli stessi layer e tint dello sprite, composti su un
 * canvas 2D dalle texture che Phaser ha già caricato. Il tint di Phaser è una moltiplicazione: qui uguale.
 */
export function avatarThumb(textures: Phaser.Textures.TextureManager, parts: AvatarParts): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = CROP.w;
  out.height = CROP.h;
  out.className = 'avatar-thumb';
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  const layer = document.createElement('canvas');
  layer.width = CROP.w;
  layer.height = CROP.h;
  const lctx = layer.getContext('2d')!;
  for (const [prefix, tint] of layerDefs(parts)) {
    const key = `${prefix}_idle_down`;
    if (!textures.exists(key)) continue;
    const frame = textures.getFrame(key, 0);
    const image = frame.source.image as CanvasImageSource;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, CROP.w, CROP.h);
    lctx.drawImage(image, frame.cutX + CROP.x, frame.cutY + CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
    if (tint) {
      lctx.globalCompositeOperation = 'multiply';
      lctx.fillStyle = tint;
      lctx.fillRect(0, 0, CROP.w, CROP.h);
      // la moltiplicazione riempie anche il trasparente: si rimette l'alfa del layer
      lctx.globalCompositeOperation = 'destination-in';
      lctx.drawImage(image, frame.cutX + CROP.x, frame.cutY + CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
    }
    ctx.drawImage(layer, 0, 0);
  }
  return out;
}
