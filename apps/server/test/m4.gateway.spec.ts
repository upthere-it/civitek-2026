// Accettazione M4: prima run (beat, reveal, badge "Mercante"), recupero da un altro telefono, classifica.
// I loop sono spenti (GAME_LOOPS=off): RunService.tick() si chiama a mano, con l'orologio che serve.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  C2S,
  S2C,
  runTarget,
  type ClientToServerEvents,
  type RunBeat,
  type RunReveal,
  type RunState,
  type ServerToClientEvents,
  type StateInit,
} from '@sp/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { CHAIN_NOTARY } from '../src/chain/chain-notary';
import { MockNotary } from '../src/chain/mock-notary';
import { LeaderboardService } from '../src/game/leaderboard.service';
import { MechanicsService } from '../src/game/mechanics.service';
import { RecoverLimiter, clientIp } from '../src/game/rate-limit';
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

function connect(auth: { deviceId: string; recover?: string }): Client {
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
async function inVillage(): Promise<{ socket: Client; init: StateInit; deviceId: string; run: RunState }> {
  const p = await player();
  const res = ok(await p.socket.emitWithAck(C2S.AVATAR_SET, { ...LOOK, nickname: p.init.player.nickname }));
  return { ...p, run: res.run };
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

/** Porta indietro l'inizio della run (orologio del DB) e la fa ripartire nel servizio. */
async function backdate(playerId: number, seconds: number, wardrobe: number): Promise<RunState> {
  await db.select('UPDATE players SET first_run_started_at = NOW(6) - INTERVAL ? SECOND WHERE id = ?', [seconds, playerId]);
  return app.get(RunService).enter(playerId, wardrobe);
}

describe('M4: prima run', () => {
  it('parte alla creazione dell’avatar con l’obiettivo da config, e i beat arrivano al loro secondo', async () => {
    const { socket, init, run: state } = await inVillage();
    expect(state.completed).toBe(false);
    expect(state.startValue).toBe(init.wardrobeValue);
    expect(state.target).toBe(runTarget(init.wardrobeValue, run.objective.multiplier));
    expect(state.endsAt - state.startedAt).toBe(run.duration_sec * 1000);

    const beats = collect<RunBeat>(socket, S2C.RUN_BEAT);
    const runs = app.get(RunService);
    await runs.tick(state.startedAt);
    await runs.tick(state.startedAt + 45_000);
    await flush();
    const upTo45 = run.beats.filter((b) => b.at_sec <= 45).map((b) => b.id);
    expect(beats.map((b) => b.beatId)).toEqual(upTo45);

    // nessun beat si ripete e il "reveal" non è un beat: è run.end
    await runs.tick(state.startedAt + (run.duration_sec - 1) * 1000);
    await flush();
    expect(beats.map((b) => b.beatId)).toEqual(run.beats.filter((b) => b.at_sec < run.duration_sec).map((b) => b.id));
  });

  it('una riconnessione a metà run non ripete i beat già passati', async () => {
    const { init, deviceId } = await inVillage();
    await backdate(init.player.id, 100, init.wardrobeValue);
    const again = await player(deviceId);
    expect(again.init.run).toMatchObject({ completed: false, startValue: init.wardrobeValue });
    const beats = collect<RunBeat>(again.socket, S2C.RUN_BEAT);
    await app.get(RunService).tick(again.init.run!.startedAt + 100_000);
    await flush();
    expect(beats).toEqual([]);
  });

  it('il reveal prima della fine non c’è, e la SP non chiude una run in anticipo', async () => {
    const { socket, init } = await inVillage();
    const r = await socket.emitWithAck(C2S.RUN_REVEAL, {});
    expect(r).toMatchObject({ ok: false, code: 'RUN_NOT_FINISHED' });
    await expect(db.call('sp_run_complete', [init.player.id, 1, 0])).rejects.toMatchObject({ code: 'RUN_NOT_OVER' });
  });

  it('alla fine: reveal con valori, scambi, falsi presi e smascherati, scarpa più preziosa e codice', async () => {
    const { socket, init } = await inVillage();
    // durante la run: un falso da Tony Affari, poi la Dott.ssa Hash lo smaschera
    await app.get(MechanicsService).restockStall();
    const [offer] = ok(await socket.emitWithAck(C2S.STALL_LIST, {}));
    ok(await socket.emitWithAck(C2S.STALL_BUY, { assetId: offer.assetId }));
    expect(ok(await socket.emitWithAck(C2S.AUTH_REQUEST, { assetId: offer.assetId })).verdict).toBe('fake');

    const state = await backdate(init.player.id, run.duration_sec + 1, init.wardrobeValue);
    const end = next<RunReveal>(socket, S2C.RUN_END);
    await app.get(RunService).tick(state.endsAt);
    const reveal = await end;

    const wardrobe = ok(await socket.emitWithAck(C2S.LEADERBOARD_GET, {})).me!.value;
    expect(reveal).toMatchObject({
      startValue: init.wardrobeValue,
      endValue: wardrobe,
      target: runTarget(init.wardrobeValue, run.objective.multiplier),
      merchant: wardrobe >= runTarget(init.wardrobeValue, run.objective.multiplier),
      trades: 1,
      fakesBought: 1,
      fakesSpotted: 1,
      recoveryCode: init.player.recoveryCode,
    });
    // la più preziosa è il regalo (il falso smascherato vale poco): un solo proprietario, tu
    expect(reveal.best).toEqual({ assetId: init.inventory[0].assetId, itemId: init.inventory[0].itemId, owners: 1 });

    // si può rivedere, uguale; una seconda chiusura non cambia niente
    expect(ok(await socket.emitWithAck(C2S.RUN_REVEAL, {}))).toEqual(reveal);
    expect(await app.get(RunService).complete(init.player.id)).toEqual({ ...reveal, recoveryCode: null });
  });

  it('badge "Mercante" a chi raggiunge il target; la run chiusa resta chiusa alla riconnessione', async () => {
    const { socket, init, deviceId } = await inVillage();
    // valore iniziale più basso: l'armadio di adesso supera il target
    await db.select('UPDATE players SET first_run_start_value = ? WHERE id = ?', [Math.floor(init.wardrobeValue / 2), init.player.id]);
    const state = await backdate(init.player.id, run.duration_sec + 1, init.wardrobeValue);
    const end = next<RunReveal>(socket, S2C.RUN_END);
    await app.get(RunService).tick(state.endsAt);
    expect((await end).merchant).toBe(true);

    socket.disconnect();
    const again = await player(deviceId);
    expect(again.init.run).toMatchObject({ completed: true, merchant: true });
    const ends = collect<RunReveal>(again.socket, S2C.RUN_END);
    await app.get(RunService).tick(Date.now() + 3600_000);
    await flush();
    expect(ends).toEqual([]);
  });

  it('chi era offline alla fine riceve il reveal appena rientra', async () => {
    const { socket, init, deviceId } = await inVillage();
    socket.disconnect();
    await db.select('UPDATE players SET first_run_started_at = NOW(6) - INTERVAL ? SECOND WHERE id = ?', [run.duration_sec + 60, init.player.id]);
    const again = await player(deviceId);
    expect(again.init.run?.completed).toBe(false);
    const end = next<RunReveal>(again.socket, S2C.RUN_END);
    await app.get(RunService).tick();
    expect((await end).startValue).toBe(init.wardrobeValue);
  });
});

describe('M4: recupero da un altro telefono', () => {
  it('il codice (anche minuscolo, con il trattino) apre lo stesso giocatore; il vecchio device resta valido', async () => {
    const a = await inVillage();
    const code = a.init.player.recoveryCode!;
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);

    const b = connect({ deviceId: randomUUID(), recover: code.toLowerCase() });
    const initB = await new Promise<StateInit>((resolve) => b.once(S2C.STATE_INIT, resolve));
    expect(initB.player.id).toBe(a.init.player.id);
    expect(initB.player.nickname).toBe(a.init.player.nickname);
    expect(initB.player.avatar).toEqual(LOOK);
    // il codice lo conosce chi l'ha digitato: il server non lo rimostra a un device che non l'ha generato
    expect(initB.player.recoveryCode).toBeNull();
    expect(initB.run?.completed).toBe(false);

    b.disconnect();
    const again = await player(a.deviceId);
    expect(again.init.player.id).toBe(a.init.player.id);
    expect(again.init.player.recoveryCode).toBe(code);
  });

  it('un codice sbagliato non crea un giocatore e chiude la connessione con CODE_NOT_FOUND', async () => {
    const deviceId = randomUUID();
    const s = connect({ deviceId, recover: 'ZZZ-ZZZ' });
    const err = await next<{ code: string }>(s, S2C.ERROR);
    expect(err.code).toBe('CODE_NOT_FOUND');
    const [n] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM player_devices WHERE device_hash = SHA2(?, 256)', [deviceId]);
    expect(Number(n.n)).toBe(0);
  });

  it('limite di tentativi per IP e globale, a finestre di un minuto', () => {
    const l = new RecoverLimiter(2, 3);
    const t = 60_000 * 1000;
    expect([l.take('a', t), l.take('a', t), l.take('a', t)]).toEqual([true, true, false]);
    expect([l.take('b', t), l.take('c', t)]).toEqual([true, false]); // globale esaurito
    expect(l.take('a', t + 60_000)).toBe(true); // minuto nuovo
  });

  it('IP del client: dietro nginx l’ultimo di X-Forwarded-For, altrimenti l’indirizzo della connessione', () => {
    expect(clientIp('127.0.0.1', '6.6.6.6, 10.0.0.7')).toBe('10.0.0.7');
    expect(clientIp('::ffff:127.0.0.1', '10.0.0.7')).toBe('10.0.0.7');
    expect(clientIp('10.0.0.9', '6.6.6.6')).toBe('10.0.0.9');
    expect(clientIp('127.0.0.1', undefined)).toBe('127.0.0.1');
  });

  it('codice fuori formato (lunghezza, lettere fuori alfabeto): CODE_NOT_FOUND', async () => {
    for (const recover of ['abc', 'OOO-III']) {
      const s = connect({ deviceId: randomUUID(), recover });
      expect((await next<{ code: string }>(s, S2C.ERROR)).code).toBe('CODE_NOT_FOUND');
    }
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
});
