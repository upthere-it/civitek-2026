// Mappa del villaggio (Tiled JSON, generata da tools/assets/gen_village.py) e movimento sulla griglia.
// Server e client usano le stesse funzioni: il percorso calcolato è identico da entrambe le parti.

export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | string;
  data?: number[];
  objects?: TiledObject[];
}

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Place extends Point {
  /** Zona (banca, negozio, bancarella, palco, autenticatore, enoteca, bacheca) o "spawn". */
  name: string;
  /** npc | board | spawn */
  type: string;
  /** Dove si ferma l'avatar per interagire (centro della cella), se previsto. */
  approach: Point | null;
  props: Record<string, string>;
}

export interface WalkGrid {
  cols: number;
  rows: number;
  tile: number;
  /** 1 = cella bloccata */
  blocked: Uint8Array;
}

export interface Village {
  widthPx: number;
  heightPx: number;
  grid: WalkGrid;
  spawn: Point;
  places: Place[];
}

export function objectProps(o: TiledObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of o.properties ?? []) out[p.name] = String(p.value);
  return out;
}

export function parseVillage(map: TiledMap): Village {
  const tile = map.tilewidth;
  const objects = (layer: string) => map.layers.find((l) => l.name === layer)?.objects ?? [];

  const blocked = new Uint8Array(map.width * map.height);
  for (const c of objects('colliders')) {
    // una cella è bloccata se il rettangolo ne copre una parte (bordi esclusi)
    const x0 = Math.floor(c.x / tile);
    const y0 = Math.floor(c.y / tile);
    const x1 = Math.ceil((c.x + c.width) / tile) - 1;
    const y1 = Math.ceil((c.y + c.height) / tile) - 1;
    for (let y = Math.max(0, y0); y <= Math.min(map.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(map.width - 1, x1); x++) blocked[y * map.width + x] = 1;
    }
  }
  const grid: WalkGrid = { cols: map.width, rows: map.height, tile, blocked };

  const places: Place[] = objects('places').map((o) => {
    const props = objectProps(o);
    let approach: Point | null = null;
    if (props.approach) {
      const [tx, ty] = props.approach.split(',').map(Number);
      approach = cellCenter(grid, tx, ty);
    }
    return { name: o.name, type: o.type, x: o.x, y: o.y, approach, props };
  });
  const spawn = places.find((p) => p.type === 'spawn');
  if (!spawn) throw new Error('mappa senza punto di spawn');

  return { widthPx: map.width * tile, heightPx: map.height * tile, grid, spawn: { x: spawn.x, y: spawn.y }, places };
}

export function cellCenter(grid: WalkGrid, cx: number, cy: number): Point {
  return { x: cx * grid.tile + grid.tile / 2, y: cy * grid.tile + grid.tile / 2 };
}

export function cellOf(grid: WalkGrid, p: Point): { cx: number; cy: number } {
  return { cx: Math.floor(p.x / grid.tile), cy: Math.floor(p.y / grid.tile) };
}

export function walkableCell(grid: WalkGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows && grid.blocked[cy * grid.cols + cx] === 0;
}

export function isWalkable(grid: WalkGrid, p: Point): boolean {
  const { cx, cy } = cellOf(grid, p);
  return walkableCell(grid, cx, cy);
}

/** La cella calpestabile più vicina (BFS), per tap su un edificio o un punto fuori piazza. */
export function nearestWalkable(grid: WalkGrid, p: Point): Point | null {
  if (isWalkable(grid, p)) return p;
  const start = cellOf(grid, p);
  const seen = new Uint8Array(grid.cols * grid.rows);
  const queue: [number, number][] = [[clamp(start.cx, 0, grid.cols - 1), clamp(start.cy, 0, grid.rows - 1)]];
  seen[queue[0][1] * grid.cols + queue[0][0]] = 1;
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy] = queue[i];
    if (walkableCell(grid, cx, cy)) return cellCenter(grid, cx, cy);
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows || seen[ny * grid.cols + nx]) continue;
      seen[ny * grid.cols + nx] = 1;
      queue.push([nx, ny]);
    }
  }
  return null;
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIRS8 = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A* a 8 direzioni (diagonali solo se non tagliano un angolo) e poi "string pulling": restituisce i
 * punti da raggiungere in ordine, escluso quello di partenza; l'ultimo è il bersaglio (o la cella
 * calpestabile più vicina). null se irraggiungibile, [] se si è già arrivati.
 */
export function findPath(grid: WalkGrid, from: Point, to: Point): Point[] | null {
  const target = nearestWalkable(grid, to);
  if (!target) return null;
  const s = cellOf(grid, isWalkable(grid, from) ? from : (nearestWalkable(grid, from) ?? from));
  const g = cellOf(grid, target);
  if (s.cx === g.cx && s.cy === g.cy) return samePoint(from, target) ? [] : [target];

  const n = grid.cols * grid.rows;
  const cost = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();
  const idx = (cx: number, cy: number) => cy * grid.cols + cx;
  const h = (cx: number, cy: number) => {
    const dx = Math.abs(cx - g.cx);
    const dy = Math.abs(cy - g.cy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const si = idx(s.cx, s.cy);
  const gi = idx(g.cx, g.cy);
  cost[si] = 0;
  open.push(si, h(s.cx, s.cy));
  while (open.size) {
    const cur = open.pop();
    if (cur === gi) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % grid.cols;
    const cy = (cur - cx) / grid.cols;
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkableCell(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walkableCell(grid, cx + dx, cy) || !walkableCell(grid, cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      const c = cost[cur] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (c < cost[ni]) {
        cost[ni] = c;
        parent[ni] = cur;
        open.push(ni, c + h(nx, ny));
      }
    }
  }
  if (parent[gi] === -1) return null;

  const cells: Point[] = [];
  for (let i = gi; i !== si; i = parent[i]) cells.push(cellCenter(grid, i % grid.cols, Math.floor(i / grid.cols)));
  cells.reverse();
  cells[cells.length - 1] = target;

  // string pulling: dal punto corrente salta al punto più lontano visibile in linea retta
  const out: Point[] = [];
  let anchor = from;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineWalkable(grid, anchor, cells[j])) j--;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}

/** Il segmento resta su celle calpestabili (campionato ogni quarto di cella). */
export function lineWalkable(grid: WalkGrid, a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) / grid.tile) * 4));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (!isWalkable(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

export type Facing = 'down' | 'up' | 'left' | 'right';

export interface Mover extends Point {
  path: Point[];
  facing: Facing;
}

export function facingOf(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

/** Avanza di `dist` pixel lungo il percorso. Restituisce true se si sta ancora muovendo. */
export function advance(m: Mover, dist: number): boolean {
  let left = dist;
  while (left > 0 && m.path.length) {
    const next = m.path[0];
    const dx = next.x - m.x;
    const dy = next.y - m.y;
    const d = Math.hypot(dx, dy);
    m.facing = facingOf(dx, dy, m.facing);
    if (d <= left) {
      m.x = next.x;
      m.y = next.y;
      m.path.shift();
      left -= d;
    } else {
      m.x += (dx / d) * left;
      m.y += (dy / d) * left;
      left = 0;
    }
  }
  return m.path.length > 0;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.prio[up] <= this.prio[i]) break;
      this.swap(i, up);
      i = up;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
