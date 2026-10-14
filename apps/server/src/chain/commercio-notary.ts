import { Logger } from '@nestjs/common';
import type { CommercioCfg } from '@sp/shared';
import { batchHash, explorerTxUrl, type ChainNotary, type NotarizeItem } from './chain-notary';

/** Credenziali commercio.app: stesse variabili di @mvl/commercio-network (repo microservices). */
export interface CommercioCredentials {
  username: string;
  password: string;
  /** Destinatario del documento (did:com:…): il wallet Upthere, come CN_RECIPIENT_ADDRESS in Carma. */
  recipient: string;
}

interface ShareDocumentProcess {
  process_id: string;
  document_id: string;
  status: 'enqueued' | 'processing' | 'success' | 'failure';
  doc_tx_hash?: string;
  error?: string;
}

export class CommercioError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = 'CommercioError';
  }
}

/**
 * Notarizzazione su Commercio.network tramite le API di commercio.app: porting minimo di
 * @mvl/commercio-network (auth Keycloak + sharedoc), con fetch nativo invece di axios/qs/uuid.
 *
 * Un batch = un documento: checksum = sha256 del payload `{ v, app, events: [[eventId, hash], …] }`,
 * content_uri = pagina pubblica dove chiunque può rileggere il payload e ricalcolare l'hash.
 * Il processo è asincrono (202 + process_id): si interroga finché non arriva il tx_hash.
 */
export class CommercioNotary implements ChainNotary {
  readonly network: string;
  private readonly logger = new Logger(CommercioNotary.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: CommercioCfg,
    private readonly creds: CommercioCredentials,
    network: string,
    private readonly explorerTemplate: string,
    /** URL pubblico del gioco (links.game): il content_uri punta a {game}/api/chain/batch/{id}. */
    private readonly gameUrl: string,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.network = network;
  }

  async notarizeBatch(items: NotarizeItem[], batchId: string): Promise<{ txHash: string }> {
    const contentUri = `${this.gameUrl}/api/chain/batch/${batchId}`;
    const process = await this.api<ShareDocumentProcess>('POST', '/sharedoc/process', {
      back_url: '',
      content_uri: contentUri,
      document_uuid: batchId,
      hash: batchHash(items),
      hash_algorithm: 'sha-256',
      metadata: {
        content_uri: contentUri,
        schema: { uri: this.cfg.schema_uri, version: this.cfg.schema_version },
      },
      recipients: [this.creds.recipient],
    });

    const deadline = Date.now() + this.cfg.poll_timeout_ms;
    let current = process;
    for (;;) {
      if (current.status === 'success' && current.doc_tx_hash) return { txHash: current.doc_tx_hash };
      if (current.status === 'failure') throw new CommercioError(`processo ${process.process_id} fallito: ${current.error ?? '?'}`);
      if (Date.now() >= deadline) {
        throw new CommercioError(`processo ${process.process_id} ancora "${current.status}" dopo ${this.cfg.poll_timeout_ms} ms`);
      }
      await this.sleep(this.cfg.poll_interval_ms);
      current = await this.api<ShareDocumentProcess>('GET', `/sharedoc/process/${encodeURIComponent(process.process_id)}`);
    }
  }

  explorerUrl(txHash: string): string {
    return explorerTxUrl(this.explorerTemplate, txHash);
  }

  /** Chiamata autenticata; un 401 rinnova il token e riprova una volta. */
  private async api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${this.cfg.api_url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await this.bearer()}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.cfg.http_timeout_ms),
      });
      if (res.status === 401 && attempt === 1) {
        this.token = null;
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new CommercioError(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
      return JSON.parse(text) as T;
    }
  }

  /** Keycloak, grant password (come @mvl/commercio-network): il token resta in cache fino a poco prima della scadenza. */
  private async bearer(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await fetch(this.cfg.auth_token_url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.client_id,
        grant_type: 'password',
        scope: 'openid',
        username: this.creds.username,
        password: this.creds.password,
      }),
      signal: AbortSignal.timeout(this.cfg.http_timeout_ms),
    });
    if (!res.ok) throw new CommercioError(`login commercio.app: HTTP ${res.status}`, res.status);
    const data = (await res.json()) as { id_token?: string; expires_in?: number };
    if (!data.id_token) throw new CommercioError('login commercio.app: id_token mancante');
    const ttlMs = Math.max(0, (data.expires_in ?? 60) - 30) * 1000;
    this.token = { value: data.id_token, expiresAt: Date.now() + ttlMs };
    this.logger.log('login commercio.app riuscito');
    return data.id_token;
  }
}
