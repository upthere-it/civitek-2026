import Phaser from 'phaser';
import {
  advance,
  findPath,
  objectProps,
  parseVillage,
  type Facing,
  type Mover,
  type Place,
  type PlayerProfile,
  type PlayerSnapshot,
  type Point,
  type TiledMap,
  type Village,
} from '@sp/shared';
import { gameConfig, npcByZone, type NpcInfo } from '../config';
import { AvatarSprite, partsFromLook } from '../game/AvatarSprite';
import { MANIFEST_KEY, type Manifest } from '../game/manifest';

const MAP_KEY = 'village';
const C = gameConfig.brand.colors;
const num = (hex: string) => parseInt(hex.replace('#', ''), 16);
const DEPTH_ROOFS = 100_000; // tetti e insegne coprono i personaggi che passano dietro
const UI_DEPTH = 200_000;
const LABEL_DY = 34; // il nome appena sopra la testa (frame da 64, piedi a 0.75): più in alto finiva sull'NPC davanti

export interface VillageInit {
  me: { id: number; nickname: string; profile: PlayerProfile; position: Point };
  /** Il giocatore ha toccato un punto: il client si muove subito, il server riceve l'intenzione. */
  onMove: (target: Point) => void;
  /** Arrivato da un NPC o alla bacheca. */
  onPlace: (place: Place) => void;
}

interface Actor {
  sprite: AvatarSprite;
  label: Phaser.GameObjects.Text;
}

/** Gli altri giocatori camminano lungo il percorso ricevuto dal server, con la stessa advance(). */
interface Remote extends Actor {
  mover: Mover;
}

/** Villaggio: tilemap Tiled, prop, NPC, il proprio avatar (predetto in locale) e gli altri (interpolati). */
export class VillageScene extends Phaser.Scene {
  private village!: Village;
  private init!: VillageInit;
  private readonly bubbles = new Map<string, Phaser.GameObjects.Text>();
  private me!: Actor & { mover: Mover; pendingPlace: Place | null };
  private readonly remotes = new Map<number, Remote>();
  private marker?: Phaser.GameObjects.Arc;
  private zoom = 1;

  constructor() {
    super('Village');
  }

