import Phaser from 'phaser';
import { C2S, S2C, type AvatarLook, type InventoryUpdated, type Place, type RunState, type StateInit } from '@sp/shared';
import { gameConfig } from './config';
import { partsFromLook } from './game/AvatarSprite';
import { avatarThumb } from './game/avatarThumb';
import { createApi, type Api } from './net/api';
import { getDeviceId } from './net/device';
import { ACK_TIMEOUT_MS, RequestError, connectSocket, forgetRecover, request, type GameSocket } from './net/socket';
import { AvatarScene } from './scenes/AvatarScene';
import { BOOT_PROGRESS, BOOT_READY, BootScene } from './scenes/BootScene';
import { VillageScene } from './scenes/VillageScene';
import { openAuth } from './ui/auth';
import { showAvatarPicker } from './ui/avatar';
import { openBank } from './ui/bank';
import { hideDropBanner, showDropBanner } from './ui/banner';
import { openBoard } from './ui/board';
import { toast } from './ui/dom';
import { openEnoteca } from './ui/enoteca';
import { showBlocker, showHud } from './ui/hud';
import { showLanding } from './ui/landing';
import { openLeaderboard } from './ui/leaderboard';
import { openLegend } from './ui/legend';
import { npcLine } from './ui/npc';
import { panelsOpen } from './ui/panel';
import { openPassport } from './ui/passport';
import { openProfile } from './ui/profile';
import { showReveal } from './ui/reveal';
import { beatText, hideBeat, showBeat, type BeatAction } from './ui/run';
import { shoeName } from './ui/shoe';
import { openShop } from './ui/shop';
import { openStall } from './ui/stall';
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
/** Prima run del giocatore (state.init, avatar.set, run.end). */
let run: RunState | null = null;
/** Codice digitato sulla landing per rientrare: il server non lo rimostra a questo telefono, lo teniamo in memoria. */
let knownCode: string | null = null;
let ready = false;

const formatCode = (code: string) => {
  let i = 0;
  return gameConfig.player.recovery_code.display_format.replace(/X/g, () => code[i++] ?? '');
};

function enter(recoverCode?: string): void {
  landing.setBusy(true);
  const { id } = getDeviceId();
  // un tentativo di codice fallito ha chiuso la connessione: se ne apre una nuova
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = connectSocket(id, recoverCode);
  api = createApi(socket);
  const s = socket;
  s.on(S2C.STATE_INIT, (state) => {
    if (!ready && recoverCode) knownCode = formatCode(recoverCode);
    ready = true;
    forgetRecover(s, id);
    void onState(state);
  });
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
  socket.on(S2C.STALL_UPDATED, () => publish('stall'));
  socket.on(S2C.DROP_ANNOUNCE, (d) => {
    store.drop = { ...store.drop, current: d };
    publish('drop');
    const line = npcLine('banca', 'drop_open', { qty: d.quantity, item: shoeName(d.itemId), price: d.price });
    if (line) village()?.sayAt('banca', line);
    showDropBanner(d, () => village()?.goTo('banca'));
  });
  socket.on(S2C.DROP_UPDATE, (m) => {
    if (store.drop.current?.dropId === m.dropId) store.drop = { ...store.drop, current: { ...store.drop.current, sold: m.sold } };
    publish('drop');
  });
  socket.on(S2C.DROP_CLOSED, (m) => {
    if (store.drop.current?.dropId === m.dropId) store.drop = { current: null, nextAt: m.nextAt };
    hideDropBanner();
    publish('drop');
  });
  socket.on(S2C.LEGEND_RETURNED, (m) => {
    const item = store.inventory.find((i) => i.assetId === m.assetId);
    const line = npcLine('palco', 'returned');
    if (line) village()?.sayAt('palco', line);
    if (item) toast(T.legendBack(shoeName(item.itemId)));
    publish('asset', m.assetId);
  });
  socket.on(S2C.RUN_BEAT, (m) => onBeat(m.beatId));
  socket.on(S2C.RUN_END, (r) => {
    run = run ? { ...run, completed: true, merchant: r.merchant } : run;
    hud?.setRun(run);
    hideBeat();
    if (api) showReveal(api, r, knownCode);
  });
  socket.on(S2C.ERROR, (e) => {
    if (!ready) {
      // sessione rifiutata prima di entrare (codice sbagliato, villaggio pieno…): si chiude e si può riprovare
      s.disconnect();
      landing.setBusy(false);
      if (e.code === 'CODE_NOT_FOUND' || e.code === 'RECOVER_LIMIT') landing.recoverError(e.message);
      else toast(e.message);
      return;
    }
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
    __sp: { village: () => village()?.debugState() ?? null, goTo: (zone: string) => village()?.goTo(zone), emotes: debugEmotes, says },
  });
}

