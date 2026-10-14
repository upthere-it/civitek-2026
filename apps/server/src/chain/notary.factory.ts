import { Logger } from '@nestjs/common';
import type { GameConfig } from '@sp/shared';
import type { ChainNotary } from './chain-notary';
import { CommercioNotary } from './commercio-notary';
import { MockNotary } from './mock-notary';

/**
 * chain.notary in config: "mock" o "commercio" (testnet via commercio.app, credenziali nel .env).
 * Con "commercio" e credenziali mancanti: in produzione il server non parte; altrove (sviluppo senza .env,
 * test, CI) si ripiega sul Mock con un avviso nel log, così la config resta una sola per tutti.
 */
export function createNotary(config: GameConfig, env: NodeJS.ProcessEnv = process.env): ChainNotary {
  const { chain } = config;
  if (chain.notary === 'mock') return new MockNotary(chain.mock);
  if (chain.notary === 'commercio') {
    const missing = ['CN_USERNAME', 'CN_PASSWORD', 'CN_RECIPIENT_ADDRESS'].filter((k) => !env[k]);
    if (missing.length) {
      const msg = `chain.notary = "commercio" ma mancano nel .env: ${missing.join(', ')}`;
      if (env.NODE_ENV === 'production') throw new Error(`${msg} (oppure usa "mock")`);
      new Logger('ChainNotary').warn(`${msg}: uso il Mock, nessuna transazione vera`);
      return new MockNotary(chain.mock);
    }
    return new CommercioNotary(
      chain.commercio,
      { username: env.CN_USERNAME!, password: env.CN_PASSWORD!, recipient: env.CN_RECIPIENT_ADDRESS! },
      chain.network,
      chain.explorer_tx_url,
      config.links.game,
    );
  }
  throw new Error(`chain.notary "${chain.notary}" sconosciuto: usa "mock" o "commercio"`);
}
