import { C2S, type DropState, type Leaderboard, type MarketPage, type Passport, type ShopEntry, type StallOffer } from '@sp/shared';
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
    stallList: () => request<StallOffer[]>(() => s().emitWithAck(C2S.STALL_LIST, {})),
    stallBuy: (assetId: number) => request<{ assetId: number; price: number }>(() => s().emitWithAck(C2S.STALL_BUY, { assetId })),
    auth: (assetId: number) => request<{ verdict: 'genuine' | 'fake' }>(() => s().emitWithAck(C2S.AUTH_REQUEST, { assetId })),
    legend: (assetId: number) => request<{ until: number }>(() => s().emitWithAck(C2S.LEGEND_REQUEST, { assetId })),
    dropState: () => request<DropState>(() => s().emitWithAck(C2S.DROP_STATE, {})),
    dropClaim: (dropId: number) => request<{ assetId: number }>(() => s().emitWithAck(C2S.DROP_CLAIM, { dropId })),
    leaderboard: () => request<Leaderboard>(() => s().emitWithAck(C2S.LEADERBOARD_GET, {})),
  };
}

export type Api = ReturnType<typeof createApi>;
