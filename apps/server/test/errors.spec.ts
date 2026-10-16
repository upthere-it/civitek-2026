// Ogni codice d'errore delle SP ha un messaggio in italiano (GAME_DESIGN §18), oppure è dichiarato interno.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_MESSAGES, INTERNAL_SP_CODES } from '@sp/shared';

const SQL_DIR = join(__dirname, '../../../sql');

function spCodes(): string[] {
  const codes = new Set<string>();
  for (const f of readdirSync(SQL_DIR).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(SQL_DIR, f), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    for (const m of sql.matchAll(/MESSAGE_TEXT\s*=\s*'([A-Z_]+)'/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe('errori delle stored procedure', () => {
  it('le SP segnalano almeno i codici del mercato', () => {
    expect(spCodes()).toEqual(expect.arrayContaining(['NO_FUNDS', 'NOT_OWNER', 'LISTING_CLOSED', 'NOT_FOR_SALE']));
  });

  it.each(spCodes())('%s ha un messaggio per il giocatore o è interno', (code) => {
    expect(code in ERROR_MESSAGES || INTERNAL_SP_CODES.includes(code)).toBe(true);
  });

  it('nessun codice interno ha un messaggio: arriverebbe al giocatore così com’è', () => {
    expect(INTERNAL_SP_CODES.filter((c) => c in ERROR_MESSAGES)).toEqual([]);
  });
});
