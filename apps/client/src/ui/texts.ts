// Testi UI in italiano: chiavi di GAME_DESIGN §18 (frasi brevi, tono diretto).
export const T = {
  landingTitle: 'Ogni scarpa ha una storia. La tua inizia adesso.',
  landingCta: 'Entra nel mercato',
  loading: (pct: number) => `Carico il villaggio… ${pct}%`,
  connecting: 'Entro…',
  avatarTitle: 'Crea il tuo personaggio',
  avatarSkin: 'Pelle',
  avatarHair: 'Capelli',
  avatarOutfit: 'Felpa',
  avatarCta: 'Entra',
  hairStyles: { corti: 'Corti', lunghi: 'Lunghi', cappellino: 'Cappellino' } as Record<string, string>,
  hudCoins: (n: number) => `${n} monete`,
  hudWardrobe: (n: number) => `Armadio: ${n}`,
  emotes: 'Emote',
  offline: 'Connessione persa, riprovo…',
  replacedCta: 'Gioca qui',
  boardSoon: 'La bacheca apre a breve: qui vedrai gli annunci degli altri.',
};
