// Accettazione M3: un giocatore da solo, senza altri umani, fa tutte le azioni del gioco grazie ai bot.
// I loop sono spenti (GAME_LOOPS=off): i loro tick() si chiamano a mano.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  C2S,
  S2C,
  stallPrice,
  type ClientToServerEvents,
  type DropInfo,
  type InventoryUpdated,
  type ServerToClientEvents,
  type StateInit,
} from '@sp/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { CHAIN_NOTARY } from '../src/chain/chain-notary';
import { MockNotary } from '../src/chain/mock-notary';
import { BotService } from '../src/game/bot.service';
import { DropService } from '../src/game/drop.service';
import { MechanicsService } from '../src/game/mechanics.service';
import { SYS, cfg, openTestDb, perceivedOf } from './helpers/db';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: INestApplication;
let url: string;
const clients: Client[] = [];
const { db } = openTestDb();

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

async function player(): Promise<{ socket: Client; init: StateInit }> {
  const socket: Client = io(url, { auth: { deviceId: randomUUID() }, transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(socket);
  const init = await new Promise<StateInit>((resolve) => socket.once(S2C.STATE_INIT, resolve));
  return { socket, init };
}

function next<T>(socket: Client, event: keyof ServerToClientEvents, pred: (m: T) => boolean = () => true, ms = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), ms);
    const h = (m: T) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      socket.off(event, h as never);
      resolve(m);
    };
    socket.on(event, h as never);
  });
}

