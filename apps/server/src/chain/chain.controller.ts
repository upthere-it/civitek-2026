import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CHAIN_NOTARY, NOTARY_APP, batchHash, type ChainNotary } from './chain-notary';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pagina pubblica di un batch notarizzato (content_uri del documento on-chain): restituisce lo stesso
 * payload di cui l'hash è on-chain, così chiunque può ricalcolarlo. Solo id interni degli eventi e hash:
 * niente nickname, device o giocatori (ARCHITECTURE §6).
 */
@Controller('api/chain')
export class ChainController {
  constructor(
    private readonly db: DbService,
    @Inject(CHAIN_NOTARY) private readonly notary: ChainNotary,
  ) {}

  @Get('batch/:id')
  async batch(@Param('id') id: string) {
    if (!UUID.test(id)) throw new NotFoundException();
    const rows = await this.db.select<{ id: number; hash: string; chain_status: string; chain_tx: string | null }>(
      'SELECT id, hash, chain_status, chain_tx FROM asset_events WHERE chain_batch = ? ORDER BY id',
      [id],
    );
    if (!rows.length) throw new NotFoundException();
    const items = rows.map((r) => ({ eventId: r.id, hash: r.hash }));
    const txHash = rows.find((r) => r.chain_tx)?.chain_tx ?? null;
    return {
      v: 1,
      app: NOTARY_APP,
      batchId: id,
      events: items.map((i) => [i.eventId, i.hash]),
      sha256: batchHash(items),
      network: this.notary.network,
      txHash,
      explorerUrl: txHash ? this.notary.explorerUrl(txHash) : null,
    };
  }
}
