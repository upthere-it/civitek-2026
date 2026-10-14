import Phaser from 'phaser';
import { C2S, S2C, type AvatarLook, type InventoryUpdated, type Place, type StateInit } from '@sp/shared';
import { gameConfig } from './config';
import { partsFromLook } from './game/AvatarSprite';
import { createApi, type Api } from './net/api';
import { getDeviceId } from './net/device';
import { ACK_TIMEOUT_MS, RequestError, connectSocket, request, type GameSocket } from './net/socket';
import { AvatarScene } from './scenes/AvatarScene';
import { BOOT_PROGRESS, BOOT_READY, BootScene } from './scenes/BootScene';
import { VillageScene } from './scenes/VillageScene';
import { showAvatarPicker } from './ui/avatar';
import { openBoard } from './ui/board';
import { toast } from './ui/dom';
import { showBlocker, showHud } from './ui/hud';
import { showLanding } from './ui/landing';
import { panelsOpen } from './ui/panel';
import { shoeName } from './ui/shoe';
import { openShop } from './ui/shop';
import { publish, store } from './ui/store';
import { T } from './ui/texts';
import { openWardrobe } from './ui/wardrobe';

// Colori del brand solo da config (CLAUDE.md, regola 10)
for (const [name, value] of Object.entries(gameConfig.brand.colors)) {
  document.documentElement.style.setProperty(`--up-${name}`, value);
}

// Il testo nel canvas va creato a font caricati. `document.fonts.ready` da solo non basta: un @font-face
// che nessun elemento del DOM usa non viene scaricato, quindi va richiesto esplicitamente.
const fontsReady = Promise.all([
  document.fonts.load('600 16px Chillax'),
  document.fonts.load('400 16px "DM Sans"'),
  document.fonts.load('600 16px "DM Sans"'),
]).catch(() => undefined);

const game = new Phaser.Game({
  // Solo WebGL: il tint dei layer dell'avatar non funziona col renderer Canvas (docs/ASSETS.md §3)
  type: Phaser.WEBGL,
  parent: 'game',
  pixelArt: true,
  backgroundColor: gameConfig.brand.colors['accent-900'],
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, AvatarScene, VillageScene],
});

const assetsReady = new Promise<void>((resolve) => {
  if (game.registry.get(BOOT_READY)) resolve();
  else game.events.once(BOOT_READY, () => resolve());
});

const landing = showLanding(enter);
game.events.on(BOOT_PROGRESS, (p: number) => landing.setProgress(p));

let socket: GameSocket | null = null;
let api: Api | null = null;
let hud: ReturnType<typeof showHud> | null = null;
let inVillage = false;

function enter(): void {
  landing.setBusy(true);
  const { id } = getDeviceId();
  socket = connectSocket(id);
  api = createApi(socket);
  socket.on(S2C.STATE_INIT, (state) => void onState(state));
  socket.on(S2C.WORLD_PLAYERS, (m) => village()?.applySnapshots(m.players, m.gone));
  socket.on(S2C.WORLD_EMOTE, (m) => {
    if (import.meta.env.DEV) debugEmotes.push(m);
    village()?.showEmote(m.playerId, m.emote);
  });
  socket.on(S2C.WALLET_UPDATED, (m) => {
    store.coins = m.coins;
    store.wardrobeValue = m.wardrobeValue;
    hud?.setWallet(m.coins, m.wardrobeValue);
    publish('inventory');
  });
  socket.on(S2C.INVENTORY_UPDATED, (m) => setInventory(m, true));
  socket.on(S2C.MARKET_UPDATED, () => publish('market'));
  socket.on(S2C.ASSET_UPDATED, (m) => publish('asset', m.assetId));
  socket.on(S2C.ASSET_CERTIFIED, (m) => publish('asset', m.assetId));
  socket.on(S2C.ERROR, (e) => {
    if (e.code === 'SESSION_REPLACED') showBlocker(e.message, T.replacedCta, () => socket?.connect());
    else toast(e.message);
  });
  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect' && reason !== 'io client disconnect') toast(T.offline);
  });
}

const village = () => (inVillage ? (game.scene.getScene('Village') as VillageScene) : null);

/** Saldo e scarpe dal server. Una scarpa in bacheca che sparisce dall'armadio è stata venduta: lo diciamo. */
function setInventory(m: InventoryUpdated, notifySales: boolean): void {
  if (notifySales) {
    for (const old of store.inventory) {
      if (old.listingPrice !== null && !m.inventory.some((i) => i.assetId === old.assetId)) {
        toast(T.sold(shoeName(old.itemId), old.listingPrice));
      }
    }
  }
  store.coins = m.coins;
  store.wardrobeValue = m.wardrobeValue;
  store.inventory = m.inventory;
  hud?.setWallet(m.coins, m.wardrobeValue);
  publish('inventory');
}

