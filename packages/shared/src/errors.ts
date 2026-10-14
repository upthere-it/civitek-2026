// Codici errore (SP e gateway) → messaggio UI in italiano. Testi chiave: GAME_DESIGN §18.

export const ERROR_MESSAGES: Record<string, string> = {
  NO_FUNDS: 'Non hai abbastanza monete.',
  NOT_OWNER: 'Questa scarpa non è più tua.',
  LISTING_CLOSED: 'Troppo tardi: venduta.',
  DROP_SOLDOUT: 'Finite! Al prossimo drop.',
  INVENTORY_FULL: 'Armadio pieno: vendi qualcosa prima.',
  BUSY: 'Il mercato è affollato, riprova.',
  LISTING_NOT_FOUND: 'Questo annuncio non c’è più.',
  SELF_BUY: 'Questa scarpa è già tua.',
  ASSET_LOCKED: 'Questa scarpa è in prestito: aspetta che torni.',
  PRICE_OUT_OF_RANGE: 'Prezzo non valido per questa scarpa.',
  ALREADY_LISTED: 'Questa scarpa è già in bacheca.',
  NOT_FOR_SALE: 'Non è in vendita.',
  DROP_CLOSED: 'Il drop è chiuso. Al prossimo!',
  DROP_ALREADY_CLAIMED: 'Hai già preso il tuo paio a questo drop.',
  LEGEND_COOLDOWN: 'MC Suola si sta riposando: torna tra poco.',
  LEGEND_MAXED: 'MC Suola l’ha già indossata abbastanza: di più non vale.',
  ALREADY_VERIFIED: 'La Dott.ssa Hash l’ha già controllata.',
  PLAYER_NOT_FOUND: 'Giocatore non trovato.',
  ASSET_NOT_FOUND: 'Scarpa non trovata.',
  NICKNAME_TAKEN: 'Questo nome è già preso: provane un altro.',
  NICKNAME_INVALID: 'Nome non valido: da 3 a 14 lettere o numeri, senza spazi.',
  NICKNAME_BLOCKED: 'Questo nome non si può usare. Scegline un altro.',
  AVATAR_ALREADY_SET: 'Il tuo personaggio è già pronto.',
  AVATAR_INVALID: 'Scelta non valida, riprova.',
  AVATAR_REQUIRED: 'Prima crea il tuo personaggio.',
  INVALID_PAYLOAD: 'Richiesta non valida.',
  DEVICE_INVALID: 'Non riesco a riconoscere questo telefono. Ricarica la pagina.',
  SESSION_REPLACED: 'Il gioco è aperto in un’altra scheda.',
  WORLD_FULL: 'Il villaggio è pieno, riprova tra poco.',
  CODE_NOT_FOUND: 'Codice non trovato. Controlla le lettere e riprova.',
  RECOVER_LIMIT: 'Troppi tentativi. Aspetta un minuto e riprova.',
  RUN_NOT_FINISHED: 'La tua prima giornata non è ancora finita.',
  INTERNAL: 'Qualcosa è andato storto, riprova.',
};

/**
 * Codici delle SP che non arrivano al giocatore: il server li gestisce (ritenta la creazione del giocatore)
 * oppure sono violazioni di un invariante, che per il giocatore restano INTERNAL. TREASURY_LOW lo vedono solo i bot.
 */
export const INTERNAL_SP_CODES: readonly string[] = [
  'DEVICE_TAKEN',
  'RECOVERY_TAKEN',
  'LEDGER_INVALID',
  'TREASURY_LOW',
  // la run la chiude il server al tempo giusto: questi due vogliono dire un suo errore, non del giocatore
  'RUN_NOT_STARTED',
  'RUN_NOT_OVER',
];

export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL;
}
