// Nomi scelti dai giocatori (D12): formato da config e filtro di parole lato server.
import { nicknameFormatError, normalizeNickname, suggestNickname } from '@sp/shared';
import { NicknameFilter, canonical } from '../src/game/nickname-filter';
import { cfg } from './helpers/db';

const filter = NicknameFilter.fromRepo();
const fmt = (n: string) => nicknameFormatError(normalizeNickname(n), cfg.player.nickname);

describe('formato del nome', () => {
  it.each(['Lince42', 'Volpe_7', 'Àlex.99', 'Niña-3', 'abc'])('%s va bene', (n) => expect(fmt(n)).toBeNull());
  it.each(['ab', 'Mario Rossi', 'x'.repeat(15), '_Lince', 'Lince!', 'Lince😀', ''])('%s no', (n) => expect(fmt(n)).toBe('NICKNAME_INVALID'));

  it('i nomi proposti dal gioco rispettano sempre il formato, anche con la cifra in più', () => {
    let i = 0;
    const rnd = (n: number) => (i++ * 7919) % n;
    for (let k = 0; k < 200; k++) {
      expect(fmt(suggestNickname(cfg.player.nickname, rnd))).toBeNull();
      expect(fmt(suggestNickname(cfg.player.nickname, rnd, 1))).toBeNull();
    }
  });
});

describe('filtro di parole', () => {
  it('normalizza maiuscole, accenti, leet e lettere ripetute', () => {
    expect(canonical('C4ZZZ0_99')).toBe('cazo');
    expect(canonical('Àlèx')).toBe('alex');
  });

  it.each(['Cazzone', 'c4zz0', 'StR0nZ0', 'NikeLover', 'xFUCKx', 'Upthere1', 'TonyAffari', 'Admin', 'figa', 'Puma99', 'Dio'])(
    '%s bloccato',
    (n) => expect(filter.isBlocked(n)).toBe(true),
  );

  it.each(['Lince42', 'Fenicottero07', 'Scoiattolo10', 'Pacifica', 'Figaro', 'Essex', 'Skillz', 'Ivanscott', 'Sneakerhead', 'Riccio45'])(
    '%s ammesso',
    (n) => expect(filter.isBlocked(n)).toBe(false),
  );

  it('nessun animale dei nomi proposti è bloccato', () => {
    for (const a of cfg.player.nickname.animals) expect(filter.isBlocked(`${a}42`)).toBe(false);
  });
});
