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

export type Room = {
  kind: "hub" | "reactor" | "shaft";
  // Inclusive cell-coord AABB.
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
};

export type Corridor = {
  // Ordered cell coords from one room boundary to another.
  path: Array<[number, number, number]>;
};

export type Level = {
  cells: Map<CellKey, Cell>;
  rooms: Room[];
  corridors: Corridor[];
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

function makeRoom(
  kind: Room["kind"],
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
): Room {
  return {
    kind,
    min: [x, y, z],
    max: [x + sx - 1, y + sy - 1, z + sz - 1],
    center: [x + Math.floor(sx / 2), y + Math.floor(sy / 2), z + Math.floor(sz / 2)],
  };
}

function roomContains(r: Room, x: number, y: number, z: number): boolean {
  return (
    x >= r.min[0] && x <= r.max[0] &&
    y >= r.min[1] && y <= r.max[1] &&
    z >= r.min[2] && z <= r.max[2]
  );
}

function roomsOverlap(a: Room, b: Room, pad: number): boolean {
  return (
    a.min[0] - pad <= b.max[0] && a.max[0] + pad >= b.min[0] &&
    a.min[1] - pad <= b.max[1] && a.max[1] + pad >= b.min[1] &&
    a.min[2] - pad <= b.max[2] && a.max[2] + pad >= b.min[2]
  );
}

export function generateLevel(seed = 1): Level {
  const rand = rng(seed);
  const cells = new Map<CellKey, Cell>();
  const rooms: Room[] = [];
  const corridors: Corridor[] = [];

  function add(x: number, y: number, z: number, kind: Cell["kind"] = "corridor"): Cell {
    const k = key(x, y, z);
    let c = cells.get(k);
    if (!c) {
      c = { x, y, z, open: { px: false, nx: false, py: false, ny: false, pz: false, nz: false }, kind };
      cells.set(k, c);
    } else if (kind !== "corridor" && c.kind === "corridor") {
      // Upgrade corridor cells in-place if a room claims them later.
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

  function carveRoom(r: Room) {
    rooms.push(r);
    for (let x = r.min[0]; x <= r.max[0]; x++) {
      for (let y = r.min[1]; y <= r.max[1]; y++) {
        for (let z = r.min[2]; z <= r.max[2]; z++) {
          add(x, y, z, r.kind);
        }
      }
    }
    for (let x = r.min[0]; x <= r.max[0]; x++) {
      for (let y = r.min[1]; y <= r.max[1]; y++) {
        for (let z = r.min[2]; z <= r.max[2]; z++) {
          if (x < r.max[0]) connect(x, y, z, x + 1, y, z);
          if (y < r.max[1]) connect(x, y, z, x, y + 1, z);
          if (z < r.max[2]) connect(x, y, z, x, y, z + 1);
        }
      }
    }
  }

  function tryPlaceRoom(
    kind: Room["kind"],
    sx: number, sy: number, sz: number,
    rx: [number, number], ry: [number, number], rz: [number, number],
    pad: number,
    attempts: number,
  ): Room | null {
    for (let t = 0; t < attempts; t++) {
      const spanX = Math.max(1, rx[1] - rx[0] - sx + 1);
      const spanY = Math.max(1, ry[1] - ry[0] - sy + 1);
      const spanZ = Math.max(1, rz[1] - rz[0] - sz + 1);
      const x = rx[0] + Math.floor(rand() * spanX);
      const y = ry[0] + Math.floor(rand() * spanY);
      const z = rz[0] + Math.floor(rand() * spanZ);
      const r = makeRoom(kind, x, y, z, sx, sy, sz);
      if (rooms.every((o) => !roomsOverlap(r, o, pad))) return r;
    }
    return null;
  }

  // ---- 1) Starting hub at origin (always reproducible spawn) ----
  const startRoom = makeRoom("hub", -1, 0, -1, 2, 1, 2);
  carveRoom(startRoom);

  // ---- 2) Reactor chamber placed far away in a random direction ----
  let reactorRoom: Room | null = null;
  for (let t = 0; t < 120 && !reactorRoom; t++) {
    const dir = rand() * Math.PI * 2;
    const dist = 14 + Math.floor(rand() * 6); // 14..19
    const cx = Math.round(Math.cos(dir) * dist) - 1;
    const cz = Math.round(Math.sin(dir) * dist) - 1;
    const cy = Math.floor((rand() - 0.5) * 4); // -2..1
    const r = makeRoom("reactor", cx, cy, cz, 3, 2, 3);
    if (rooms.every((o) => !roomsOverlap(r, o, 3))) reactorRoom = r;
  }
  if (!reactorRoom) {
    reactorRoom = makeRoom("reactor", 14, 0, 14, 3, 2, 3);
  }
  carveRoom(reactorRoom);

  // ---- 3) Mid rooms — varied sizes, in the corridor region between start and reactor ----
  const midX: [number, number] = [
    Math.min(startRoom.center[0], reactorRoom.center[0]) - 6,
    Math.max(startRoom.center[0], reactorRoom.center[0]) + 6,
  ];
  const midZ: [number, number] = [
    Math.min(startRoom.center[2], reactorRoom.center[2]) - 6,
    Math.max(startRoom.center[2], reactorRoom.center[2]) + 6,
  ];
  const midY: [number, number] = [-3, 3];
  const presets: Array<{ kind: Room["kind"]; sx: number; sy: number; sz: number }> = [
    { kind: "hub",   sx: 2, sy: 1, sz: 2 },
    { kind: "hub",   sx: 1, sy: 2, sz: 2 },
    { kind: "hub",   sx: 2, sy: 2, sz: 1 },
    { kind: "shaft", sx: 1, sy: 3, sz: 1 },
    { kind: "shaft", sx: 1, sy: 4, sz: 1 },
    { kind: "hub",   sx: 3, sy: 1, sz: 1 },
    { kind: "hub",   sx: 1, sy: 1, sz: 3 },
  ];
  const midCount = 4 + Math.floor(rand() * 3); // 4..6
  for (let i = 0; i < midCount; i++) {
    const pre = presets[Math.floor(rand() * presets.length)]!;
    const room = tryPlaceRoom(pre.kind, pre.sx, pre.sy, pre.sz, midX, midY, midZ, 2, 60);
    if (room) carveRoom(room);
  }

  // ---- 4) Build a connectivity graph: MST + a couple of extra short edges for loops ----
  type Edge = { i: number; j: number; d: number };
  const allEdges: Edge[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!.center;
      const b = rooms[j]!.center;
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      allEdges.push({ i, j, d: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }
  }
  allEdges.sort((a, b) => a.d - b.d);

  const parent = rooms.map((_, i) => i);
  function find(i: number): number {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    let cur = i;
    while (parent[cur] !== r) {
      const nxt = parent[cur]!;
      parent[cur] = r;
      cur = nxt;
    }
    return r;
  }
  const usedEdges: Edge[] = [];
  const usedKey = new Set<string>();
  function eKey(e: Edge) { return `${e.i}-${e.j}`; }
  for (const e of allEdges) {
    const ri = find(e.i), rj = find(e.j);
    if (ri !== rj) {
      parent[ri] = rj;
      usedEdges.push(e);
      usedKey.add(eKey(e));
    }
  }
  // Loop edges: 1..2 of the next-shortest unused edges.
  const loopCount = 1 + Math.floor(rand() * 2);
  let added = 0;
  for (const e of allEdges) {
    if (added >= loopCount) break;
    if (usedKey.has(eKey(e))) continue;
    usedEdges.push(e);
    usedKey.add(eKey(e));
    added++;
  }

  // ---- 5) Carve corridors for each edge, routing around other rooms when possible ----
  function closestBoundaryCell(r: Room, target: [number, number, number]): [number, number, number] {
    return [
      Math.max(r.min[0], Math.min(r.max[0], target[0])),
      Math.max(r.min[1], Math.min(r.max[1], target[1])),
      Math.max(r.min[2], Math.min(r.max[2], target[2])),
    ];
  }
  function routePath(
    start: [number, number, number],
    end: [number, number, number],
    order: Array<"x" | "y" | "z">,
  ): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [[start[0], start[1], start[2]]];
    let cx = start[0], cy = start[1], cz = start[2];
    for (const ax of order) {
      const target = ax === "x" ? end[0] : ax === "y" ? end[1] : end[2];
      while ((ax === "x" ? cx : ax === "y" ? cy : cz) !== target) {
        const cur = ax === "x" ? cx : ax === "y" ? cy : cz;
        const step = target > cur ? 1 : -1;
        if (ax === "x") cx += step;
        else if (ax === "y") cy += step;
        else cz += step;
        out.push([cx, cy, cz]);
      }
    }
    return out;
  }
  function countClips(
    path: Array<[number, number, number]>,
    a: Room, b: Room,
  ): number {
    let n = 0;
    for (const p of path) {
      for (const r of rooms) {
        if (r === a || r === b) continue;
        if (roomContains(r, p[0], p[1], p[2])) { n++; break; }
      }
    }
    return n;
  }
  const orderings: Array<["x" | "y" | "z", "x" | "y" | "z", "x" | "y" | "z"]> = [
    ["x", "y", "z"], ["x", "z", "y"], ["y", "x", "z"],
    ["y", "z", "x"], ["z", "x", "y"], ["z", "y", "x"],
  ];
  function carveCorridor(a: Room, b: Room) {
    const sCell = closestBoundaryCell(a, b.center);
    const eCell = closestBoundaryCell(b, a.center);
    let best: { path: Array<[number, number, number]>; clips: number } | null = null;
    for (const order of orderings) {
      const p = routePath(sCell, eCell, order);
      const clips = countClips(p, a, b);
      if (!best || clips < best.clips) best = { path: p, clips };
      if (clips === 0) break;
    }
    if (!best) return;
    const path = best.path;
    let prev: [number, number, number] | null = null;
    for (const c of path) {
      const [x, y, z] = c;
      const insideSelf = roomContains(a, x, y, z) || roomContains(b, x, y, z);
      if (!insideSelf) add(x, y, z, "corridor");
      if (prev) connect(prev[0], prev[1], prev[2], x, y, z);
      prev = c;
    }
    corridors.push({ path });
  }

  for (const e of usedEdges) carveCorridor(rooms[e.i]!, rooms[e.j]!);

  // ---- 6) Reactor world position ----
  const rc = reactorRoom.center;
  const reactor = new THREE.Vector3(rc[0] * CELL, rc[1] * CELL, rc[2] * CELL);

  // ---- 7) Enemy spawns: spread through corridor + hub cells, never start, never reactor chamber ----
  const enemySpawns: THREE.Vector3[] = [];
  for (const c of cells.values()) {
    if (c.x === 0 && c.y === 0 && c.z === 0) continue;
    if (c.kind === "reactor") continue;
    if (((c.x * 73 + c.y * 31 + c.z * 17) & 7) < 3) {
      enemySpawns.push(new THREE.Vector3(c.x * CELL, c.y * CELL, c.z * CELL));
    }
  }

  return {
    cells,
    rooms,
    corridors,
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

export function neighborCells(
  level: Level,
  x: number, y: number, z: number,
): Array<[number, number, number]> {
  const c = level.cells.get(key(x, y, z));
  if (!c) return [];
  const out: Array<[number, number, number]> = [];
  if (c.open.px) out.push([x + 1, y, z]);
  if (c.open.nx) out.push([x - 1, y, z]);
  if (c.open.py) out.push([x, y + 1, z]);
  if (c.open.ny) out.push([x, y - 1, z]);
  if (c.open.pz) out.push([x, y, z + 1]);
  if (c.open.nz) out.push([x, y, z - 1]);
  return out;
}

// Axis-aligned line-of-sight between two cells: cells must agree on at least
// two axes. Walks the open faces between them. Returns cell-distance on
// success, or -1 if the path is blocked / not axis-aligned.
export function losAxisAligned(
  level: Level,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  maxSteps = 16,
): number {
  const sameX = ax === bx, sameY = ay === by, sameZ = az === bz;
  if (sameX && sameY && sameZ) return 0;
  const diffs = (sameX ? 0 : 1) + (sameY ? 0 : 1) + (sameZ ? 0 : 1);
  if (diffs !== 1) return -1;
  let dx = 0, dy = 0, dz = 0;
  let oa: keyof Cell["open"], ob: keyof Cell["open"];
  if (!sameX) {
    dx = bx > ax ? 1 : -1;
    oa = dx > 0 ? "px" : "nx";
    ob = dx > 0 ? "nx" : "px";
  } else if (!sameY) {
    dy = by > ay ? 1 : -1;
    oa = dy > 0 ? "py" : "ny";
    ob = dy > 0 ? "ny" : "py";
  } else {
    dz = bz > az ? 1 : -1;
    oa = dz > 0 ? "pz" : "nz";
    ob = dz > 0 ? "nz" : "pz";
  }
  let cx = ax, cy = ay, cz = az;
  let steps = 0;
  while (cx !== bx || cy !== by || cz !== bz) {
    const c = level.cells.get(key(cx, cy, cz));
    if (!c || !c.open[oa]) return -1;
    cx += dx; cy += dy; cz += dz;
    const n = level.cells.get(key(cx, cy, cz));
    if (!n || !n.open[ob]) return -1;
    steps++;
    if (steps > maxSteps) return -1;
  }
  return steps;
}

// BFS through open faces. Returns the first cell to step into on the shortest
// path from `from` to `to`, or null if `to` is not reachable within maxDepth.
export function bfsNextStep(
  level: Level,
  fromX: number, fromY: number, fromZ: number,
  toX: number, toY: number, toZ: number,
  maxDepth = 8,
): [number, number, number] | null {
  if (fromX === toX && fromY === toY && fromZ === toZ) return null;
  const startK = key(fromX, fromY, fromZ);
  const parents = new Map<CellKey, CellKey | null>();
  parents.set(startK, null);
  let frontier: Array<[number, number, number]> = [[fromX, fromY, fromZ]];
  let foundK: CellKey | null = null;
  let depth = 0;
  let visitedCount = 1;
  while (frontier.length && depth < maxDepth && !foundK && visitedCount < 256) {
    const next: Array<[number, number, number]> = [];
    for (const p of frontier) {
      const cell = level.cells.get(key(p[0], p[1], p[2]));
      if (!cell) continue;
      const px = p[0], py = p[1], pz = p[2];
      const cur = key(px, py, pz);
      const tryStep = (nx: number, ny: number, nz: number) => {
        const nk = key(nx, ny, nz);
        if (parents.has(nk)) return false;
        parents.set(nk, cur);
        visitedCount++;
        if (nx === toX && ny === toY && nz === toZ) { foundK = nk; return true; }
        next.push([nx, ny, nz]);
        return false;
      };
      if (cell.open.px && tryStep(px + 1, py, pz)) break;
      if (cell.open.nx && tryStep(px - 1, py, pz)) break;
      if (cell.open.py && tryStep(px, py + 1, pz)) break;
      if (cell.open.ny && tryStep(px, py - 1, pz)) break;
      if (cell.open.pz && tryStep(px, py, pz + 1)) break;
      if (cell.open.nz && tryStep(px, py, pz - 1)) break;
    }
    frontier = next;
    depth++;
  }
  if (!foundK) return null;
  let curK: CellKey = foundK;
  let parentK = parents.get(curK) ?? null;
  while (parentK && parentK !== startK) {
    curK = parentK;
    parentK = parents.get(curK) ?? null;
  }
  const parts = curK.split(",");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
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
