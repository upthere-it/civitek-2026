// npm run loadtest -- [--url http://localhost:3000] [--clients 150] [--minutes 10] [--ramp 30] [--think 2000] [--p95 300]
// Accettazione M5 (docs/PLAN.md): 150 client socket.io per 10 minuti, nessun errore, p95 delle azioni < 300 ms.
// Ogni client fa quello che farebbe un ragazzo: crea l'avatar, cammina, apre bacheca e passaporti, compra e vende,
// va ai drop. Si misura il tempo di ogni ack. Gli errori di gioco (saldo, annuncio già venduto) sono attesi.
import { SimClient, Stats, args, checkTarget, percentile, sleep, spawn, type Profile } from './lib/sim-clients';

const a = args();
const url = a.url ?? 'http://localhost:3000';
const clients = Number(a.clients ?? 150);
const minutes = Number(a.minutes ?? 10);
const rampMs = Number(a.ramp ?? 30) * 1000;
const thinkMs = Number(a.think ?? 2000);
const p95Max = Number(a.p95 ?? 300);
checkTarget(url, a);

const MIX: Profile = {
  name: 'misto',
  weights: {
    move: 35,
    emote: 8,
    marketList: 10,
    passport: 8,
    leaderboard: 8,
    shopList: 4,
    stallList: 4,
    shopBuy: 4,
    listingCreate: 6,
    listingBuy: 6,
    stallBuy: 3,
    auth: 2,
    legend: 2,
  },
  dropChance: 0.5,
  sellFactor: 1.1,
  buyBelow: 1.2,
  verifiesStall: true,
};

async function main(): Promise<void> {
  const stats = new Stats();
  const t0 = Date.now();
  console.log(`loadtest: ${clients} client verso ${url}, ${minutes} min (rampa ${rampMs / 1000} s, pausa media ${thinkMs} ms)`);
  const until = t0 + minutes * 60_000;
  const all = await spawn(clients, rampMs, () => new SimClient(url, MIX, stats, thinkMs));
  console.log(`  connessi ${stats.connected}/${clients} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const progress = setInterval(() => {
    const n = [...stats.latency.values()].reduce((s, l) => s + l.length, 0);
    const min = ((Date.now() - t0) / 60_000).toFixed(1);
    console.log(`  ${min} min: ${n} azioni, ${stats.failureCount()} guasti, ${stats.disconnects} disconnessioni`);
  }, 60_000);
  await Promise.all(all.map((c) => c.play(until)));
  clearInterval(progress);
  await sleep(500);
  for (const c of all) c.stop();

  const rows = [...stats.latency.entries()].sort((x, y) => y[1].length - x[1].length);
  const everything = rows.flatMap(([, l]) => l).sort((x, y) => x - y);
  console.log('\nevento               n      p50    p95    p99    max   (ms)');
  for (const [event, list] of rows) {
    const s = [...list].sort((x, y) => x - y);
    const f = (v: number) => v.toFixed(0).padStart(6);
    console.log(`${event.padEnd(18)} ${String(s.length).padStart(6)} ${f(percentile(s, 50))} ${f(percentile(s, 95))} ${f(percentile(s, 99))} ${f(s[s.length - 1])}`);
  }
  const p95 = percentile(everything, 95);
  const rate = everything.length / ((Date.now() - t0) / 1000);
  console.log(`${'TUTTE'.padEnd(18)} ${String(everything.length).padStart(6)} ${percentile(everything, 50).toFixed(0).padStart(6)} ${p95.toFixed(0).padStart(6)} ${percentile(everything, 99).toFixed(0).padStart(6)}   (${rate.toFixed(1)} azioni/s)`);
  if (stats.expected.size) console.log(`\nerrori di gioco attesi: ${[...stats.expected].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const failures = stats.failureCount();
  if (failures) console.log(`GUASTI: ${[...stats.failures].map(([k, v]) => `${k} ${v}`).join(', ')}`);

  const ok = failures === 0 && stats.connected === clients && p95 < p95Max;
  console.log(`\n${ok ? 'OK' : 'NON SUPERATO'}: ${stats.connected}/${clients} connessi, ${failures} guasti, p95 ${p95.toFixed(0)} ms (soglia ${p95Max})`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
