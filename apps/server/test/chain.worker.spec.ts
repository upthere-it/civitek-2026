// Outbox della certificazione: tentativi, FAILED, recupero dopo un crash, giri sovrapposti.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ChainEventsService } from '../src/chain/chain-events.service';
import type { ChainNotary, NotarizeItem } from '../src/chain/chain-notary';
import { ChainWorker } from '../src/chain/chain.worker';
import { MockNotary } from '../src/chain/mock-notary';
import { GameConfigService } from '../src/config/game-config.service';
import type { DbService } from '../src/db/db.service';
import { SYS, cfg, eventsOf, mint, newPlayer, openTestDb, violations } from './helpers/db';

const { pool, db } = openTestDb();
afterAll(() => db.onModuleDestroy());

const MAX_ATTEMPTS = 2;
const testCfg = (enabled = true) =>
  new GameConfigService(
    {
      ...cfg.config,
      chain: { ...cfg.chain, enabled, max_attempts: MAX_ATTEMPTS, mock: { min_delay_ms: 0, max_delay_ms: 0 } },
    },
    cfg.items,
  );

const worker = (notary: ChainNotary, opts: { enabled?: boolean; dbService?: DbService } = {}) =>
  new ChainWorker(opts.dbService ?? db, notary, new ChainEventsService(), testCfg(opts.enabled), new SchedulerRegistry());

const instant = () => new MockNotary({ min_delay_ms: 0, max_delay_ms: 0 });

class FailingNotary implements ChainNotary {
  readonly network = 'test-down';
  calls = 0;
  async notarizeBatch(): Promise<{ txHash: string }> {
    this.calls++;
    throw new Error('testnet non raggiungibile');
  }
  explorerUrl(): string {
    return '';
  }
  async health() {
    return { ok: false, network: this.network, detail: 'testnet non raggiungibile' };
  }
}

async function drain(): Promise<void> {
  const w = worker(instant());
  while ((await w.tick()) > 0);
}

beforeEach(drain);

describe('ChainWorker', () => {
  it('notary giù: l’evento torna PENDING, poi FAILED oltre max_attempts', async () => {
    const p = await newPlayer(db);
    const notary = new FailingNotary();
    const w = worker(notary);

    expect(await w.tick()).toBe(0);
    let [ev] = await eventsOf(db, p.giftAssetId);
    expect(ev).toMatchObject({ chain_status: 'PENDING', chain_attempts: 1, chain_error: 'Error: testnet non raggiungibile' });

    expect(await w.tick()).toBe(0);
    [ev] = await eventsOf(db, p.giftAssetId);
    expect(ev).toMatchObject({ chain_status: 'FAILED', chain_attempts: MAX_ATTEMPTS });

    // FAILED non viene più preso in carico
    expect(await w.tick()).toBe(0);
    expect(notary.calls).toBe(MAX_ATTEMPTS);
  });

  it('dopo un crash a metà invio, sp_chain_recover_sending rimette in coda il batch', async () => {
    const p = await newPlayer(db);
    const claimed = await db.call<{ id: number }>('sp_chain_claim_batch', [50, randomUUID()]);
    expect(claimed.length).toBeGreaterThan(0);
    expect((await eventsOf(db, p.giftAssetId))[0].chain_status).toBe('SENDING');

    const [res] = await db.call<{ recovered: number }>('sp_chain_recover_sending');
    expect(res.recovered).toBe(claimed.length);
    expect((await eventsOf(db, p.giftAssetId))[0].chain_status).toBe('PENDING');

    await drain();
    expect((await eventsOf(db, p.giftAssetId))[0].chain_status).toBe('CONFIRMED');
  });

  it('se il DB non registra la conferma, il batch già notarizzato si conferma al giro dopo', async () => {
    const p = await newPlayer(db);
    let failOnce = true;
    const flaky = {
      call: (sp: string, args?: readonly unknown[]) => {
        if (sp === 'sp_chain_mark_confirmed' && failOnce) {
          failOnce = false;
          return Promise.reject(new Error('connessione persa'));
        }
        return db.call(sp, args);
      },
    } as unknown as DbService;
    const notary = instant();
    const spy = jest.spyOn(notary, 'notarizeBatch');
    const w = worker(notary, { dbService: flaky });

    await expect(w.tick()).rejects.toThrow('connessione persa');
    const [sending] = await eventsOf(db, p.giftAssetId);
    expect(sending.chain_status).toBe('SENDING');

    expect(await w.tick()).toBeGreaterThanOrEqual(1);
    const [ev] = await eventsOf(db, p.giftAssetId);
    expect(ev.chain_status).toBe('CONFIRMED');
    expect(spy).toHaveBeenCalledTimes(1); // nessuna seconda notarizzazione
  });

  it('un giro alla volta: il secondo tick mentre il primo è in volo non fa niente', async () => {
    await newPlayer(db);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ChainNotary = {
      network: 'slow',
      notarizeBatch: async (items: NotarizeItem[]) => {
        await gate;
        return { txHash: `slow-${items.length}` };
      },
      health: async () => ({ ok: true, network: 'slow' }),
      explorerUrl: () => '',
    };
    const w = worker(slow);
    const first = w.tick();
    await sleep(50);
    expect(await w.tick()).toBe(0);
    release();
    expect(await first).toBeGreaterThanOrEqual(1);
  });

  it('chain.enabled = false: il worker non tocca l’outbox', async () => {
    const p = await newPlayer(db);
    expect(await worker(instant(), { enabled: false }).tick()).toBe(0);
    expect((await eventsOf(db, p.giftAssetId))[0].chain_status).toBe('PENDING');
  });

  it('i falsi coniati da Tony non vanno in certificazione', async () => {
    const fake = await mint(pool, 'salto-4-club', SYS.stall, { mintedBy: SYS.stall, isFake: true });
    await drain();
    const [ev] = await eventsOf(db, fake);
    expect(ev).toMatchObject({ event: 'FAKE_MINT', chain_status: 'NONE', chain_attempts: 0 });
    expect(await violations(db)).toEqual([]);
  });
});
