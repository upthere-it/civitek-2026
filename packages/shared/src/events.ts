// Nomi degli eventi socket (ARCHITECTURE §5), formato `dominio.azione`.

/** Client → server */
export const C2S = {
  SESSION_RECOVER: 'session.recover',
  AVATAR_SET: 'avatar.set',
  MOVE_TO: 'move.to',
  EMOTE_SEND: 'emote.send',
  SHOP_LIST: 'shop.list',
  SHOP_BUY: 'shop.buy',
  MARKET_LIST: 'market.list',
  LISTING_CREATE: 'listing.create',
  LISTING_CANCEL: 'listing.cancel',
  LISTING_BUY: 'listing.buy',
  STALL_LIST: 'stall.list',
  STALL_BUY: 'stall.buy',
  AUTH_REQUEST: 'auth.request',
  LEGEND_REQUEST: 'legend.request',
  DROP_CLAIM: 'drop.claim',
  PASSPORT_GET: 'passport.get',
  LEADERBOARD_GET: 'leaderboard.get',
} as const;

/** Server → client */
export const S2C = {
  STATE_INIT: 'state.init',
  WORLD_PLAYERS: 'world.players',
  WORLD_EMOTE: 'world.emote',
  WALLET_UPDATED: 'wallet.updated',
  ASSET_UPDATED: 'asset.updated',
  INVENTORY_UPDATED: 'inventory.updated',
  ASSET_CERTIFIED: 'asset.certified',
  MARKET_UPDATED: 'market.updated',
  DROP_ANNOUNCE: 'drop.announce',
  DROP_UPDATE: 'drop.update',
  DROP_CLOSED: 'drop.closed',
  RUN_BEAT: 'run.beat',
  RUN_END: 'run.end',
  ERROR: 'error',
} as const;

export type C2SEvent = (typeof C2S)[keyof typeof C2S];
export type S2CEvent = (typeof S2C)[keyof typeof S2C];
