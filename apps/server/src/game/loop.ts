import type { Logger } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';
import { gameLoopsEnabled } from '../config/env';

/**
 * Registra un loop di gioco nello SchedulerRegistry: il primo giro parte subito (all'avvio Tony ha già il banco
 * pieno e i bot le loro scorte), poi uno ogni everyMs. Un giro non parte se il precedente non è finito, e un
 * errore finisce nel log senza fermare il loop. Con GAME_LOOPS=off (test) non registra niente.
 */
export function startLoop(scheduler: SchedulerRegistry, name: string, everyMs: number, fn: () => Promise<unknown>, logger: Logger): void {
  if (!gameLoopsEnabled()) return;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    fn()
      .catch((err: unknown) => logger.error(`${name}: ${String(err)}`))
      .finally(() => (running = false));
  };
  scheduler.addInterval(name, setInterval(run, everyMs));
  setImmediate(run);
}

export function stopLoop(scheduler: SchedulerRegistry, name: string): void {
  if (scheduler.doesExist('interval', name)) scheduler.deleteInterval(name);
}

/** Elemento a caso, pesato. Con pesi tutti a zero sceglie in modo uniforme. */
export function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rnd: (n: number) => number): T | undefined {
  if (!items.length) return undefined;
  const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0);
  if (total <= 0) return items[rnd(items.length)];
  let x = rnd(total);
  for (const t of items) {
    x -= Math.max(0, weight(t));
    if (x < 0) return t;
  }
  return items[items.length - 1];
}
