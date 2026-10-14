// M1: handshake col device_id, avatar, presenza nel raggio, emote, sessione unica, rate limit, certificazione.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  C2S,
  S2C,
  isWalkable,
  type ClientToServerEvents,
  type ErrorEvent,
  type ServerToClientEvents,
  type StateInit,
  type WorldEmote,
  type WorldPlayers,
} from '@sp/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { CHAIN_NOTARY } from '../src/chain/chain-notary';
import { MockNotary } from '../src/chain/mock-notary';
import { WorldService } from '../src/game/world.service';
import { recoveryHash } from '../src/game/identity';
import { DbService } from '../src/db/db.service';
import { cfg } from './helpers/db';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: INestApplication;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_NOTARY)
    .useValue(new MockNotary({ min_delay_ms: 0, max_delay_ms: 0 }))
    .compile();
  app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

afterAll(() => app.close());

function connect(deviceId: string = randomUUID()): { socket: Client; init: Promise<StateInit>; error: Promise<ErrorEvent> } {
  const socket: Client = io(url, { auth: { deviceId }, transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(socket);
  return {
    socket,
    init: new Promise((resolve) => socket.once(S2C.STATE_INIT, resolve)),
    error: new Promise((resolve) => socket.once(S2C.ERROR, resolve)),
  };
}

// ragazza con i capelli lunghi (in avatar.hair_by_body.ragazza)
const LOOK = { body: 1, skin: 1, hair: 1, hairColor: 3, outfit: 4 };

async function inWorld(deviceId = randomUUID()) {
  const c = connect(deviceId);
  const init = await c.init;
  const res = await c.socket.timeout(3000).emitWithAck(C2S.AVATAR_SET, { ...LOOK, nickname: init.player.nickname });
  if (!res.ok) throw new Error(res.code);
  return { ...c, init, position: res.data };
}

/** Aspetta un messaggio che soddisfa la condizione (o fallisce dopo `ms`). */
function waitFor<T>(socket: Client, event: keyof ServerToClientEvents, pred: (m: T) => boolean, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`timeout in attesa di ${event}`));
    }, ms);
    const handler = (m: T) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(m);
    };
    socket.on(event, handler as never);
  });
}

describe('handshake', () => {
  it('nuovo device: giocatore con nickname generato, monete, scarpa regalo e codice di recupero', async () => {
    const deviceId = randomUUID();
    const init = await connect(deviceId).init;
    const start = cfg.player.start_coins;

    expect(init.player.nickname).toMatch(/^[A-Z][a-z]+\d{2,3}$/);
    expect(init.player.coins).toBe(start);
    expect(init.player.avatar).toBeNull();
    expect(init.position).toBeNull();
    expect(init.inventory).toHaveLength(1);
    const gift = init.inventory[0];
    expect(cfg.player.starter_item_pool).toContain(gift.itemId);
    expect(gift.perceivedValue).toBe(cfg.item(gift.itemId)!.base_value);
    expect(init.wardrobeValue).toBe(start + gift.perceivedValue);
    expect(init.player.shoesColor).toBe(cfg.item(gift.itemId)!.palette.upper);

    // codice "XXX-XXX" dall'alfabeto senza caratteri ambigui; nel DB c'è solo il suo hash
    const { alphabet } = cfg.player.recovery_code;
    expect(init.player.recoveryCode).toMatch(new RegExp(`^[${alphabet}]{3}-[${alphabet}]{3}$`));
    const [row] = await app.get(DbService).select<{ recovery_hash: string; device_hash: string }>(
      'SELECT recovery_hash, device_hash FROM players WHERE id = ?',
      [init.player.id],
    );
    expect(row.recovery_hash).toBe(recoveryHash(init.player.recoveryCode!));
    expect(row.device_hash).not.toContain(deviceId.slice(0, 8));
  });

  it('stesso device: stesso giocatore e stesso codice', async () => {
    const deviceId = randomUUID();
    const first = await connect(deviceId).init;
    clients.splice(0).forEach((c) => c.disconnect());
    const again = await connect(deviceId).init;
    expect(again.player.id).toBe(first.player.id);
    expect(again.player.recoveryCode).toBe(first.player.recoveryCode);
    expect(again.inventory).toEqual(first.inventory);
  });

  it('device_id non valido: errore e disconnessione', async () => {
    const c = connect('non-un-uuid');
    expect(await c.error).toMatchObject({ code: 'DEVICE_INVALID' });
  });

  it('una seconda scheda dello stesso device sostituisce la prima', async () => {
    const deviceId = randomUUID();
    const first = connect(deviceId);
    await first.init;
    await connect(deviceId).init;
    expect(await first.error).toMatchObject({ code: 'SESSION_REPLACED' });
  });
});

