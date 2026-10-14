// Accettazione M2: due giocatori si scambiano una scarpa; il passaporto mostra il passaggio ⏳ → ✅.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  C2S,
  S2C,
  listingPriceRange,
  marketFee,
  type ClientToServerEvents,
  type InventoryUpdated,
  type ServerToClientEvents,
  type StateInit,
} from '@sp/shared';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { CHAIN_NOTARY } from '../src/chain/chain-notary';
import { MockNotary } from '../src/chain/mock-notary';
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

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await app.close();
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

describe('negozio, bacheca e passaporto via socket', () => {
  it('scambio completo tra due giocatori, con aggiornamenti in diretta e certificazione', async () => {
    const a = await player();
    const b = await player();

    // Negozio: solo item con "shop", a base_value
    const shop = ok(await a.socket.emitWithAck(C2S.SHOP_LIST, {}));
    expect(shop.every((e) => cfg.item(e.itemId)!.sources.includes('shop') && e.price === cfg.item(e.itemId)!.base_value)).toBe(true);
    const cheapest = [...shop].sort((x, y) => x.price - y.price)[0];

    const invA1 = next<InventoryUpdated>(a.socket, S2C.INVENTORY_UPDATED);
    const bought = ok(await a.socket.emitWithAck(C2S.SHOP_BUY, { itemId: cheapest.itemId }));
    const afterShop = await invA1;
    expect(afterShop.coins).toBe(cfg.player.start_coins - cheapest.price);
    expect(afterShop.inventory.map((i) => i.assetId)).toContain(bought.assetId);

    // A mette in bacheca la scarpa comprata: B viene avvisato
    const item = afterShop.inventory.find((i) => i.assetId === bought.assetId)!;
    expect(item.maxListPrice).toBe(listingPriceRange(item.perceivedValue, cfg.economy).max);
    expect(
      await a.socket.emitWithAck(C2S.LISTING_CREATE, { assetId: bought.assetId, price: item.maxListPrice + 1 }),
    ).toMatchObject({ ok: false, code: 'PRICE_OUT_OF_RANGE' });
    const marketChanged = next(b.socket, S2C.MARKET_UPDATED);
    const price = item.perceivedValue;
    const { listingId } = ok(await a.socket.emitWithAck(C2S.LISTING_CREATE, { assetId: bought.assetId, price }));
    await marketChanged;

    const page = ok(await b.socket.emitWithAck(C2S.MARKET_LIST, {}));
    expect(page.listings[0]).toMatchObject({
      listingId,
      assetId: bought.assetId,
      itemId: cheapest.itemId,
      price,
      sellerId: a.init.player.id,
      sellerName: a.init.player.nickname,
    });

    // B apre il passaporto prima di comprare: un anello (MINT dal Negozio), annuncio visibile
    const before = ok(await b.socket.emitWithAck(C2S.PASSPORT_GET, { assetId: bought.assetId }));
    expect(before).toMatchObject({ origin: 'shop', status: null, ownerId: a.init.player.id, listing: { listingId, price } });
    expect(before.events.map((e) => [e.event, e.toName])).toEqual([['MINT', a.init.player.nickname]]);
    expect(JSON.stringify(before)).not.toMatch(/is_fake|isFake/);

    // A non può comprarsi da solo, B compra
    expect(await a.socket.emitWithAck(C2S.LISTING_BUY, { listingId })).toMatchObject({ ok: false, code: 'SELF_BUY' });
    const invA = next<InventoryUpdated>(a.socket, S2C.INVENTORY_UPDATED);
    const invB = next<InventoryUpdated>(b.socket, S2C.INVENTORY_UPDATED);
    const passportChanged = next<{ assetId: number }>(b.socket, S2C.ASSET_UPDATED, (m) => m.assetId === bought.assetId);
    const certified = next<{ assetId: number; eventId: number }>(b.socket, S2C.ASSET_CERTIFIED, (m) => m.assetId === bought.assetId, 10_000);
    ok(await b.socket.emitWithAck(C2S.LISTING_BUY, { listingId }));

    const fee = marketFee(price, cfg.economy);
    expect((await invA).coins).toBe(afterShop.coins + price - fee);
    const updB = await invB;
    expect(updB.coins).toBe(cfg.player.start_coins - price);
    expect(updB.inventory.map((i) => i.assetId)).toContain(bought.assetId);
    await passportChanged;

    // ⏳ subito dopo lo scambio, ✅ quando il worker ha certificato
    const pending = ok(await b.socket.emitWithAck(C2S.PASSPORT_GET, { assetId: bought.assetId }));
    const transfer = pending.events[pending.events.length - 1];
    expect(transfer).toMatchObject({ event: 'TRANSFER', fromName: a.init.player.nickname, toName: b.init.player.nickname, price });
    expect(Math.abs(transfer.at - Date.now())).toBeLessThan(60_000);
    expect(['PENDING', 'SENDING', 'CONFIRMED']).toContain(transfer.chainStatus);

    const cert = await certified;
    const done = ok(await b.socket.emitWithAck(C2S.PASSPORT_GET, { assetId: bought.assetId }));
    const confirmed = done.events.find((e) => e.id === cert.eventId) ?? done.events[done.events.length - 1];
    expect(done.events.every((e) => e.chainStatus === 'CONFIRMED') || confirmed.chainStatus === 'CONFIRMED').toBe(true);
    expect(done).toMatchObject({ ownerId: b.init.player.id, listing: null });

    // l'annuncio è chiuso: il venditore non può più ritirarlo
    expect(await a.socket.emitWithAck(C2S.LISTING_CANCEL, { listingId })).toMatchObject({ ok: false, code: 'LISTING_CLOSED' });
  });

  it('ritiro di un annuncio e payload non validi', async () => {
    const a = await player();
    const gift = a.init.inventory[0];
    const { listingId } = ok(await a.socket.emitWithAck(C2S.LISTING_CREATE, { assetId: gift.assetId, price: gift.perceivedValue }));
    const inv = next<InventoryUpdated>(a.socket, S2C.INVENTORY_UPDATED);
    ok(await a.socket.emitWithAck(C2S.LISTING_CANCEL, { listingId }));
    expect((await inv).inventory.find((i) => i.assetId === gift.assetId)).toMatchObject({ listingId: null, listingPrice: null });

    expect(await a.socket.emitWithAck(C2S.LISTING_BUY, { listingId: -1 })).toMatchObject({ code: 'INVALID_PAYLOAD' });
    expect(await a.socket.emitWithAck(C2S.PASSPORT_GET, { assetId: 999_999_999 })).toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(await a.socket.emitWithAck(C2S.SHOP_BUY, { itemId: 'upthere-one' })).toMatchObject({
      ok: false,
      code: 'NOT_FOR_SALE',
      message: 'Non è in vendita.',
    });
  });
});
