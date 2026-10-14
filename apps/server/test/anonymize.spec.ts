// Anonimizzazione dei giocatori inattivi (CLAUDE.md regola 6): via device, codice, aspetto e nome scelto;
// restano monete, scarpe e catene, e gli invarianti restano verdi.
import { randomBytes } from 'node:crypto';
import { cfg, coinsOf, eventsOf, newPlayer, openTestDb, spCode, violations } from './helpers/db';

const { db } = openTestDb();
afterAll(() => db.onModuleDestroy());

const days = cfg.player.inactivity_anonymize_days;
const lastSeen = (id: number, daysAgo: number) =>
  db.select('UPDATE players SET last_seen_at = NOW(6) - INTERVAL ? DAY WHERE id = ?', [daysAgo, id]);

interface Row {
  nickname: string;
  device_hash: string | null;
  recovery_hash: string | null;
  avatar_skin: number | null;
  anonymized_at: string | null;
}
const rowOf = async (id: number) =>
  (await db.select<Row>('SELECT nickname, device_hash, recovery_hash, avatar_skin, anonymized_at FROM players WHERE id = ?', [id]))[0];

/** Giocatore vero, con nome scelto e aspetto. */
async function chosen(): Promise<{ id: number; giftAssetId: number; device: string }> {
  const device = randomBytes(32).toString('hex');
  const nick = `Ano${randomBytes(4).toString('hex')}`;
  const [row] = await db.call<{ player_id: number; gift_asset_id: number }>('sp_player_get_or_create', [
    device,
    nick,
    randomBytes(32).toString('hex'),
  ]);
  await db.call('sp_player_set_profile', [row.player_id, nick, 1, 0, 1, 0, 0]);
  return { id: row.player_id, giftAssetId: row.gift_asset_id, device };
}

describe('sp_anonymize_inactive', () => {
  it('anonimizza chi è inattivo da più di inactivity_anonymize_days, lascia stare gli altri', async () => {
    const old = await chosen();
    const recent = await chosen();
    await lastSeen(old.id, days + 1);
    await lastSeen(recent.id, days - 1);
    const chainBefore = await eventsOf(db, old.giftAssetId);
    const coinsBefore = await coinsOf(db, old.id);

    // a blocchi di 1: si richiama finché ne trova
    let total = 0;
    for (let n = 1; n > 0; ) {
      const [r] = await db.call<{ anonymized: number }>('sp_anonymize_inactive', [days, 1]);
      n = Number(r.anonymized);
      total += n;
    }
    expect(total).toBeGreaterThanOrEqual(1);

    const a = await rowOf(old.id);
    expect(a).toMatchObject({ nickname: `Anonimo ${old.id}`, device_hash: null, recovery_hash: null, avatar_skin: null });
    expect(a.anonymized_at).not.toBeNull();
    const [devices] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM player_devices WHERE player_id = ?', [old.id]);
    expect(Number(devices.n)).toBe(0);

    // monete, scarpe e catena restano come prima
    expect(await coinsOf(db, old.id)).toBe(coinsBefore);
    expect(await eventsOf(db, old.giftAssetId)).toEqual(chainBefore);

    const b = await rowOf(recent.id);
    expect(b.anonymized_at).toBeNull();
    expect(b.device_hash).not.toBeNull();

    expect(await violations(db)).toEqual([]);
  });

  it('lo stesso telefono, se torna, è un giocatore nuovo', async () => {
    const old = await chosen();
    await lastSeen(old.id, days + 1);
    await db.call('sp_anonymize_inactive', [days, 1000]);
    const [again] = await db.call<{ player_id: number; created: number }>('sp_player_get_or_create', [
      old.device,
      `Nuovo${randomBytes(3).toString('hex')}`,
      randomBytes(32).toString('hex'),
    ]);
    expect(again.created).toBe(1);
    expect(again.player_id).not.toBe(old.id);
  });

  it('una seconda passata non tocca chi è già anonimo; parametri non validi rifiutati', async () => {
    const p = await newPlayer(db);
    await lastSeen(p.id, days + 1);
    await db.call('sp_anonymize_inactive', [days, 1000]);
    const first = await rowOf(p.id);
    await db.call('sp_anonymize_inactive', [days, 1000]);
    expect(await rowOf(p.id)).toEqual(first);
    expect(await spCode(db.call('sp_anonymize_inactive', [0, 10]))).toBe('INVALID_PAYLOAD');
  });
});