const ok = <T>(r: { ok: true; data: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(`atteso ok, ricevuto ${r.code}`);
  return r.data;
};

describe('M3 via socket', () => {
  it('Tony Affari: il falso costa la metà, il passaporto lo tradisce, la Dott.ssa Hash lo smaschera', async () => {
    const { socket } = await player();
    const stallChanged = next(socket, S2C.STALL_UPDATED);
    await app.get(MechanicsService).restockStall();
    await stallChanged;

    const offers = ok(await socket.emitWithAck(C2S.STALL_LIST, {}));
    expect(offers.length).toBe(cfg.economy.stall.max_fakes_on_sale);
    const offer = offers[0];
    expect(offer.price).toBe(stallPrice(cfg.item(offer.itemId)!.base_value, cfg.economy));

    // prima di comprare: origine Tony, primo anello FAKE_MINT non certificato, prezzo della bancarella
    const before = ok(await socket.emitWithAck(C2S.PASSPORT_GET, { assetId: offer.assetId }));
    expect(before).toMatchObject({ origin: 'stall', stallPrice: offer.price, status: null, perceivedValue: offer.perceivedValue });
    expect(before.events.map((e) => [e.event, e.chainStatus])).toEqual([['FAKE_MINT', 'NONE']]);
    expect(JSON.stringify(before)).not.toMatch(/is_fake|isFake/);

    const inv = next<InventoryUpdated>(socket, S2C.INVENTORY_UPDATED);
    ok(await socket.emitWithAck(C2S.STALL_BUY, { assetId: offer.assetId }));
    const bought = (await inv).inventory.find((i) => i.assetId === offer.assetId)!;
    expect(bought).toMatchObject({ status: null, legendCount: 0, lockedUntil: null });

    const afterAuth = next<InventoryUpdated>(socket, S2C.INVENTORY_UPDATED);
    expect(ok(await socket.emitWithAck(C2S.AUTH_REQUEST, { assetId: offer.assetId }))).toEqual({ verdict: 'fake' });
    expect((await afterAuth).inventory.find((i) => i.assetId === offer.assetId)).toMatchObject({
      status: 'fake',
      perceivedValue: cfg.valuation.fake_value_after_auth,
    });
    expect(await socket.emitWithAck(C2S.AUTH_REQUEST, { assetId: offer.assetId })).toMatchObject({
      ok: false,
      code: 'ALREADY_VERIFIED',
    });
    expect(await socket.emitWithAck(C2S.STALL_BUY, { assetId: offer.assetId })).toMatchObject({ ok: false, code: 'NOT_FOR_SALE' });
  });

  it('MC Suola: prestito, scarpa bloccata, ritorno con LEGEND_OUT e valore +40%', async () => {
    const { socket, init } = await player();
    const gift = init.inventory[0];
    expect(init.player.legendReadyAt).toBeNull();

    const { until } = ok(await socket.emitWithAck(C2S.LEGEND_REQUEST, { assetId: gift.assetId }));
    expect(until).toBeGreaterThan(Date.now());
    expect(await socket.emitWithAck(C2S.LISTING_CREATE, { assetId: gift.assetId, price: 10 })).toMatchObject({ code: 'ASSET_LOCKED' });
    expect(await socket.emitWithAck(C2S.LEGEND_REQUEST, { assetId: gift.assetId })).toMatchObject({ code: 'ASSET_LOCKED' });

    await db.select('UPDATE assets SET locked_until = NOW(6) - INTERVAL 1 SECOND WHERE id = ?', [gift.assetId]);
    const returned = next<{ assetId: number }>(socket, S2C.LEGEND_RETURNED);
    const inv = next<InventoryUpdated>(socket, S2C.INVENTORY_UPDATED);
    expect(await app.get(MechanicsService).returnFromLegend()).toBeGreaterThanOrEqual(1);
    expect(await returned).toEqual({ assetId: gift.assetId });
    const item = (await inv).inventory.find((i) => i.assetId === gift.assetId)!;
    expect(item).toMatchObject({ legendCount: 1, lockedUntil: null });
    expect(item.perceivedValue).toBe(Math.round(cfg.item(gift.itemId)!.base_value * (1 + cfg.valuation.legend_bonus_per_wear)));

    const passport = ok(await socket.emitWithAck(C2S.PASSPORT_GET, { assetId: gift.assetId }));
    expect(passport.events.slice(-2).map((e) => [e.event, e.toSystem])).toEqual([
      ['LEGEND_IN', true],
      ['LEGEND_OUT', false],
    ]);
  });

  it('drop: annuncio a tutti, uno a testa, aggiornamento del venduto', async () => {
    const a = await player();
    const b = await player();
    const dropItem = cfg.items.find((i) => i.sources.includes('drop') && i.base_value <= cfg.player.start_coins)!;
    const announced = next<DropInfo>(b.socket, S2C.DROP_ANNOUNCE);
    const drop = await app.get(DropService).open(Date.now(), dropItem.id);
    expect(await announced).toEqual(drop);
    expect(ok(await a.socket.emitWithAck(C2S.DROP_STATE, {})).current).toEqual(drop);

    const update = next<{ dropId: number; sold: number }>(b.socket, S2C.DROP_UPDATE);
    const { assetId } = ok(await a.socket.emitWithAck(C2S.DROP_CLAIM, { dropId: drop.dropId }));
    expect(await update).toEqual({ dropId: drop.dropId, sold: 1 });
    expect(await a.socket.emitWithAck(C2S.DROP_CLAIM, { dropId: drop.dropId })).toMatchObject({ code: 'DROP_ALREADY_CLAIMED' });

    const passport = ok(await a.socket.emitWithAck(C2S.PASSPORT_GET, { assetId }));
    expect(passport).toMatchObject({ origin: 'upthere', dropSerial: 1, dropQuantity: drop.quantity });
  });

  it('bot: comprano un annuncio sottoprezzo di un umano e vendono le loro scorte', async () => {
    const bots = app.get(BotService);
    expect(bots.activity(0)).toBe(1);
    expect(bots.activity(cfg.economy.bots.min_activity_at_humans_online)).toBe(cfg.economy.bots.min_activity);

    const { socket, init } = await player();
    const gift = init.inventory[0];
    const price = Math.floor((await perceivedOf(db, gift.assetId)) * cfg.economy.bots.buy_pct);
    ok(await socket.emitWithAck(C2S.LISTING_CREATE, { assetId: gift.assetId, price }));

    // un bot che compra per primo: trova l'affare (o uno migliore) e paga con la tesoreria
    const sold = next<InventoryUpdated>(socket, S2C.INVENTORY_UPDATED, (m) => !m.inventory.some((i) => i.assetId === gift.assetId));
    const buyer = bots.botIds().find((id) => cfg.economy.bots.styles[styleOf(id)]?.buy_first > 0.5)!;
    for (let i = 0; i < 5; i++) {
      await bots.act(buyer, () => 0);
      const [l] = await db.select<{ status: string }>("SELECT status FROM market_listings WHERE asset_id = ? AND seller_id = ? ORDER BY id DESC LIMIT 1", [
        gift.assetId,
        init.player.id,
      ]);
      if (l.status === 'SOLD') break;
    }
    expect((await sold).coins).toBe(init.player.coins + price);

    // un bot che vende: si rifornisce (tick) e mette in bacheca; il giocatore compra da lui
    const marketChanged = next(socket, S2C.MARKET_UPDATED);
    await bots.tick(() => 0.99);
    await marketChanged;
    const page = ok(await socket.emitWithAck(C2S.MARKET_LIST, {}));
    const fromBot = page.listings.find((l) => l.sellerId >= SYS.bots_from && l.price <= (init.player.coins + price));
    expect(fromBot).toBeDefined();
    ok(await socket.emitWithAck(C2S.LISTING_BUY, { listingId: fromBot!.listingId }));
    const [ledger] = await db.select<{ reason: string }>('SELECT reason FROM coin_ledger WHERE ref_id = ? ORDER BY id DESC LIMIT 1', [
      fromBot!.assetId,
    ]);
    expect(ledger.reason).toBe('BOT_SELL');
  });
});

function styleOf(botId: number): string {
  // stesso ordine di npcs.json → bots
  const npcs = require('../../../data/npcs.json') as { bots: { player_id: number; style: string }[] };
  return npcs.bots.find((b) => b.player_id === botId)?.style ?? '';
}
