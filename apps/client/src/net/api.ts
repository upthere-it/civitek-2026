import { C2S, type MarketPage, type Passport, type ShopEntry } from '@sp/shared';
import { ACK_TIMEOUT_MS, request, type GameSocket } from './socket';

/** Richieste del mercato: il client manda intenzioni, saldi e proprietà li decide il server. */
export function createApi(socket: GameSocket) {
  const s = () => socket.timeout(ACK_TIMEOUT_MS);
  return {
    shopList: () => request<ShopEntry[]>(() => s().emitWithAck(C2S.SHOP_LIST, {})),
    shopBuy: (itemId: string) => request<{ assetId: number }>(() => s().emitWithAck(C2S.SHOP_BUY, { itemId })),
    marketList: (cursor?: number) =>
      request<MarketPage>(() => s().emitWithAck(C2S.MARKET_LIST, cursor === undefined ? {} : { cursor })),
    listingCreate: (assetId: number, price: number) =>
      request<{ listingId: number }>(() => s().emitWithAck(C2S.LISTING_CREATE, { assetId, price })),
    listingCancel: (listingId: number) => request<undefined>(() => s().emitWithAck(C2S.LISTING_CANCEL, { listingId })),
    listingBuy: (listingId: number) => request<{ assetId: number }>(() => s().emitWithAck(C2S.LISTING_BUY, { listingId })),
    passport: (assetId: number) => request<Passport>(() => s().emitWithAck(C2S.PASSPORT_GET, { assetId })),
  };
}

export type Api = ReturnType<typeof createApi>;