/** state.init arriva alla connessione e a ogni riconnessione: riallinea tutto. */
async function onState(state: StateInit): Promise<void> {
  store.me = { id: state.player.id, nickname: state.player.nickname };
  store.clockOffset = state.serverTime - Date.now();
  store.drop = state.drop;
  store.legendReadyAt = state.player.legendReadyAt;
  run = state.run;
  hud?.setRun(run);
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
  const body = random(a.body_types.length);
  const hairs = a.hair_by_body[a.body_types[body]];
  const initial: AvatarLook = {
    body,
    skin: random(a.skin_tones.length),
    hair: hairs[random(hairs.length)],
    hairColor: random(a.hair_colors.length),
    outfit: random(a.outfit_colors.length),
  };
  game.scene.start('Avatar', { parts: partsFromLook(initial, state.player.shoesColor) });
  const preview = () => game.scene.getScene('Avatar') as AvatarScene;
  const picker = showAvatarPicker(
    initial,
    state.player.nickname,
    (look) => preview().setParts(partsFromLook(look, state.player.shoesColor)),
    async (look, nickname) => {
      try {
        const res = await request<{ x: number; y: number; nickname: string; run: RunState }>(() =>
          socket!.timeout(ACK_TIMEOUT_MS).emitWithAck(C2S.AVATAR_SET, { ...look, nickname }),
        );
        picker.close();
        window.removeEventListener('resize', fit);
        game.scene.stop('Avatar');
        store.me = { ...store.me, nickname: res.nickname };
        run = res.run;
        startVillage({ ...state, player: { ...state.player, nickname: res.nickname, avatar: look } }, look, res);
      } catch (err) {
        if (err instanceof RequestError && err.code.startsWith('NICKNAME_')) picker.nameError(err.message);
        else toast(err instanceof RequestError ? err.message : String(err));
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
  hud = showHud(player.nickname, {
    onEmote(emote) {
      void request(() => socket!.timeout(ACK_TIMEOUT_MS).emitWithAck(C2S.EMOTE_SEND, { emote })).catch((err: RequestError) =>
        toast(err.message),
      );
    },
    onWardrobe() {
      if (api && !panelsOpen()) openWardrobe(api);
    },
    onLeaderboard: leaderboard,
    onProfile() {
      if (!api || panelsOpen()) return;
      const a = api;
      openProfile(
        { nickname: store.me.nickname, code: state.player.recoveryCode ?? knownCode, run },
        async () => showReveal(a, await a.runReveal(), knownCode),
        leaderboard,
      );
    },
  });
  hud.setWallet(store.coins, store.wardrobeValue);
  hud.setRun(run);
}

function leaderboard(): void {
  if (api && !panelsOpen()) openLeaderboard(api, (look, shoesColor) => avatarThumb(game.textures, partsFromLook(look, shoesColor)));
}

/** Beat della prima run: un banner, e dove serve un bottone che porta al posto giusto. */
function onBeat(beatId: string): void {
  if (!run || !inVillage) return;
  const text = beatText(beatId, run);
  if (!text) return;
  const go = (zone: string): BeatAction => ({ label: T.beatGo, run: () => village()?.goTo(zone) });
  const actions: Record<string, BeatAction | undefined> = {
    tooltip_passport: {
      label: T.beatOpen,
      run: () => {
        const shoe = store.inventory[0];
        if (api && shoe && !panelsOpen()) openPassport(api, shoe.assetId);
      },
    },
    hint_stall: go('bancarella'),
    hint_legend: go('palco'),
    hint_market: go('bacheca'),
  };
  showBeat(text, actions[beatId]);
}

// conti alla rovescia nei pannelli aperti (drop, MC Suola) e nell'HUD (prima run)
setInterval(() => {
  publish('tick');
  hud?.tick();
}, 1000);

/** All'arrivo da un NPC si apre il suo pannello. */
function talk(place: Place): void {
  const scene = village();
  if (!scene || !api || panelsOpen()) return;
  const say = (line: string | null) => line && scene.say(place, line);
  switch (place.type === 'board' ? 'bacheca' : place.name) {
    case 'bacheca':
      return openBoard(api);
    case 'negozio': {
      const line = npcLine('negozio', 'idle');
      say(line);
      return void openShop(api, line);
    }
    case 'bancarella':
      return openStall(api, () => say(npcLine('bancarella', 'after_sale')));
    case 'autenticatore':
      return openAuth(api, say);
    case 'palco':
      return openLegend(api, say);
    case 'banca':
      return openBank(api);
    case 'enoteca': {
      const line = npcLine('enoteca', 'idle');
      say(line);
      return openEnoteca(line);
    }
    default:
      say(npcLine(place.name, 'idle'));
  }
}
