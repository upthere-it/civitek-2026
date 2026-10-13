// Codici errore (SP e gateway) → messaggio UI in italiano. Testi chiave: GAME_DESIGN §18.

export const ERROR_MESSAGES: Record<string, string> = {
  NO_FUNDS: 'Non hai abbastanza monete.',
  NOT_OWNER: 'Questa scarpa non è più tua.',
  LISTING_CLOSED: 'Troppo tardi: venduta.',
  DROP_SOLDOUT: 'Finite! Al prossimo drop.',
  INVENTORY_FULL: 'Armadio pieno: vendi qualcosa prima.',
  BUSY: 'Il mercato è affollato, riprova.',
  AVATAR_ALREADY_SET: 'Il tuo personaggio è già pronto.',
  AVATAR_INVALID: 'Scelta non valida, riprova.',
  AVATAR_REQUIRED: 'Prima crea il tuo personaggio.',
  INVALID_PAYLOAD: 'Richiesta non valida.',
  DEVICE_INVALID: 'Non riesco a riconoscere questo telefono. Ricarica la pagina.',
  SESSION_REPLACED: 'Il gioco è aperto in un’altra scheda.',
  WORLD_FULL: 'Il villaggio è pieno, riprova tra poco.',
  INTERNAL: 'Qualcosa è andato storto, riprova.',
};

export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL;
}
