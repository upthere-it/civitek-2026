// Accettazione M4: suggerimenti dei primi minuti e classifica live.
// I loop sono spenti (GAME_LOOPS=off): RunService.tick() si chiama a mano, con l'orologio che serve.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  C2S,
  S2C,
  type ClientToServerEvents,
  type Leaderboard,
  type RunBeat,
  type ServerToClientEvents,
  type StateInit,
} from '@sp/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { CHAIN_NOTARY } from '../src/chain/chain-notary';
import { MockNotary } from '../src/chain/mock-notary';
import { LeaderboardService } from '../src/game/leaderboard.service';
import { RunService } from '../src/game/run.service';
import { cfg, openTestDb } from './helpers/db';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: INestApplication;
let url: string;
const clients: Client[] = [];
const { db } = openTestDb();
const run = cfg.config.first_run;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_NOTARY)
    .useValue(new MockNotary({ min_delay_ms: 0, max_delay_ms: 0 }))
    .compile();
  app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await app.close();
  await db.onModuleDestroy();
});

function connect(auth: { deviceId: string }): Client {
  const socket: Client = io(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(socket);
  return socket;
}

async function player(deviceId: string = randomUUID()): Promise<{ socket: Client; init: StateInit; deviceId: string }> {
  const socket = connect({ deviceId });
  const init = await new Promise<StateInit>((resolve) => socket.once(S2C.STATE_INIT, resolve));
  return { socket, init, deviceId };
}

const LOOK = { body: 1, skin: 0, hair: 1, hairColor: 0, outfit: 0 };

/** Giocatore con l'avatar pronto: la prima run parte qui. */
async function inVillage(): Promise<{ socket: Client; init: StateInit; deviceId: string }> {
  const p = await player();
  ok(await p.socket.emitWithAck(C2S.AVATAR_SET, { ...LOOK, nickname: p.init.player.nickname }));
  return p;
}

function collect<T>(socket: Client, event: keyof ServerToClientEvents): T[] {
  const out: T[] = [];
  socket.on(event, ((m: T) => out.push(m)) as never);
  return out;
}

function next<T>(socket: Client, event: keyof ServerToClientEvents, ms = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), ms);
    socket.once(event, ((m: T) => {
      clearTimeout(timer);
      resolve(m);
    }) as never);
  });
}

const ok = <T>(r: { ok: true; data: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(`atteso ok, ricevuto ${r.code}`);
  return r.data;
};

const flush = () => new Promise((r) => setTimeout(r, 100));

/** Inizio dei suggerimenti in epoch ms (orologio del DB). */
async function startedAt(playerId: number): Promise<number> {
  const [r] = await db.select<{ ms: number }>('SELECT ROUND(UNIX_TIMESTAMP(first_run_started_at) * 1000) AS ms FROM players WHERE id = ?', [
    playerId,
  ]);
  return Number(r.ms);
}

describe('M4: suggerimenti dei primi minuti', () => {
  it('partono alla creazione dell’avatar e arrivano al loro secondo, una volta sola', async () => {
    const { socket, init } = await inVillage();
    const t0 = await startedAt(init.player.id);
    expect(t0).toBeGreaterThan(0);

    const beats = collect<RunBeat>(socket, S2C.RUN_BEAT);
    const runs = app.get(RunService);
    runs.tick(t0);
    runs.tick(t0 + 45_000);
    await flush();
    expect(beats.map((b) => b.beatId)).toEqual(run.beats.filter((b) => b.at_sec <= 45).map((b) => b.id));

    const last = Math.max(...run.beats.map((b) => b.at_sec));
    runs.tick(t0 + last * 1000);
    runs.tick(t0 + last * 1000 + 60_000);
    await flush();
    expect(beats.map((b) => b.beatId)).toEqual(run.beats.map((b) => b.id));
  });

  it('una riconnessione non ripete i suggerimenti già passati, e l’inizio non cambia', async () => {
    const { init, deviceId, socket } = await inVillage();
    await db.select('UPDATE players SET first_run_started_at = NOW(6) - INTERVAL 100 SECOND WHERE id = ?', [init.player.id]);
    const t0 = await startedAt(init.player.id);
    socket.disconnect();
    const again = await player(deviceId);
    expect(await startedAt(init.player.id)).toBe(t0);
    const beats = collect<RunBeat>(again.socket, S2C.RUN_BEAT);
    app.get(RunService).tick(t0 + 100_000);
    await flush();
    expect(beats).toEqual([]);
  });
});

describe('M4: classifica', () => {
  it('top per valore armadio, solo giocatori veri, e la propria posizione', async () => {
    const a = await inVillage();
    app.get(LeaderboardService).invalidate();
    const board = ok(await a.socket.emitWithAck(C2S.LEADERBOARD_GET, {}));
    expect(board.top.length).toBeLessThanOrEqual(cfg.config.leaderboard.size);
    expect(board.top.every((r) => r.playerId >= 1000)).toBe(true);
    for (let i = 1; i < board.top.length; i++) expect(board.top[i - 1].value).toBeGreaterThanOrEqual(board.top[i].value);
    expect(board.top.map((r) => r.rank)).toEqual(board.top.map((_, i) => i + 1));
    expect(board.me).toMatchObject({ playerId: a.init.player.id, nickname: a.init.player.nickname, value: a.init.wardrobeValue, look: LOOK });

    // chi non ha ancora creato l'avatar non è in classifica
    const fresh = await player();
    app.get(LeaderboardService).invalidate();
    expect(ok(await fresh.socket.emitWithAck(C2S.LEADERBOARD_GET, {})).me).toBeNull();
  });

  it('live: cambia un armadio → al giro dopo arriva a tutti, ognuno con la sua posizione; senza cambi niente', async () => {
    const a = await inVillage();
    const b = await inVillage();
    const lb = app.get(LeaderboardService);
    await lb.tick(); // allinea l'ultima classifica mandata
    expect(await lb.tick()).toBe(false);

    // b fa verificare il regalo: 3 monete in meno, l'armadio cambia
    const updatedB = next<{ wardrobeValue: number }>(b.socket, S2C.INVENTORY_UPDATED);
    ok(await b.socket.emitWithAck(C2S.AUTH_REQUEST, { assetId: b.init.inventory[0].assetId }));
    const valueB = (await updatedB).wardrobeValue;
    expect(valueB).not.toBe(b.init.wardrobeValue);

    const toA = next<Leaderboard>(a.socket, S2C.LEADERBOARD_UPDATED);
    const toB = next<Leaderboard>(b.socket, S2C.LEADERBOARD_UPDATED);
    expect(await lb.tick()).toBe(true);
    const [boardA, boardB] = await Promise.all([toA, toB]);
    expect(boardA.me?.playerId).toBe(a.init.player.id);
    expect(boardB.me).toMatchObject({ playerId: b.init.player.id, value: valueB });
    expect(boardA.top).toEqual(boardB.top);
  });
});
