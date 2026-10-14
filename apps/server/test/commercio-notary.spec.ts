// CommercioNotary contro un finto commercio.app (Keycloak + sharedoc), e dentro il ChainWorker sul DB di test.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { CommercioCfg } from '@sp/shared';
import { ChainController } from '../src/chain/chain.controller';
import { ChainEventsService } from '../src/chain/chain-events.service';
import { batchHash, type NotarizeItem } from '../src/chain/chain-notary';
import { ChainWorker } from '../src/chain/chain.worker';
import { CommercioNotary } from '../src/chain/commercio-notary';
import { MockNotary } from '../src/chain/mock-notary';
import { createNotary } from '../src/chain/notary.factory';
import { cfg, eventsOf, newPlayer, openTestDb } from './helpers/db';

/** Finto commercio.app: registra le richieste e risponde secondo lo scenario. */
class FakeCommercio {
  server!: Server;
  url = '';
  logins = 0;
  tokenCounter = 0;
  /** token accettati dall'API (un login ne aggiunge uno) */
  validTokens = new Set<string>();
  submitted: Record<string, unknown>[] = [];
  polls = 0;
  /** stati restituiti dai GET successivi; l'ultimo si ripete */
  statuses: { status: string; doc_tx_hash?: string; error?: string }[] = [{ status: 'success', doc_tx_hash: 'AB12' }];
  loginStatus = 200;

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/token') {
      this.logins++;
      const form = new URLSearchParams(raw);
      if (this.loginStatus !== 200 || form.get('grant_type') !== 'password' || form.get('username') !== 'gioco@upthere.it') {
        return send(this.loginStatus === 200 ? 401 : this.loginStatus, { error: 'invalid_grant' });
      }
      const token = `tok${++this.tokenCounter}`;
      this.validTokens.add(token);
      return send(200, { id_token: token, expires_in: 300 });
    }
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (!this.validTokens.has(token)) return send(401, { error: 'unauthorized' });
    if (req.method === 'POST' && req.url === '/v1/sharedoc/process') {
      const body = JSON.parse(raw) as Record<string, unknown>;
      this.submitted.push(body);
      return send(202, { process_id: 'p-1', document_id: body.document_uuid, status: 'enqueued' });
    }
    if (req.method === 'GET' && req.url === '/v1/sharedoc/process/p-1') {
      const s = this.statuses[Math.min(this.polls++, this.statuses.length - 1)];
      return send(200, { process_id: 'p-1', document_id: 'x', ...s });
    }
    send(404, { error: 'not found' });
  }
}

const fake = new FakeCommercio();
const creds = { username: 'gioco@upthere.it', password: 'segreta', recipient: 'did:com:1destinatario' };
const GAME = 'https://civitek.upthere.it';
const items: NotarizeItem[] = [
  { eventId: 41, hash: 'a'.repeat(64) },
  { eventId: 42, hash: 'b'.repeat(64) },
];
const batchId = '0f5e3c1a-9b7d-4e2f-8a6c-1d2e3f4a5b6c';
const instant = () => Promise.resolve();

const commercioCfg = (over: Partial<CommercioCfg> = {}): CommercioCfg => ({
  ...cfg.chain.commercio,
  auth_token_url: `${fake.url}/token`,
  api_url: `${fake.url}/v1`,
  ...over,
});

const notary = (over: Partial<CommercioCfg> = {}, sleep: (ms: number) => Promise<void> = instant) =>
  new CommercioNotary(commercioCfg(over), creds, cfg.chain.network, cfg.chain.explorer_tx_url, GAME, sleep);

beforeAll(() => fake.start());
afterAll(() => fake.stop());
beforeEach(() => {
  Object.assign(fake, { logins: 0, polls: 0, submitted: [], loginStatus: 200 });
  fake.validTokens.clear();
  fake.statuses = [{ status: 'enqueued' }, { status: 'processing' }, { status: 'success', doc_tx_hash: 'AB12' }];
});

