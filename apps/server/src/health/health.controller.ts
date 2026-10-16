import { timingSafeEqual } from 'node:crypto';
import { Controller, ForbiddenException, Get, Headers, Inject, Query, ServiceUnavailableException } from '@nestjs/common';
import { CHAIN_NOTARY, type ChainNotary, type NotaryHealth } from '../chain/chain-notary';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { WorldService } from '../game/world.service';

const startedAt = Date.now();

/** Confronto a tempo costante: il token non si indovina un carattere alla volta. */
function sameToken(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Stato del server per il controllo prima della conferenza (PLAN, giorno della conferenza) e per un monitor.
 * - pubblico: DB, coda della certificazione, giocatori online. 200 se il DB risponde (status ok o warn), 503 se no;
 * - `?full=1` con l'header `x-health-token` uguale a HEALTH_TOKEN del .env: anche login e saldo commercio.app.
 *   Senza HEALTH_TOKEN il controllo completo è spento: un endpoint pubblico non deve far fare login a nessuno.
 */
@Controller('api/health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly world: WorldService,
    @Inject(CHAIN_NOTARY) private readonly notary: ChainNotary,
  ) {}

  @Get()
  async health(@Query('full') full: string | undefined, @Headers('x-health-token') token: string | undefined) {
    const wantsFull = full === '1';
    if (wantsFull && !sameToken(token, process.env.HEALTH_TOKEN)) throw new ForbiddenException();

    const warnings: string[] = [];
    const t0 = performance.now();
    let dbOk = true;
    let chain: Record<string, number | string | null> | null = null;
    try {
      const [q] = await this.db.select<{
        pending: number;
        sending: number;
        failed: number;
        oldest_pending_sec: number | null;
        last_confirmed_ms: number | null;
      }>(
        `SELECT SUM(chain_status = 'PENDING') AS pending, SUM(chain_status = 'SENDING') AS sending,
                SUM(chain_status = 'FAILED') AS failed,
                TIMESTAMPDIFF(SECOND, MIN(IF(chain_status = 'PENDING', created_at, NULL)), NOW(6)) AS oldest_pending_sec,
                ROUND(UNIX_TIMESTAMP(MAX(IF(chain_status = 'CONFIRMED', created_at, NULL))) * 1000) AS last_confirmed_ms
           FROM asset_events WHERE chain_status IN ('PENDING', 'SENDING', 'FAILED', 'CONFIRMED')`,
      );
      chain = {
        notary: this.notary.network,
        pending: Number(q?.pending ?? 0),
        sending: Number(q?.sending ?? 0),
        failed: Number(q?.failed ?? 0),
        oldestPendingSec: q?.oldest_pending_sec === null || q?.oldest_pending_sec === undefined ? null : Number(q.oldest_pending_sec),
        lastConfirmedAt: q?.last_confirmed_ms ? new Date(Number(q.last_confirmed_ms)).toISOString() : null,
      };
      if (Number(chain.failed) > 0) warnings.push(`${chain.failed} eventi in FAILED: non verranno ritentati da soli`);
      const maxPending = this.cfg.config.chain.health_max_pending_sec;
      if (chain.oldestPendingSec !== null && Number(chain.oldestPendingSec) > maxPending) {
        warnings.push(`evento in coda da ${chain.oldestPendingSec} s (soglia ${maxPending}): worker fermo o testnet lenta`);
      }
      if (this.notary.network === 'mock') warnings.push('certificazione simulata (MockNotary): mancano le credenziali CN_*');
    } catch {
      dbOk = false;
    }

    let notary: NotaryHealth | undefined;
    if (wantsFull) {
      notary = await this.notary.health();
      if (!notary.ok) warnings.push(`notary: ${notary.detail ?? 'non risponde'}`);
    }

    const status = !dbOk ? 'down' : warnings.length ? 'warn' : 'ok';
    const body = {
      status,
      at: new Date().toISOString(),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      db: { ok: dbOk, ms: Math.round(performance.now() - t0) },
      chain,
      world: { online: this.world.size },
      ...(notary ? { notary } : {}),
      warnings,
    };
    if (!dbOk) throw new ServiceUnavailableException(body);
    return body;
  }
}