// Hook per i test end-to-end (Playwright): solo in sviluppo, Vite lo toglie dalla build di produzione.
const debugEmotes: { playerId: number; emote: string }[] = [];
if (import.meta.env.DEV) {
  const says: { zone: string; text: string }[] = [];
  game.events.on('village-ready', (scene: VillageScene) => scene.events.on('say', (m: { zone: string; text: string }) => says.push(m)));
  Object.assign(window, {
    __sp: { village: () => village()?.debugState() ?? null, goTo: (zone: string) => village()?.debugGoTo(zone), emotes: debugEmotes, says },
  });
}

/** state.init arriva alla connessione e a ogni riconnessione: riallinea tutto. */
async function onState(state: StateInit): Promise<void> {
  store.me = { id: state.player.id, nickname: state.player.nickname };
  store.clockOffset = state.serverTime - Date.now();
  setInventory({ coins: state.player.coins, wardrobeValue: state.wardrobeValue, inventory: state.inventory }, false);
  // dopo una riconnessione i pannelli aperti si ricaricano
  publish('market');
  await Promise.all([assetsReady, fontsReady]);
  landing.close();
  if (!state.player.avatar || !state.position) {
    pickAvatar(state);
    return;
  }
  if (inVillage) {
    village()?.teleport(state.position);
    return;
  }
  startVillage(state, state.player.avatar, state.position);
}

function pickAvatar(state: StateInit): void {
  const a = gameConfig.avatar;
  const random = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const initial: AvatarLook = {
    skin: random(a.skin_tones.length),
    hair: random(a.hair_styles.length),
    hairColor: random(a.hair_colors.length),
    outfit: random(a.outfit_colors.length),
  };
  game.scene.start('Avatar', { parts: partsFromLook(initial, state.player.shoesColor) });
  const preview = () => game.scene.getScene('Avatar') as AvatarScene;
  const picker = showAvatarPicker(
    initial,
    (look) => preview().setParts(partsFromLook(look, state.player.shoesColor)),
    async (look) => {
      try {
        const pos = await request<{ x: number; y: number }>(() => socket!.timeout(ACK_TIMEOUT_MS).emitWithAck(C2S.AVATAR_SET, look));
        picker.close();
        window.removeEventListener('resize', fit);
        game.scene.stop('Avatar');
        startVillage({ ...state, player: { ...state.player, avatar: look } }, look, pos);
      } catch (err) {
        toast(err instanceof RequestError ? err.message : String(err));
      }
    },
  );
  const fit = () => requestAnimationFrame(() => preview().setBox(picker.previewBox()));
  window.addEventListener('resize', fit);
  fit();
}

function startVillage(state: StateInit, look: AvatarLook, position: { x: number; y: number }): void {
  inVillage = true;
  const { player } = state;
  game.scene.start('Village', {
    me: { id: player.id, nickname: player.nickname, profile: { nickname: player.nickname, look, shoesColor: player.shoesColor }, position },
    onMove: (target: { x: number; y: number }) => {
      socket?.timeout(ACK_TIMEOUT_MS).emit(C2S.MOVE_TO, target, () => undefined);
    },
    onPlace: (place: Place) => talk(place),
  });
  if (import.meta.env.DEV) game.events.emit('village-ready', game.scene.getScene('Village'));
  hud = showHud(
    player.nickname,
    (emote) => {
      void request(() => socket!.timeout(ACK_TIMEOUT_MS).emitWithAck(C2S.EMOTE_SEND, { emote })).catch((err: RequestError) =>
        toast(err.message),
      );
    },
    () => {
      if (api && !panelsOpen()) openWardrobe(api);
    },
  );
  hud.setWallet(store.coins, store.wardrobeValue);
}

/**
 * All'arrivo l'NPC dice una battuta; Negozio e Bacheca aprono il loro pannello. Gli altri pannelli (banca,
 * Tony Affari, Dott.ssa Hash, MC Suola, enoteca) arrivano con M3.
 */
function talk(place: Place): void {
  const scene = village();
  if (!scene || !api || panelsOpen()) return;
  if (place.type === 'board') {
    openBoard(api);
    return;
  }
  const lines = scene.npcInfo(place)?.lines.idle ?? [];
  const line = lines.length ? lines[crypto.getRandomValues(new Uint32Array(1))[0] % lines.length] : null;
  if (line) scene.say(place, line);
  if (place.name === 'negozio') void openShop(api, line);
}
