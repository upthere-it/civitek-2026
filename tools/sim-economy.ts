// npm run sim:economy -- [--url http://localhost:3000] [--players 100] [--minutes 30] [--sample 30] [--think 3000]
// ECONOMY.md §7: giocatori simulati con comportamenti misti contro il server vero (bot compresi), sullo stesso DB
// del `.env`. Mostra tesoreria nel tempo, valore degli armadi, distacco fra primo e decimo, invarianti I1–I6.
// Il server deve girare sullo stesso database che legge questo script (DB_NAME del .env).
import mysql from 'mysql2/promise';
import { SimClient, Stats, args, checkTarget, config, sleep, spawn, type Profile } from './lib/sim-clients';
import { dbParams, loadEnv } from './lib/env';

const a = args();
const url = a.url ?? 'http://localhost:3000';
const players = Number(a.players ?? 100);
const minutes = Number(a.minutes ?? 30);
const sampleMs = Number(a.sample ?? 30) * 1000;
const thinkMs = Number(a.think ?? 3000);
checkTarget(url, a);

const browse = { move: 30, emote: 5, marketList: 8, passport: 6, leaderboard: 6, shopList: 3, stallList: 3 };

/** I comportamenti di ECONOMY.md §7: drop, bancarella (con e senza verifica), MC Suola, bacheca. */
const PROFILES: Profile[] = [
  {
    name: 'cacciatore di drop',
    weights: { ...browse, listingCreate: 6, listingBuy: 2, shopBuy: 2 },
    dropChance: 0.95,
    sellFactor: 1.3,
    buyBelow: 0.9,
    verifiesStall: true,
  },
  {
    name: 'affarista di bacheca',
    weights: { ...browse, listingBuy: 10, listingCreate: 8, shopBuy: 2 },
    dropChance: 0.4,
    sellFactor: 1.15,
    buyBelow: 1.0,
    verifiesStall: true,
  },
  {
    name: 'ingenuo da Tony',
    weights: { ...browse, stallBuy: 6, listingCreate: 3, shopBuy: 3 },
    dropChance: 0.3,
    sellFactor: 1.0,
    buyBelow: 1.2,
    verifiesStall: false,
  },
  {
    name: 'prudente',
    weights: { ...browse, stallBuy: 3, auth: 4, listingBuy: 3, listingCreate: 3 },
    dropChance: 0.5,
    sellFactor: 1.1,
    buyBelow: 0.95,
    verifiesStall: true,
  },
  {
    name: 'fan di MC Suola',
    weights: { ...browse, legend: 6, shopBuy: 3, listingCreate: 4 },
    dropChance: 0.5,
    sellFactor: 1.2,
    buyBelow: 1.0,
    verifiesStall: true,
  },
];

interface Sample {
  min: number;
  treasury: number;
  avg: number;
  median: number;
  top1: number;
  top10: number;
  fakesHeld: number;
}

async function main(): Promise<void> {
  loadEnv();
  const db = await mysql.createConnection(dbParams());
  const treasuryId = config.economy.system_players.treasury;
  const treasury = async () => {
    const [rows] = await db.query<mysql.RowDataPacket[]>('SELECT coins FROM players WHERE id = ?', [treasuryId]);
    return Number(rows[0]?.coins ?? 0);
  };

  console.log(`sim:economy: ${players} giocatori verso ${url} per ${minutes} min, DB ${dbParams().database}`);
  const stats = new Stats();
  const t0 = Date.now();
  const startTreasury = await treasury();
  const all = await spawn(players, 20_000, (i) => new SimClient(url, PROFILES[i % PROFILES.length], stats, thinkMs));
  const until = t0 + minutes * 60_000;

  const samples: Sample[] = [];
  const sample = async () => {
    const values = all.map((c) => c.wardrobeValue).sort((x, y) => y - x);
    const ids = all.map((c) => c.playerId).filter(Boolean);
    const [fakes] = ids.length
      ? await db.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM assets WHERE is_fake = 1 AND fake_revealed = 0 AND owner_id IN (?)', [ids])
      : [[{ n: 0 }] as mysql.RowDataPacket[]];
    const s: Sample = {
      min: (Date.now() - t0) / 60_000,
      treasury: await treasury(),
      avg: values.reduce((x, y) => x + y, 0) / Math.max(1, values.length),
      median: values[Math.floor(values.length / 2)] ?? 0,
      top1: values[0] ?? 0,
      top10: values[9] ?? 0,
      fakesHeld: Number(fakes[0].n),
    };
    samples.push(s);
    console.log(
      `  ${s.min.toFixed(1).padStart(5)} min  tesoreria ${String(s.treasury).padStart(6)}  armadio medio ${s.avg.toFixed(0).padStart(4)}` +
        `  mediana ${String(s.median).padStart(4)}  primo ${String(s.top1).padStart(4)}  decimo ${String(s.top10).padStart(4)}  falsi non scoperti ${s.fakesHeld}`,
    );
  };
  await sample();
  const timer = setInterval(() => void sample(), sampleMs);
  await Promise.all(all.map((c) => c.play(until)));
  clearInterval(timer);
  await sleep(1000);
  await sample();
  for (const c of all) c.stop();

  // armadio per comportamento, alla fine
  console.log('\nper comportamento (valore armadio a fine simulazione):');
  for (const p of PROFILES) {
    const v = all.filter((c) => c.profile === p).map((c) => c.wardrobeValue);
    console.log(`  ${p.name.padEnd(22)} media ${(v.reduce((x, y) => x + y, 0) / Math.max(1, v.length)).toFixed(0).padStart(4)}  max ${Math.max(...v)}`);
  }
  const at = (m: number) => samples.reduce((best, s) => (Math.abs(s.min - m) < Math.abs(best.min - m) ? s : best), samples[0]);
  for (const m of [5, 10].filter((m) => m <= minutes)) {
    const s = at(m);
    console.log(`a ${m} min: armadio medio ${s.avg.toFixed(0)}, distacco primo-decimo ${s.top1 - s.top10}`);
  }
  const end = samples[samples.length - 1];
  console.log(`tesoreria: ${startTreasury} → ${end.treasury} (${end.treasury - startTreasury >= 0 ? '+' : ''}${end.treasury - startTreasury})`);
  if (stats.failureCount()) console.log(`guasti: ${[...stats.failures].map(([k, v]) => `${k} ${v}`).join(', ')}`);

  const [check] = await db.query<mysql.RowDataPacket[][]>('CALL sp_economy_check()');
  const violations = check[0] ?? [];
  console.log(violations.length ? `VIOLAZIONI: ${JSON.stringify(violations)}` : 'invarianti I1–I6: nessuna violazione');
  await db.end();
  process.exit(violations.length || stats.failureCount() ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
