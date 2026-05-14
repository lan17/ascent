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

export type PropKind =
  | "column"
  | "warning_column"
  | "server_rack"
  | "generator"
  | "coolant_tank"
  | "console"
  | "crate"
  | "barrel"
  | "pipes"
  | "tank";

export type Prop = {
  kind: PropKind;
  // World-space center position.
  pos: [number, number, number];
  // Half-extents on each axis (axis-aligned bounding box).
  half: [number, number, number];
  // Rotation about Y, radians (purely visual — collider stays AABB).
  rotY: number;
  // Cell coord this prop is anchored in.
  cell: [number, number, number];
  // Region kind of the host cell — drives material tint at render time.
  biome: "steel" | "tan" | "warning";
};

export type Level = {
  cells: Map<CellKey, Cell>;
  rooms: Room[];
  corridors: Corridor[];
  props: Prop[];
  propsByCell: Map<CellKey, Prop[]>;
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

// Per-prop static definitions. Half-extents are in world units (cells are CELL=24).
// floorRest=true → prop sits on the cell floor; otherwise it spans floor-to-ceiling
// (used for columns that read as structural pillars).
const PROP_DEFS: Record<PropKind, {
  half: [number, number, number];
  floorRest: boolean;
  pools: Array<"steel" | "tan" | "warning">;
  weight: number;
}> = {
  column:         { half: [1.3, HALF, 1.3],   floorRest: false, pools: ["steel", "tan"],              weight: 3 },
  warning_column: { half: [1.4, HALF, 1.4],   floorRest: false, pools: ["warning"],                   weight: 4 },
  server_rack:    { half: [1.6, 3.6, 1.0],    floorRest: true,  pools: ["steel", "tan"],              weight: 3 },
  generator:      { half: [2.0, 2.8, 2.0],    floorRest: true,  pools: ["steel", "tan", "warning"],   weight: 2 },
  coolant_tank:   { half: [1.8, 4.4, 1.8],    floorRest: true,  pools: ["warning"],                   weight: 4 },
  console:        { half: [2.2, 1.3, 1.1],    floorRest: true,  pools: ["steel", "tan"],              weight: 2 },
  crate:          { half: [1.4, 1.3, 1.4],    floorRest: true,  pools: ["steel", "tan"],              weight: 3 },
  barrel:         { half: [0.95, 1.5, 0.95],  floorRest: true,  pools: ["steel", "tan", "warning"],   weight: 2 },
  pipes:          { half: [2.5, 0.7, 1.0],    floorRest: true,  pools: ["steel", "tan", "warning"],   weight: 2 },
  tank:           { half: [1.7, 2.2, 1.7],    floorRest: true,  pools: ["steel", "tan"],              weight: 2 },
};

function biomeOf(kind: Cell["kind"]): "steel" | "tan" | "warning" {
  return kind === "reactor" ? "warning" : kind === "hub" ? "tan" : "steel";
}

// 8 wall/corner slots around a cell center (cell-local X/Z offsets), with the
// list of cell faces each slot "leans against." If any of those faces is a
// doorway (open to outside the room) the slot is skipped so the doorway stays
// clear. The cell center itself is always left walkable.
const SLOT_D = 7.2;
type Slot = { lx: number; lz: number; needs: Array<keyof Cell["open"]> };
const CELL_SLOTS: Slot[] = [
  { lx: -SLOT_D, lz: 0,        needs: ["nx"] },
  { lx:  SLOT_D, lz: 0,        needs: ["px"] },
  { lx: 0,       lz: -SLOT_D,  needs: ["nz"] },
  { lx: 0,       lz:  SLOT_D,  needs: ["pz"] },
  { lx: -SLOT_D, lz: -SLOT_D,  needs: ["nx", "nz"] },
  { lx: -SLOT_D, lz:  SLOT_D,  needs: ["nx", "pz"] },
  { lx:  SLOT_D, lz: -SLOT_D,  needs: ["px", "nz"] },
  { lx:  SLOT_D, lz:  SLOT_D,  needs: ["px", "pz"] },
];

function aabbOverlap(
  a: [number, number, number], ah: [number, number, number],
  b: [number, number, number], bh: [number, number, number],
  pad: number,
): boolean {
  return (
    Math.abs(a[0] - b[0]) < ah[0] + bh[0] + pad &&
    Math.abs(a[1] - b[1]) < ah[1] + bh[1] + pad &&
    Math.abs(a[2] - b[2]) < ah[2] + bh[2] + pad
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

  // ---- 1) Starting hub at origin — wider so the player can strafe/circle ----
  const startRoom = makeRoom("hub", -1, 0, -1, 3, 1, 3);
  carveRoom(startRoom);

  // ---- 2) Reactor chamber placed far away in a random direction ----
  // Larger arena (4x2x4) themed as a warning biome.
  let reactorRoom: Room | null = null;
  for (let t = 0; t < 160 && !reactorRoom; t++) {
    const dir = rand() * Math.PI * 2;
    const dist = 16 + Math.floor(rand() * 6); // 16..21
    const cx = Math.round(Math.cos(dir) * dist) - 1;
    const cz = Math.round(Math.sin(dir) * dist) - 1;
    const cy = Math.floor((rand() - 0.5) * 4); // -2..1
    const r = makeRoom("reactor", cx, cy, cz, 4, 2, 4);
    if (rooms.every((o) => !roomsOverlap(r, o, 3))) reactorRoom = r;
  }
  if (!reactorRoom) {
    reactorRoom = makeRoom("reactor", 16, 0, 16, 4, 2, 4);
  }
  carveRoom(reactorRoom);

  // ---- 3) Mid rooms — biased larger so they feel like small arenas ----
  const midX: [number, number] = [
    Math.min(startRoom.center[0], reactorRoom.center[0]) - 8,
    Math.max(startRoom.center[0], reactorRoom.center[0]) + 8,
  ];
  const midZ: [number, number] = [
    Math.min(startRoom.center[2], reactorRoom.center[2]) - 8,
    Math.max(startRoom.center[2], reactorRoom.center[2]) + 8,
  ];
  const midY: [number, number] = [-3, 3];
  // Heavier weight on bigger footprints. Shafts stay narrow for vertical variety.
  const presets: Array<{ kind: Room["kind"]; sx: number; sy: number; sz: number }> = [
    { kind: "hub",   sx: 3, sy: 1, sz: 3 },
    { kind: "hub",   sx: 3, sy: 1, sz: 3 },
    { kind: "hub",   sx: 4, sy: 1, sz: 2 },
    { kind: "hub",   sx: 2, sy: 1, sz: 4 },
    { kind: "hub",   sx: 3, sy: 2, sz: 2 },
    { kind: "hub",   sx: 2, sy: 2, sz: 3 },
    { kind: "hub",   sx: 3, sy: 1, sz: 2 },
    { kind: "shaft", sx: 1, sy: 3, sz: 1 },
    { kind: "shaft", sx: 1, sy: 4, sz: 1 },
  ];
  const midCount = 4 + Math.floor(rand() * 3); // 4..6
  for (let i = 0; i < midCount; i++) {
    const pre = presets[Math.floor(rand() * presets.length)]!;
    const room = tryPlaceRoom(pre.kind, pre.sx, pre.sy, pre.sz, midX, midY, midZ, 2, 80);
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

  // ---- 6) Place interior props inside rooms ----
  const props: Prop[] = [];
  const propsByCell = new Map<CellKey, Prop[]>();

  function pushProp(p: Prop) {
    props.push(p);
    const k = key(p.cell[0], p.cell[1], p.cell[2]);
    let arr = propsByCell.get(k);
    if (!arr) { arr = []; propsByCell.set(k, arr); }
    arr.push(p);
  }

  // Build a weighted catalog per biome once.
  const catalogByBiome: Record<"steel" | "tan" | "warning", PropKind[]> = {
    steel: [], tan: [], warning: [],
  };
  for (const kind of Object.keys(PROP_DEFS) as PropKind[]) {
    const def = PROP_DEFS[kind];
    for (const pool of def.pools) {
      for (let i = 0; i < def.weight; i++) catalogByBiome[pool].push(kind);
    }
  }

  for (const room of rooms) {
    if (room.kind === "shaft") continue; // narrow vertical shafts stay clear
    const biome = biomeOf(room.kind);
    const catalog = catalogByBiome[biome];

    for (let cx = room.min[0]; cx <= room.max[0]; cx++) {
      for (let cy = room.min[1]; cy <= room.max[1]; cy++) {
        for (let cz = room.min[2]; cz <= room.max[2]; cz++) {
          const cell = cells.get(key(cx, cy, cz));
          if (!cell) continue;

          // Doorway faces = open faces leading outside this room.
          const isDoorFace = (face: keyof Cell["open"]): boolean => {
            if (!cell.open[face]) return false;
            let nx = cx, ny = cy, nz = cz;
            if (face === "px") nx++; else if (face === "nx") nx--;
            else if (face === "py") ny++; else if (face === "ny") ny--;
            else if (face === "pz") nz++; else nz--;
            return !roomContains(room, nx, ny, nz);
          };

          // Choose a small number of props per cell with some bias by room kind.
          const baseCount = room.kind === "reactor" ? 2 : 1;
          const extra = rand() < 0.7 ? 1 : 0;
          const count = baseCount + extra;

          // Shuffle the slot indices deterministically via the seeded RNG.
          const slotOrder = [0, 1, 2, 3, 4, 5, 6, 7];
          for (let i = slotOrder.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = slotOrder[i]!; slotOrder[i] = slotOrder[j]!; slotOrder[j] = tmp;
          }

          const placedHere: Prop[] = [];
          let placed = 0;
          for (const idx of slotOrder) {
            if (placed >= count) break;
            const slot = CELL_SLOTS[idx]!;
            if (slot.needs.some((f) => isDoorFace(f))) continue;

            const kind = catalog[Math.floor(rand() * catalog.length)]!;
            const def = PROP_DEFS[kind];
            const half: [number, number, number] = [def.half[0], def.half[1], def.half[2]];
            const rotY = Math.floor(rand() * 4) * (Math.PI / 2);

            // World-space center of the slot.
            const wx = cx * CELL + slot.lx;
            const wz = cz * CELL + slot.lz;
            // Floor-rest props sit on cell floor with a small lift; columns center.
            const wy = def.floorRest
              ? cy * CELL - HALF + half[1] + 0.05
              : cy * CELL;

            // Make sure the prop fits inside the cell footprint with margin.
            const maxX = cx * CELL + HALF - half[0] - 0.4;
            const minX = cx * CELL - HALF + half[0] + 0.4;
            const maxZ = cz * CELL + HALF - half[2] - 0.4;
            const minZ = cz * CELL - HALF + half[2] + 0.4;
            const cwx = Math.max(minX, Math.min(maxX, wx));
            const cwz = Math.max(minZ, Math.min(maxZ, wz));

            const pos: [number, number, number] = [cwx, wy, cwz];

            // Avoid overlapping a prop already placed in this cell.
            let overlaps = false;
            for (const other of placedHere) {
              if (aabbOverlap(pos, half, other.pos, other.half, 0.4)) { overlaps = true; break; }
            }
            if (overlaps) continue;

            // Keep the cell center clear so enemies + ship can still path through.
            const dCx = cwx - cx * CELL;
            const dCz = cwz - cz * CELL;
            if (dCx * dCx + dCz * dCz < 4 * 4) continue;

            const propRec: Prop = { kind, pos, half, rotY, cell: [cx, cy, cz], biome };
            placedHere.push(propRec);
            pushProp(propRec);
            placed++;
          }
        }
      }
    }
  }

  // ---- 7) Reactor world position ----
  const rc = reactorRoom.center;
  const reactor = new THREE.Vector3(rc[0] * CELL, rc[1] * CELL, rc[2] * CELL);

  // ---- 8) Enemy spawns: spread through corridor + hub cells, never start, never reactor chamber.
  // Filter out any candidate whose cell center is occupied by a prop. ----
  const enemySpawns: THREE.Vector3[] = [];
  // Exclude the entire starting hub so the player has a safe "ready room"
  // before any combat. Use the explicit startRoom reference (not a lookup) so
  // an overlapping non-hub room can't accidentally shrink the exclusion zone.
  // Also add a small buffer in cell-space around the hub so robots can't stand
  // just outside a doorway and shoot the player on spawn.
  const SPAWN_BUFFER_XZ = 2;
  const SPAWN_BUFFER_Y = 1;
  for (const c of cells.values()) {
    if (roomContains(startRoom, c.x, c.y, c.z)) continue;
    const dx = Math.max(startRoom.min[0] - c.x, 0, c.x - startRoom.max[0]);
    const dy = Math.max(startRoom.min[1] - c.y, 0, c.y - startRoom.max[1]);
    const dz = Math.max(startRoom.min[2] - c.z, 0, c.z - startRoom.max[2]);
    if (dx <= SPAWN_BUFFER_XZ && dz <= SPAWN_BUFFER_XZ && dy <= SPAWN_BUFFER_Y) continue;
    if (c.kind === "reactor") continue;
    if (((c.x * 73 + c.y * 31 + c.z * 17) & 7) >= 3) continue;
    const wx = c.x * CELL, wy = c.y * CELL, wz = c.z * CELL;
    const cellProps = propsByCell.get(key(c.x, c.y, c.z));
    let blocked = false;
    if (cellProps) {
      for (const p of cellProps) {
        const qx = Math.max(p.pos[0] - p.half[0], Math.min(p.pos[0] + p.half[0], wx));
        const qy = Math.max(p.pos[1] - p.half[1], Math.min(p.pos[1] + p.half[1], wy));
        const qz = Math.max(p.pos[2] - p.half[2], Math.min(p.pos[2] + p.half[2], wz));
        const dx = wx - qx, dy = wy - qy, dz = wz - qz;
        if (dx * dx + dy * dy + dz * dz < 2.6 * 2.6) { blocked = true; break; }
      }
    }
    if (blocked) continue;
    enemySpawns.push(new THREE.Vector3(wx, wy, wz));
  }

  return {
    cells,
    rooms,
    corridors,
    props,
    propsByCell,
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

// Resolve a sphere-vs-prop-AABB push for the ship. Tests props in the current
// cell + immediate neighbors only (cheap). Returns the largest single-axis push
// applied so the caller can zero velocity on that axis.
// pos is mutated in place.
const _propPush = new THREE.Vector3();
export function resolveShipProps(
  level: Level, pos: THREE.Vector3, radius: number,
): { x: number; y: number; z: number } {
  const cx = Math.round(pos.x / CELL);
  const cy = Math.round(pos.y / CELL);
  const cz = Math.round(pos.z / CELL);
  let pushX = 0, pushY = 0, pushZ = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = level.propsByCell.get(key(cx + dx, cy + dy, cz + dz));
        if (!arr) continue;
        for (const p of arr) {
          const minX = p.pos[0] - p.half[0], maxX = p.pos[0] + p.half[0];
          const minY = p.pos[1] - p.half[1], maxY = p.pos[1] + p.half[1];
          const minZ = p.pos[2] - p.half[2], maxZ = p.pos[2] + p.half[2];
          const qx = Math.max(minX, Math.min(maxX, pos.x));
          const qy = Math.max(minY, Math.min(maxY, pos.y));
          const qz = Math.max(minZ, Math.min(maxZ, pos.z));
          const ddx = pos.x - qx, ddy = pos.y - qy, ddz = pos.z - qz;
          const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
          if (distSq >= radius * radius) continue;
          if (distSq < 1e-6) {
            // Ship is inside the prop's AABB — push along the shallowest axis.
            const overX = Math.min(pos.x - minX, maxX - pos.x);
            const overY = Math.min(pos.y - minY, maxY - pos.y);
            const overZ = Math.min(pos.z - minZ, maxZ - pos.z);
            if (overX <= overY && overX <= overZ) {
              const dir = pos.x > p.pos[0] ? 1 : -1;
              const push = overX + radius + 0.01;
              pos.x += dir * push;
              pushX = Math.max(pushX, push);
            } else if (overY <= overZ) {
              const dir = pos.y > p.pos[1] ? 1 : -1;
              const push = overY + radius + 0.01;
              pos.y += dir * push;
              pushY = Math.max(pushY, push);
            } else {
              const dir = pos.z > p.pos[2] ? 1 : -1;
              const push = overZ + radius + 0.01;
              pos.z += dir * push;
              pushZ = Math.max(pushZ, push);
            }
            continue;
          }
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          _propPush.set(ddx / dist, ddy / dist, ddz / dist).multiplyScalar(push);
          pos.x += _propPush.x;
          pos.y += _propPush.y;
          pos.z += _propPush.z;
          if (Math.abs(_propPush.x) > pushX) pushX = Math.abs(_propPush.x);
          if (Math.abs(_propPush.y) > pushY) pushY = Math.abs(_propPush.y);
          if (Math.abs(_propPush.z) > pushZ) pushZ = Math.abs(_propPush.z);
        }
      }
    }
  }
  return { x: pushX, y: pushY, z: pushZ };
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
