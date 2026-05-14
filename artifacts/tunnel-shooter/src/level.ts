import * as THREE from "three";

export const CELL = 24;
export const HALF = CELL / 2;

export type CellKey = string;
export type Cell = {
  x: number;
  y: number;
  z: number;
  open: { px: boolean; nx: boolean; py: boolean; ny: boolean; pz: boolean; nz: boolean };
  // Biome / region kind drives texture variant and accent color.
  kind: "corridor" | "hub" | "reactor" | "shaft";
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

type Box = { x: number; y: number; z: number; sx: number; sy: number; sz: number; kind: Cell["kind"] };

export function generateLevel(seed = 1): Level {
  const rand = rng(seed);
  const cells = new Map<CellKey, Cell>();

  function add(x: number, y: number, z: number, kind: Cell["kind"] = "corridor"): Cell {
    const k = key(x, y, z);
    let c = cells.get(k);
    if (!c) {
      c = { x, y, z, open: { px: false, nx: false, py: false, ny: false, pz: false, nz: false }, kind };
      cells.set(k, c);
    } else if (kind !== "corridor") {
      c.kind = kind;
    }
    return c;
  }
  function connect(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const a = cells.get(key(ax, ay, az));
    const b = cells.get(key(bx, by, bz));
    if (!a || !b) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    for (const [dirX, dirY, dirZ, oa, ob] of DIRS) {
      if (dirX === dx && dirY === dy && dirZ === dz) {
        a.open[oa] = true;
        b.open[ob] = true;
        return;
      }
    }
  }

  // 1) Place rooms: a starting hub, the reactor chamber, and a few mid hubs / shafts.
  const rooms: Box[] = [];
  // Starting hub at origin (2x1x2)
  rooms.push({ x: -1, y: 0, z: -1, sx: 2, sy: 1, sz: 2, kind: "hub" });

  // 3-5 intermediate hubs scattered in a region
  const hubCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < hubCount; i++) {
    const sx = 1 + Math.floor(rand() * 2); // 1..2
    const sy = rand() < 0.4 ? 2 : 1;
    const sz = 1 + Math.floor(rand() * 2);
    const x = Math.floor((rand() - 0.5) * 12);
    const y = Math.floor((rand() - 0.5) * 4);
    const z = Math.floor((rand() - 0.5) * 12);
    rooms.push({ x, y, z, sx, sy, sz, kind: rand() < 0.4 ? "shaft" : "hub" });
  }

  // Reactor chamber: 3x2x3, placed far from origin
  const rdir = rand() * Math.PI * 2;
  const rdist = 8 + Math.floor(rand() * 4);
  const rx = Math.round(Math.cos(rdir) * rdist) - 1;
  const rz = Math.round(Math.sin(rdir) * rdist) - 1;
  const ry = Math.floor((rand() - 0.5) * 4);
  rooms.push({ x: rx, y: ry, z: rz, sx: 3, sy: 2, sz: 3, kind: "reactor" });

  // 2) Carve each room: all cells in box exist, internal faces are open.
  for (const r of rooms) {
    for (let ix = 0; ix < r.sx; ix++) {
      for (let iy = 0; iy < r.sy; iy++) {
        for (let iz = 0; iz < r.sz; iz++) {
          add(r.x + ix, r.y + iy, r.z + iz, r.kind);
        }
      }
    }
    // open internal connections
    for (let ix = 0; ix < r.sx; ix++) {
      for (let iy = 0; iy < r.sy; iy++) {
        for (let iz = 0; iz < r.sz; iz++) {
          if (ix + 1 < r.sx) connect(r.x + ix, r.y + iy, r.z + iz, r.x + ix + 1, r.y + iy, r.z + iz);
          if (iy + 1 < r.sy) connect(r.x + ix, r.y + iy, r.z + iz, r.x + ix, r.y + iy + 1, r.z + iz);
          if (iz + 1 < r.sz) connect(r.x + ix, r.y + iy, r.z + iz, r.x + ix, r.y + iy, r.z + iz + 1);
        }
      }
    }
  }

  // 3) Connect rooms with L-shaped corridors of single cells.
  function roomCenter(r: Box): [number, number, number] {
    return [r.x + Math.floor(r.sx / 2), r.y + Math.floor(r.sy / 2), r.z + Math.floor(r.sz / 2)];
  }
  function carveCorridor(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    // greedy axis-by-axis: x then y then z, in random order
    const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
    for (let i = axes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [axes[i], axes[j]] = [axes[j]!, axes[i]!];
    }
    let cx = ax, cy = ay, cz = az;
    for (const ax2 of axes) {
      const target = ax2 === "x" ? bx : ax2 === "y" ? by : bz;
      const cur = ax2 === "x" ? cx : ax2 === "y" ? cy : cz;
      const step = target > cur ? 1 : target < cur ? -1 : 0;
      let safety = 0;
      while ((ax2 === "x" ? cx : ax2 === "y" ? cy : cz) !== target && safety++ < 50) {
        const nx = cx + (ax2 === "x" ? step : 0);
        const ny = cy + (ax2 === "y" ? step : 0);
        const nz = cz + (ax2 === "z" ? step : 0);
        add(nx, ny, nz, "corridor");
        // Ensure both endpoints exist before connecting
        if (cells.get(key(cx, cy, cz))) connect(cx, cy, cz, nx, ny, nz);
        cx = nx; cy = ny; cz = nz;
      }
    }
  }
  // Connect each room to the next in order, plus a couple of extra cross-links.
  for (let i = 0; i < rooms.length - 1; i++) {
    const [ax, ay, az] = roomCenter(rooms[i]!);
    const [bx, by, bz] = roomCenter(rooms[i + 1]!);
    carveCorridor(ax, ay, az, bx, by, bz);
  }
  for (let i = 0; i < 3; i++) {
    const a = rooms[Math.floor(rand() * rooms.length)]!;
    const b = rooms[Math.floor(rand() * rooms.length)]!;
    if (a === b) continue;
    const [ax, ay, az] = roomCenter(a);
    const [bx, by, bz] = roomCenter(b);
    carveCorridor(ax, ay, az, bx, by, bz);
  }

  // 4) Pick reactor location: center of the explicitly-marked reactor chamber.
  const reactorRoom = rooms[rooms.length - 1]!;
  const [rcx, rcy, rcz] = roomCenter(reactorRoom);
  const reactor = new THREE.Vector3(rcx * CELL, rcy * CELL, rcz * CELL);

  // 5) Enemy spawns: spread through corridors and hubs (not start, not reactor cell).
  const enemySpawns: THREE.Vector3[] = [];
  const cellList = Array.from(cells.values());
  for (let i = 0; i < cellList.length; i++) {
    const c = cellList[i]!;
    if (c.x === 0 && c.y === 0 && c.z === 0) continue;
    if (c.x === rcx && c.y === rcy && c.z === rcz) continue;
    if (c.kind === "reactor") continue;
    // ~40% density, varied
    if (((c.x * 73 + c.y * 31 + c.z * 17) & 7) < 3) {
      enemySpawns.push(new THREE.Vector3(c.x * CELL, c.y * CELL, c.z * CELL));
    }
  }

  return {
    cells,
    start: new THREE.Vector3(0, 0, 0),
    enemySpawns,
    reactor,
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
