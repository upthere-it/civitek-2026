import type { GameConfig } from '@sp/shared';
import type { ChainNotary } from './chain-notary';
import { CommercioNotary } from './commercio-notary';
import { MockNotary } from './mock-notary';

/** chain.notary in config: "mock" (sviluppo, default) o "commercio" (testnet via commercio.app, credenziali nel .env). */
export function createNotary(config: GameConfig, env: NodeJS.ProcessEnv = process.env): ChainNotary {
  const { chain } = config;
  if (chain.notary === 'mock') return new MockNotary(chain.mock);
  if (chain.notary === 'commercio') {
    const missing = ['CN_USERNAME', 'CN_PASSWORD', 'CN_RECIPIENT_ADDRESS'].filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(`chain.notary = "commercio" ma mancano nel .env: ${missing.join(', ')} (oppure usa "mock")`);
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
