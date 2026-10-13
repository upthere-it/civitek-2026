export type AssetEventType = 'MINT' | 'FAKE_MINT' | 'TRANSFER' | 'LEGEND_IN' | 'LEGEND_OUT';

export type ChainStatus = 'NONE' | 'PENDING' | 'SENDING' | 'CONFIRMED' | 'FAILED';

export type LedgerReason =
  | 'GRANT' | 'TRADE' | 'FEE' | 'SHOP' | 'AUTH' | 'LEGEND' | 'BOT_BUY' | 'BOT_SELL' | 'DROP' | 'STALL';

/** Quello che serve a perceivedValue(): derivato dall'asset e dalla sua catena (vedi assetViewFromChain). */
export interface AssetView {
  isFake: boolean;
  fakeRevealed: boolean;
  legendCount: number;
  /** Primo anello coniato dalla Banca Upthere (drop). */
  mintedByUpthere: boolean;
  /** Il primo anello è un FAKE_MINT: origine non certificata. */
  originGap: boolean;
  /** Passaggi di proprietà verso giocatori umani (vedi assetViewFromChain). */
  humanOwnersCount: number;
}

/** Un anello della catena, ridotto ai campi che pesano sul valore. */
export interface ChainLink {
  event: AssetEventType;
  toId: number;
  toIsSystem: boolean;
}

/** Payload di `asset.certified`. */
export interface AssetCertified {
  assetId: number;
  eventId: number;
  txHash: string;
  explorerUrl: string;
}
