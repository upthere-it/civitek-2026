// /api/health: stato pubblico (DB, coda della certificazione, online) e controllo completo solo con il token.
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { CHAIN_NOTARY } from '../src/chain/chain-notary';
import { MockNotary } from '../src/chain/mock-notary';

let app: INestApplication;
let url: string;
const TOKEN = 'token-di-prova-per-health-0123456789';

beforeAll(async () => {
  process.env.HEALTH_TOKEN = TOKEN;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_NOTARY)
    .useValue(new MockNotary({ min_delay_ms: 0, max_delay_ms: 0 }))
    .compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/health`;
});

afterAll(async () => {
  delete process.env.HEALTH_TOKEN;
  await app.close();
});

describe('/api/health', () => {
  it('pubblico: DB, coda della certificazione e online, senza toccare il notary', async () => {
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: expect.stringMatching(/^(ok|warn)$/), db: { ok: true }, world: { online: 0 } });
    expect(body.chain).toMatchObject({ notary: 'mock', pending: expect.any(Number), failed: expect.any(Number) });
    expect(body).not.toHaveProperty('notary');
    // con il Mock è un avviso: in produzione deve sparire
    expect(body.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/MockNotary/)]));
  });

  it('completo solo con il token giusto', async () => {
    expect((await fetch(`${url}?full=1`)).status).toBe(403);
    expect((await fetch(`${url}?full=1`, { headers: { 'x-health-token': 'sbagliato' } })).status).toBe(403);
    const res = await fetch(`${url}?full=1`, { headers: { 'x-health-token': TOKEN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notary: { ok: true, network: 'mock' } });
  });
});