  create(init: VillageInit): void {
    this.init = init;
    const world = gameConfig.world;
    this.zoom = world.camera_zoom;

    const mapJson = this.cache.tilemap.get(MAP_KEY).data as TiledMap;
    this.village = parseVillage(mapJson);
    this.drawMap();

    const { position, profile, nickname } = init.me;
    const sprite = new AvatarSprite(this, position.x, position.y, partsFromLook(profile.look, profile.shoesColor));
    this.me = {
      sprite,
      label: this.nameLabel(nickname, true),
      mover: { x: position.x, y: position.y, path: [], facing: 'down' },
      pendingPlace: null,
    };

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.village.widthPx, this.village.heightPx).setZoom(this.zoom).setRoundPixels(true);
    cam.startFollow(sprite, true, 0.2, 0.2);

    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length) return; // tap su un NPC: gestito dal suo handler
      this.walkTo({ x: p.worldX, y: p.worldY }, null);
    });
  }

  // ------------------------------------------------------------------ mappa

  private drawMap(): void {
    const map = this.make.tilemap({ key: MAP_KEY });
    const tilesets = map.tilesets.map((ts) => map.addTilesetImage(ts.name, ts.name)!);
    ['ground', 'cobble', 'grass', 'buildings'].forEach((name, i) => map.createLayer(name, tilesets)?.setDepth(-10 + i));
    map.createLayer('roofs', tilesets)?.setDepth(DEPTH_ROOFS);

    for (const o of map.getObjectLayer('decor')?.objects ?? []) {
      const props = objectProps(o as never);
      const frame = `${props.sx},${props.sy},${o.width},${o.height}`;
      const tex = this.textures.get(props.texture);
      if (!tex.has(frame)) tex.add(frame, 0, Number(props.sx), Number(props.sy), o.width!, o.height!);
      const above = props.above === 'true';
      this.add
        .image(o.x!, o.y!, props.texture, frame)
        .setOrigin(0, 0)
        .setDepth(above ? DEPTH_ROOFS + 1 : o.y! + o.height!);
    }

    const manifest = this.registry.get(MANIFEST_KEY) as Manifest;
    for (const place of this.village.places) {
      if (place.type === 'npc') this.drawNpc(place, manifest);
      if (place.type === 'board') this.tapZone(place, place.x - 32, place.y - 56, 64, 56);
    }
  }

  private drawNpc(place: Place, manifest: Manifest): void {
    const info = npcByZone.get(place.name);
    if (!info) return;
    let obj: Phaser.GameObjects.Sprite | AvatarSprite;
    if (info.sprite.type === 'avatar') {
      const s = info.sprite;
      obj = new AvatarSprite(this, place.x, place.y, {
        skin: s.skin,
        hairStyle: s.hair_style,
        hairColor: s.hair_color,
        outfitColor: s.outfit_color,
        shoesColor: s.shoes_color,
      });
    } else {
      const sheet = manifest.spritesheets.find((x) => x.key === place.props.sprite);
      obj = this.add.sprite(place.x, place.y, place.props.sprite).setOrigin(sheet?.originX ?? 0.5, sheet?.originY ?? 1);
      obj.setFlipX(!!info.sprite.flipX).play(place.props.sprite);
    }
    obj.setDepth(place.y);
    // il nome solo se la zona non ha già un'insegna (Tony Affari non ne ha: è una bancarella)
    if (!(place.name in gameConfig.brand.signs)) {
      this.nameLabel(info.name, false).setPosition(place.x, place.y - LABEL_DY).setDepth(DEPTH_ROOFS + 2);
    }
    this.tapZone(place, place.x - 12, place.y - 36, 24, 40);
  }

  /** Area toccabile: l'avatar cammina al punto di interazione e all'arrivo si apre il pannello. */
  private tapZone(place: Place, x: number, y: number, w: number, h: number): void {
    this.add
      .zone(x, y, w, h)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.walkTo(place.approach ?? place, place));
  }

  // ------------------------------------------------------------------ movimento

  private walkTo(target: Point, place: Place | null): void {
    const path = findPath(this.village.grid, this.me.mover, target);
    if (!path) return;
    this.me.mover.path = path;
    this.me.pendingPlace = place;
    const end = path.length ? path[path.length - 1] : this.me.mover;
    this.showMarker(end);
    this.init.onMove(target);
    if (!path.length && place) this.arrive();
  }

  private arrive(): void {
    const place = this.me.pendingPlace;
    this.me.pendingPlace = null;
    if (!place) return;
    // gira l'avatar verso l'NPC
    this.me.mover.facing = place.y < this.me.mover.y - 4 ? 'up' : place.x < this.me.mover.x ? 'left' : 'right';
    this.init.onPlace(place);
  }

  private showMarker(p: Point): void {
    this.marker?.destroy();
    this.marker = this.add.circle(p.x, p.y, 3, 0xffffff, 0.8).setDepth(1).setStrokeStyle(1, num(C.primary));
    this.tweens.add({ targets: this.marker, alpha: 0, scale: 2, duration: 600, onComplete: (_t, [m]) => m.destroy() });
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    const speed = gameConfig.world.walk_speed_px_s;

    const m = this.me.mover;
    const wasMoving = m.path.length > 0;
    const moving = advance(m, speed * dt);
    this.me.sprite.setPosition(m.x, m.y).setDepth(m.y).animate(moving ? 'walk' : 'idle', m.facing);
    this.me.label.setPosition(m.x, m.y - LABEL_DY);
    if (wasMoving && !moving) this.arrive();

    for (const r of this.remotes.values()) {
      const walking = advance(r.mover, speed * dt);
      r.sprite.setPosition(r.mover.x, r.mover.y).setDepth(r.mover.y).animate(walking ? 'walk' : 'idle', r.mover.facing);
      r.label.setPosition(r.mover.x, r.mover.y - LABEL_DY);
    }
  }

  // ------------------------------------------------------------------ dal server

  /** Delta di `world.players`. Il proprio avatar si riallinea solo se è troppo lontano dal server. */
  applySnapshots(players: PlayerSnapshot[], gone: number[]): void {
    for (const s of players) {
      if (s.id === this.init.me.id) {
        this.reconcile(s);
        if (s.profile?.shoesColor) this.me.sprite.setShoesColor(s.profile.shoesColor);
        continue;
      }
      let r = this.remotes.get(s.id);
      if (!r && s.profile) {
        const sprite = new AvatarSprite(this, s.x, s.y, partsFromLook(s.profile.look, s.profile.shoesColor));
        r = { sprite, label: this.nameLabel(s.profile.nickname, false), mover: { x: s.x, y: s.y, path: [], facing: s.facing } };
        this.remotes.set(s.id, r);
      }
      if (!r) continue;
      if (s.profile?.shoesColor) r.sprite.setShoesColor(s.profile.shoesColor);
      const m = r.mover;
      // piccoli scarti (latenza) si assorbono continuando dal punto in cui è; quelli grandi si correggono
      if (Math.hypot(s.x - m.x, s.y - m.y) > gameConfig.world.reconcile_px || !s.moving) {
        m.x = s.x;
        m.y = s.y;
      }
      m.path = (s.path ?? []).map(([x, y]) => ({ x, y }));
      m.facing = s.facing;
    }
    for (const id of gone) {
      const r = this.remotes.get(id);
      r?.sprite.destroy();
      r?.label.destroy();
      this.remotes.delete(id);
    }
  }

  private reconcile(s: PlayerSnapshot): void {
    const m = this.me.mover;
    const d = Math.hypot(s.x - m.x, s.y - m.y);
    const limit = gameConfig.world.reconcile_px;
    if ((!s.moving && !m.path.length && d > limit) || d > limit * 4) {
      m.x = s.x;
      m.y = s.y;
      if (d > limit * 4) m.path = [];
    }
  }

  /** Riposiziona (riconnessione: il server rimette il giocatore nel villaggio). */
  teleport(p: Point): void {
    Object.assign(this.me.mover, { x: p.x, y: p.y, path: [] });
    this.me.pendingPlace = null;
  }

  showEmote(playerId: number, emote: string): void {
    const actor = playerId === this.init.me.id ? this.me : this.remotes.get(playerId);
    if (!actor) return;
    const t = this.add
      .text(actor.sprite.x, actor.sprite.y - 52, emote, { fontSize: '22px' })
      .setOrigin(0.5, 1)
      .setScale(1 / this.zoom)
      .setResolution(window.devicePixelRatio || 1)
      .setDepth(UI_DEPTH);
    this.tweens.add({
      targets: t,
      y: t.y - 10,
      alpha: { from: 1, to: 0 },
      ease: 'Cubic.easeIn',
      duration: gameConfig.world.emote_duration_ms,
      onComplete: () => t.destroy(),
    });
  }

  /** Fumetto con una battuta dell'NPC (npcs.json). */
  say(place: Place, text: string): void {
    this.events.emit('say', { zone: place.name, text });
    // una battuta nuova sostituisce quella ancora a schermo dello stesso NPC
    this.bubbles.get(place.name)?.destroy();
    const t = this.add
      .text(place.x, place.y - 46, text, {
        fontFamily: '"DM Sans", sans-serif',
        fontSize: '13px',
        color: C.primary,
        backgroundColor: '#ffffff',
        padding: { x: 8, y: 6 },
        wordWrap: { width: 220 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setScale(1 / this.zoom)
      .setResolution(window.devicePixelRatio || 1)
      .setDepth(UI_DEPTH);
    this.bubbles.set(place.name, t);
    this.time.delayedCall(4000, () =>
      this.tweens.add({
        targets: t,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          if (this.bubbles.get(place.name) === t) this.bubbles.delete(place.name);
          t.destroy();
        },
      }),
    );
  }

  /** Cammina verso una zona come dopo un tap (banner del drop, test end-to-end). */
  goTo(zone: string): void {
    const place = this.place(zone);
    if (place) this.walkTo(place.approach ?? place, place);
  }

  /** Battuta dell'NPC di una zona, anche senza esserci arrivati (drop aperto, MC Suola che restituisce). */
  sayAt(zone: string, text: string): void {
    const place = this.place(zone);
    if (place) this.say(place, text);
  }

  private place(zone: string): Place | undefined {
    return this.village.places.find((p) => p.name === zone);
  }

  /** Solo per i test end-to-end in sviluppo (vedi main.ts). */
  debugState(): { me: Point; remotes: { id: number; x: number; y: number }[] } {
    return {
      me: { x: this.me.mover.x, y: this.me.mover.y },
      remotes: [...this.remotes].map(([id, r]) => ({ id, x: r.sprite.x, y: r.sprite.y })),
    };
  }

  npcInfo(place: Place): NpcInfo | undefined {
    return npcByZone.get(place.name);
  }

  private nameLabel(text: string, mine: boolean): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, text, {
        fontFamily: '"DM Sans", sans-serif',
        fontSize: '11px',
        fontStyle: '600',
        color: mine ? C['accent-400'] : '#ffffff',
        stroke: C['accent-900'],
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setScale(1 / this.zoom)
      .setResolution(window.devicePixelRatio || 1)
      .setDepth(DEPTH_ROOFS + 2);
  }
}