describe('CommercioNotary', () => {
  it('invia un documento per batch con l’hash cumulativo e aspetta il tx_hash', async () => {
    const res = await notary().notarizeBatch(items, batchId);

    expect(res).toEqual({ txHash: 'AB12' });
    expect(fake.logins).toBe(1);
    expect(fake.polls).toBe(3);
    expect(fake.submitted).toEqual([
      {
        back_url: '',
        content_uri: `${GAME}/api/chain/batch/${batchId}`,
        document_uuid: batchId,
        hash: batchHash(items),
        hash_algorithm: 'sha-256',
        metadata: {
          content_uri: `${GAME}/api/chain/batch/${batchId}`,
          schema: { uri: cfg.chain.commercio.schema_uri, version: cfg.chain.commercio.schema_version },
        },
        recipients: [creds.recipient],
      },
    ]);
    // on-chain va solo l'hash: nel corpo non ci sono gli hash dei singoli eventi né dati dei giocatori
    expect(JSON.stringify(fake.submitted)).not.toContain('a'.repeat(64));
  });

  it('il token resta in cache tra un batch e l’altro', async () => {
    const n = notary();
    await n.notarizeBatch(items, batchId);
    fake.polls = 0;
    await n.notarizeBatch(items, batchId);
    expect(fake.logins).toBe(1);
  });

  it('su 401 rifà il login una volta e riprova', async () => {
    const n = notary();
    await n.notarizeBatch(items, batchId);
    fake.validTokens.clear(); // token scaduto lato server
    fake.polls = 0;
    await expect(n.notarizeBatch(items, batchId)).resolves.toEqual({ txHash: 'AB12' });
    expect(fake.logins).toBe(2);
  });

  it('processo fallito: errore con il motivo di commercio.app', async () => {
    fake.statuses = [{ status: 'failure', error: 'bastion could not sign the messages' }];
    await expect(notary().notarizeBatch(items, batchId)).rejects.toThrow(/bastion could not sign/);
  });

  it('processo che non finisce: errore dopo poll_timeout_ms', async () => {
    fake.statuses = [{ status: 'processing' }];
    const n = notary({ poll_timeout_ms: 60, poll_interval_ms: 10 }, (ms) => new Promise((r) => setTimeout(r, ms)));
    await expect(n.notarizeBatch(items, batchId)).rejects.toThrow(/ancora "processing"/);
  });

  it('credenziali sbagliate: errore di login', async () => {
    fake.loginStatus = 401;
    await expect(notary().notarizeBatch(items, batchId)).rejects.toThrow(/login commercio.app: HTTP 401/);
  });

  it('link all’explorer della testnet dal template di config', () => {
    expect(notary().explorerUrl('AB12')).toBe('https://testnet.commercio.network/transactions/detail/AB12');
  });
});

describe('createNotary', () => {
  const withNotary = (notaryName: string) => ({ ...cfg.config, chain: { ...cfg.chain, notary: notaryName } });

  it('mock se la config lo chiede', () => {
    expect(createNotary(withNotary('mock'), {})).toBeInstanceOf(MockNotary);
  });

  it('commercio senza credenziali in produzione: errore che dice cosa manca', () => {
    expect(() => createNotary(withNotary('commercio'), { NODE_ENV: 'production', CN_USERNAME: 'x' })).toThrow(
      /CN_PASSWORD, CN_RECIPIENT_ADDRESS/,
    );
  });

  it('commercio senza credenziali fuori produzione: Mock (sviluppo senza .env, test, CI)', () => {
    expect(createNotary(withNotary('commercio'), { NODE_ENV: 'test' })).toBeInstanceOf(MockNotary);
  });

  it('commercio con credenziali', () => {
    const env = { CN_USERNAME: 'u', CN_PASSWORD: 'p', CN_RECIPIENT_ADDRESS: 'did:com:1x' };
    expect(createNotary(withNotary('commercio'), env)).toBeInstanceOf(CommercioNotary);
  });
});

describe('CommercioNotary nel ChainWorker', () => {
  const { db } = openTestDb();
  afterAll(() => db.onModuleDestroy());

  it('gli eventi diventano CONFIRMED con il tx di Commercio e il batch si verifica dalla pagina pubblica', async () => {
    const n = notary();
    const worker = new ChainWorker(db, n, new ChainEventsService(), cfg, new SchedulerRegistry());
    // svuota l'outbox lasciato dagli altri test, poi un evento nuovo
    fake.statuses = [{ status: 'success', doc_tx_hash: 'AB12' }];
    while ((await worker.tick()) > 0) fake.polls = 0;
    const p = await newPlayer(db);
    fake.submitted = [];
    await worker.tick();

    const [ev] = await eventsOf(db, p.giftAssetId);
    expect(ev).toMatchObject({ chain_status: 'CONFIRMED', chain_tx: 'AB12' });
    const sent = fake.submitted.at(-1)!;
    expect(sent.document_uuid).toBe(ev.chain_batch);

    const page = await new ChainController(db, n).batch(ev.chain_batch!);
    expect(page.sha256).toBe(sent.hash);
    expect(page.events).toContainEqual([ev.id, ev.hash]);
    expect(page.explorerUrl).toBe('https://testnet.commercio.network/transactions/detail/AB12');
    expect(JSON.stringify(page)).not.toMatch(/nickname|device/);
  });
});
