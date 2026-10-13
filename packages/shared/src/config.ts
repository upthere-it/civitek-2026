// Tipi di data/game_config.json. Il file resta l'unica fonte dei numeri di gioco (CLAUDE.md, regola 7):
// qui ci sono solo le forme, mai i valori.

export interface ValuationCfg {
  legend_bonus_per_wear: number;
  legend_max_counted: number;
  upthere_mint_bonus: number;
  gap_multiplier: number;
  flip_free_owners: number;
  flip_penalty_per_owner: number;
  flip_floor: number;
  fake_value_after_auth: number;
  min_value: number;
}

export interface SystemPlayersCfg {
  treasury: number;
  shop: number;
  stall: number;
  legend: number;
  bots_from: number;
}

export interface BotsCfg {
  count: number;
  buy_pct: number;
  sell_pct: number;
  min_treasury_pct_to_buy: number;
  tick_sec: number;
  max_inventory_per_bot: number;
  full_activity_below_humans_online: number;
  min_activity_at_humans_online: number;
  min_activity: number;
}

export interface EconomyCfg {
  system_players: SystemPlayersCfg;
  treasury_initial: number;
  market_fee_pct: number;
  market_fee_min: number;
  listing_min_price: number;
  listing_max_multiplier: number;
  shop_price: string;
  auth_cost: number;
  legend: { cost: number; wear_duration_sec: number; cooldown_sec: number };
  bots: BotsCfg;
  stall: { price_pct_of_base: number; max_fakes_on_sale: number; restock_sec: number; fake_tiers: ItemTier[] };
}

export interface PlayerCfg {
  start_coins: number;
  starter_item_pool: string[];
  max_inventory: number;
  nickname: { pattern: string; number_digits: number; animals: string[]; editable: boolean };
  recovery_code: { length: number; alphabet: string; display_format: string };
  inactivity_anonymize_days: number;
  rate_limit_actions_per_sec: number;
}

export interface AvatarCfg {
  frame: { width: number; height: number; origin_x: number; origin_y: number };
  skin_tones: string[];
  hair_styles: string[];
  hair_colors: string[];
  outfit_colors: string[];
  pants_color: string;
  shoes_default_color: string;
  draw_order: string[];
  animations: Record<'idle' | 'walk', { frames: number; frameRate: number }>;
  directions: string[];
}

export interface ChainCfg {
  enabled: boolean;
  notary: 'mock' | string;
  network: string;
  batch_interval_ms: number;
  max_items_per_batch: number;
  max_attempts: number;
  explorer_tx_url: string;
  mock: { min_delay_ms: number; max_delay_ms: number };
}

export interface FirstRunCfg {
  duration_sec: number;
  objective: { type: string; multiplier: number };
  beats: { at_sec: number; id: string }[];
}

export interface DropsCfg {
  interval_sec: number;
  quantity: number;
  window_sec: number;
  max_per_player: number;
  price: string;
  pool_tiers: ItemTier[];
}

export interface WorldCfg {
  tick_hz: number;
  visible_radius_px: number;
  max_players_per_room: number;
  emotes: string[];
  /** Mappa Tiled, relativa a apps/client/public/ */
  map: string;
  walk_speed_px_s: number;
  camera_zoom: number;
  emote_duration_ms: number;
  /** Oltre questa distanza dal server il client riallinea il proprio avatar. */
  reconcile_px: number;
}

export interface GameConfig {
  version: string;
  conference: { date: string; expected_players: number };
  brand: { name: string; colors: Record<string, string>; [k: string]: unknown };
  links: { dop_digital: string };
  player: PlayerCfg;
  avatar: AvatarCfg;
  first_run: FirstRunCfg;
  economy: EconomyCfg;
  valuation: ValuationCfg;
  drops: DropsCfg;
  world: WorldCfg;
  chain: ChainCfg;
  leaderboard: { metric: string; size: number };
}

export type ItemTier = 'base' | 'trend' | 'hype' | 'limited' | 'upthere';
export type ItemRarity = 'common' | 'popular' | 'hyped' | 'limited';
export type ItemSource = 'shop' | 'drop' | 'starter';

export interface GameItem {
  id: string;
  brand: string;
  name: string;
  display_name: string;
  colorway: string;
  silhouette: string;
  sprite_key: string;
  palette: { upper: string; accent: string; sole: string };
  tier: ItemTier;
  rarity: ItemRarity;
  base_value: number;
  sources: ItemSource[];
  fakeable: boolean;
  drop_weight: number;
  flavor: string;
}
