import * as THREE from "three";

export const CELL = 24;
export const HALF = CELL / 2;

export type CellKey = string;
export type Cell = {
  x: number;
  y: number;
  z: number;
  open: { px: boolean; nx: boolean; py: boolean; ny: boolean; pz: boolean; nz: boolean };
};

export type Level = {
  cells: Map<CellKey, Cell>;
  start: THREE.Vector3;
  enemySpawns: THREE.Vector3[];
  reactor: THREE.Vector3;
};

export function key(x: number, y: number, z: number): CellKey {
  return `${x},${y},${z}`;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const DIRS: Array<[number, number, number, keyof Cell["open"], keyof Cell["open"]]> = [
  [1, 0, 0, "px", "nx"],
  [-1, 0, 0, "nx", "px"],
  [0, 1, 0, "py", "ny"],
  [0, -1, 0, "ny", "py"],
  [0, 0, 1, "pz", "nz"],
  [0, 0, -1, "nz", "pz"],
];

export function generateLevel(seed = 1): Level {
  const rand = rng(seed);
  const cells = new Map<CellKey, Cell>();

  function add(x: number, y: number, z: number): Cell {
    const k = key(x, y, z);
    let c = cells.get(k);
    if (!c) {
      c = { x, y, z, open: { px: false, nx: false, py: false, ny: false, pz: false, nz: false } };
      cells.set(k, c);
    }
    return c;
  }

  // Random walk to carve a connected mine
  let cx = 0, cy = 0, cz = 0;
  add(cx, cy, cz);
  const targetCells = 36;
  let safety = 0;
  while (cells.size < targetCells && safety++ < 2000) {
    const dirIdx = Math.floor(rand() * DIRS.length);
    const [dx, dy, dz, oa, ob] = DIRS[dirIdx]!;
    // Bias against extreme vertical drift
    if ((dy === 1 && cy > 1) || (dy === -1 && cy < -1)) continue;
    const a = add(cx, cy, cz);
    const b = add(cx + dx, cy + dy, cz + dz);
    a.open[oa] = true;
    b.open[ob] = true;
    cx += dx; cy += dy; cz += dz;
  }

  // Add a few extra interconnections for loops
  const cellList = Array.from(cells.values());
  for (let i = 0; i < 6; i++) {
    const c = cellList[Math.floor(rand() * cellList.length)]!;
    const [dx, dy, dz, oa, ob] = DIRS[Math.floor(rand() * DIRS.length)]!;
    const nk = key(c.x + dx, c.y + dy, c.z + dz);
    const n = cells.get(nk);
    if (n) {
      c.open[oa] = true;
      n.open[ob] = true;
    }
  }

  // Pick farthest cell from start as reactor
  let farthest = cellList[0]!;
  let maxD = 0;
  for (const c of cellList) {
    const d = c.x * c.x + c.y * c.y + c.z * c.z;
    if (d > maxD) { maxD = d; farthest = c; }
  }

  // Enemy spawns: every 3rd cell (not start, not reactor)
  const enemySpawns: THREE.Vector3[] = [];
  for (let i = 0; i < cellList.length; i++) {
    const c = cellList[i]!;
    if (c.x === 0 && c.y === 0 && c.z === 0) continue;
    if (c === farthest) continue;
    if (i % 2 === 0) {
      enemySpawns.push(new THREE.Vector3(c.x * CELL, c.y * CELL, c.z * CELL));
    }
  }

  return {
    cells,
    start: new THREE.Vector3(0, 0, 0),
    enemySpawns,
    reactor: new THREE.Vector3(farthest.x * CELL, farthest.y * CELL, farthest.z * CELL),
  };
}

// Collision: clamp position inside the level. Returns adjusted position.
const PAD = 1.2;
export function clampToLevel(level: Level, pos: THREE.Vector3, prev: THREE.Vector3): THREE.Vector3 {
  const cx = Math.round(pos.x / CELL);
  const cy = Math.round(pos.y / CELL);
  const cz = Math.round(pos.z / CELL);
  const cell = level.cells.get(key(cx, cy, cz));
  if (!cell) {
    // outside any cell: snap back to prev
    return prev.clone();
  }
  const localX = pos.x - cx * CELL;
  const localY = pos.y - cy * CELL;
  const localZ = pos.z - cz * CELL;
  const out = pos.clone();
  if (localX > HALF - PAD && !cell.open.px) out.x = cx * CELL + HALF - PAD;
  if (localX < -HALF + PAD && !cell.open.nx) out.x = cx * CELL - HALF + PAD;
  if (localY > HALF - PAD && !cell.open.py) out.y = cy * CELL + HALF - PAD;
  if (localY < -HALF + PAD && !cell.open.ny) out.y = cy * CELL - HALF + PAD;
  if (localZ > HALF - PAD && !cell.open.pz) out.z = cz * CELL + HALF - PAD;
  if (localZ < -HALF + PAD && !cell.open.nz) out.z = cz * CELL - HALF + PAD;
  return out;
}

export function pointInLevel(level: Level, pos: THREE.Vector3): boolean {
  const cx = Math.round(pos.x / CELL);
  const cy = Math.round(pos.y / CELL);
  const cz = Math.round(pos.z / CELL);
  const cell = level.cells.get(key(cx, cy, cz));
  if (!cell) return false;
  const localX = pos.x - cx * CELL;
  const localY = pos.y - cy * CELL;
  const localZ = pos.z - cz * CELL;
  if (localX > HALF && !cell.open.px) return false;
  if (localX < -HALF && !cell.open.nx) return false;
  if (localY > HALF && !cell.open.py) return false;
  if (localY < -HALF && !cell.open.ny) return false;
  if (localZ > HALF && !cell.open.pz) return false;
  if (localZ < -HALF && !cell.open.nz) return false;
  return true;
}