describe('nome scelto alla creazione (D12)', () => {
  const create = async (nickname: string) => {
    const c = connect();
    await c.init;
    return { c, res: await c.socket.emitWithAck(C2S.AVATAR_SET, { ...LOOK, nickname }) };
  };

  it('nome valido: salvato (spazi ai bordi tolti), visibile al rientro, poi non si cambia più', async () => {
    const name = `Ninja${Date.now().toString(36).slice(-6)}`;
    const { c, res } = await create(`  ${name} `);
    expect(res).toMatchObject({ ok: true, data: { nickname: name } });
    expect(await c.socket.emitWithAck(C2S.AVATAR_SET, { ...LOOK, nickname: 'AltroNome1' })).toMatchObject({
      code: 'AVATAR_ALREADY_SET',
    });
  });

  it('nome già preso (anche con maiuscole o accenti diversi), non valido, vietato', async () => {
    const name = `Gufetto${Date.now().toString(36).slice(-5)}`;
    expect((await create(name)).res.ok).toBe(true);
    expect((await create(name.toUpperCase())).res).toMatchObject({ ok: false, code: 'NICKNAME_TAKEN', message: 'Questo nome è già preso: provane un altro.' });
    expect((await create('ab')).res).toMatchObject({ code: 'NICKNAME_INVALID' });
    expect((await create('Mario Rossi')).res).toMatchObject({ code: 'NICKNAME_INVALID' });
    expect((await create('C4zz0ne')).res).toMatchObject({ code: 'NICKNAME_BLOCKED' });
    expect((await create('NikeFan')).res).toMatchObject({ code: 'NICKNAME_BLOCKED' });
  });

  it('lo stile ragazza arriva agli altri nel profilo', async () => {
    const deviceId = randomUUID();
    await inWorld(deviceId);
    clients.splice(0).forEach((c) => c.disconnect());
    const again = await connect(deviceId).init;
    expect(again.player.avatar).toMatchObject({ body: 1 });
  });
});

describe('avatar', () => {
  it('si sceglie una volta, con indici validi, e fa entrare nel villaggio', async () => {
    const c = connect();
    const { player } = await c.init;
    const set = { ...LOOK, nickname: player.nickname };
    expect(await c.socket.emitWithAck(C2S.MOVE_TO, { x: 10, y: 10 })).toMatchObject({ ok: false, code: 'AVATAR_REQUIRED' });
    const boyOnly = cfg.config.avatar.hair_by_body.ragazzo.find((i) => !cfg.config.avatar.hair_by_body.ragazza.includes(i))!;
    for (const bad of [
      { skin: cfg.config.avatar.skin_tones.length },
      { body: cfg.config.avatar.body_types.length },
      { hair: boyOnly }, // acconciatura che lo stile ragazza non propone
    ]) {
      expect(await c.socket.emitWithAck(C2S.AVATAR_SET, { ...set, ...bad })).toMatchObject({ ok: false, code: 'AVATAR_INVALID' });
    }
    const ok = await c.socket.emitWithAck(C2S.AVATAR_SET, set);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(isWalkable(app.get(WorldService).village.grid, ok.data)).toBe(true);
      expect(ok.data.nickname).toBe(player.nickname);
    }
    expect(await c.socket.emitWithAck(C2S.AVATAR_SET, set)).toMatchObject({ ok: false, code: 'AVATAR_ALREADY_SET' });
  });

  it('al rientro l’avatar c’è già e si parte nel villaggio', async () => {
    const deviceId = randomUUID();
    const first = await inWorld(deviceId);
    clients.splice(0).forEach((c) => c.disconnect());
    const again = await connect(deviceId).init;
    expect(again.player.avatar).toEqual(LOOK);
    expect(again.position).not.toBeNull();
    expect(again.player.id).toBe(first.init.player.id);
  });
});

