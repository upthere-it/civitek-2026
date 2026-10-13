import gameConfig from '../../../data/game_config.json';
import villageJson from '../../../apps/client/public/assets/maps/village.json';
import {
  advance,
  findPath,
  isWalkable,
  lineWalkable,
  nearestWalkable,
  parseVillage,
  type Mover,
  type TiledMap,
} from '../src/village';

const village = parseVillage(villageJson as unknown as TiledMap);
const { grid } = village;

describe('mappa del villaggio', () => {
  it('ha uno spawn calpestabile e le zone di GAME_DESIGN §4', () => {
    expect(isWalkable(grid, village.spawn)).toBe(true);
    const zones = village.places.map((p) => p.name).sort();
    expect(zones).toEqual(['autenticatore', 'bacheca', 'banca', 'bancarella', 'enoteca', 'negozio', 'palco', 'spawn']);
  });

  it('ogni punto di interazione è calpestabile e raggiungibile dallo spawn', () => {
    for (const p of village.places.filter((x) => x.approach)) {
      expect(isWalkable(grid, p.approach!)).toBe(true);
      const path = findPath(grid, village.spawn, p.approach!);
      expect(path).not.toBeNull();
      expect(path![path!.length - 1]).toEqual(p.approach);
    }
  });

  it('gli NPC stanno su celle bloccate: non ci si cammina sopra', () => {
    for (const p of village.places.filter((x) => x.type === 'npc')) expect(isWalkable(grid, p)).toBe(false);
  });
});

describe('findPath', () => {
  it('ogni tratto del percorso resta su celle calpestabili', () => {
    const banca = village.places.find((p) => p.name === 'banca')!.approach!;
    const enoteca = village.places.find((p) => p.name === 'enoteca')!.approach!;
    const path = findPath(grid, banca, enoteca)!;
    let from = banca;
    for (const p of path) {
      expect(lineWalkable(grid, from, p)).toBe(true);
      from = p;
    }
  });

  it('il tap su un edificio porta alla cella calpestabile più vicina', () => {
    const roof = { x: 6 * 16, y: 4 * 16 }; // tetto della Banca
    expect(isWalkable(grid, roof)).toBe(false);
    const path = findPath(grid, village.spawn, roof)!;
    const end = path[path.length - 1];
    expect(isWalkable(grid, end)).toBe(true);
    expect(end).toEqual(nearestWalkable(grid, roof));
  });

  it('in linea d’aria libera il percorso è un solo segmento', () => {
    const a = village.spawn;
    const b = { x: a.x + 32, y: a.y + 16 };
    expect(findPath(grid, a, b)).toEqual([b]);
  });

  it('già arrivato: percorso vuoto', () => {
    expect(findPath(grid, village.spawn, village.spawn)).toEqual([]);
  });
});

describe('advance', () => {
  it('si muove a velocità costante lungo il percorso e si ferma all’arrivo', () => {
    const speed = gameConfig.world.walk_speed_px_s;
    const m: Mover = { x: 0, y: 0, facing: 'down', path: [{ x: 30, y: 0 }, { x: 30, y: 40 }] };
    expect(advance(m, speed / 10)).toBe(true);
    expect(m).toMatchObject({ x: speed / 10, y: 0, facing: 'right' });
    advance(m, 30 - speed / 10 + 10);
    expect(m.x).toBe(30);
    expect(m.y).toBeCloseTo(10, 9);
    expect(m.facing).toBe('down');
    expect(advance(m, 1000)).toBe(false);
    expect(m).toMatchObject({ x: 30, y: 40, path: [] });
  });
});