describe('villaggio', () => {
  it('due giocatori si vedono, con profilo, e vedono gli spostamenti', async () => {
    const a = await inWorld();
    const b = await inWorld();
    const seenA = await waitFor<WorldPlayers>(b.socket, S2C.WORLD_PLAYERS, (m) =>
      m.players.some((p) => p.id === a.init.player.id && p.profile),
    );
    const profile = seenA.players.find((p) => p.id === a.init.player.id)!.profile!;
    expect(profile).toEqual({ nickname: a.init.player.nickname, look: LOOK, shoesColor: a.init.player.shoesColor });

    const target = { x: a.position.x + 40, y: a.position.y };
    const res = await a.socket.emitWithAck(C2S.MOVE_TO, target);
    expect(res.ok).toBe(true);
    let messages = 0;
    const count = (m: WorldPlayers) => {
      if (m.players.some((p) => p.id === a.init.player.id)) messages++;
    };
    b.socket.on(S2C.WORLD_PLAYERS, count);
    const moving = await waitFor<WorldPlayers>(b.socket, S2C.WORLD_PLAYERS, (m) =>
      m.players.some((p) => p.id === a.init.player.id && p.moving),
    );
    const start = moving.players.find((p) => p.id === a.init.player.id)!;
    expect(start.facing).toBe('right');
    // il percorso arriva una volta sola: B lo simula da sé fino alla destinazione
    expect(start.path![start.path!.length - 1]).toEqual([Math.round(target.x), Math.round(target.y)]);
    const arrived = await waitFor<WorldPlayers>(b.socket, S2C.WORLD_PLAYERS, (m) =>
      m.players.some((p) => p.id === a.init.player.id && !p.moving),
    );
    const end = arrived.players.find((p) => p.id === a.init.player.id)!;
    expect(Math.abs(end.x - Math.round(target.x))).toBeLessThanOrEqual(1);
    // 40 px a walk_speed_px_s sono più tick: ma i messaggi su A sono solo partenza e arrivo
    b.socket.off(S2C.WORLD_PLAYERS, count);
    expect(messages).toBe(2);
  });

  it('chi esce dal villaggio sparisce per gli altri', async () => {
    const a = await inWorld();
    const b = await inWorld();
    await waitFor<WorldPlayers>(b.socket, S2C.WORLD_PLAYERS, (m) => m.players.some((p) => p.id === a.init.player.id));
    a.socket.disconnect();
    await waitFor<WorldPlayers>(b.socket, S2C.WORLD_PLAYERS, (m) => m.gone.includes(a.init.player.id));
  });

  it('emote: arriva a chi è vicino; solo quelle della config', async () => {
    const a = await inWorld();
    const b = await inWorld();
    const emote = cfg.config.world.emotes[0];
    const got = waitFor<WorldEmote>(b.socket, S2C.WORLD_EMOTE, (m) => m.playerId === a.init.player.id);
    expect(await a.socket.emitWithAck(C2S.EMOTE_SEND, { emote })).toEqual({ ok: true });
    expect(await got).toEqual({ playerId: a.init.player.id, emote });
    expect(await a.socket.emitWithAck(C2S.EMOTE_SEND, { emote: 'ciao a tutti' })).toMatchObject({
      ok: false,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('rate limit: oltre rate_limit_actions_per_sec le azioni rispondono BUSY', async () => {
    const a = await inWorld();
    const emote = cfg.config.world.emotes[1];
    const burst = cfg.player.rate_limit_actions_per_sec * 2;
    const results = await Promise.all(Array.from({ length: burst }, () => a.socket.emitWithAck(C2S.EMOTE_SEND, { emote })));
    const busy = results.filter((r) => !r.ok && r.code === 'BUSY').length;
    expect(busy).toBeGreaterThanOrEqual(burst - cfg.player.rate_limit_actions_per_sec - 1);
  });
});

describe('certificazione', () => {
  it('il proprietario riceve asset.certified quando il regalo è notarizzato', async () => {
    const c = connect();
    const init = await c.init;
    const certified = await waitFor<{ assetId: number; txHash: string }>(
      c.socket,
      S2C.ASSET_CERTIFIED,
      (m) => m.assetId === init.inventory[0].assetId,
      cfg.chain.batch_interval_ms * 3,
    );
    expect(certified.txHash).toMatch(/^mock-[0-9a-f]{64}$/);
  });
});
