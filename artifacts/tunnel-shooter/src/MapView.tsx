import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CELL, HALF, type Level, type PickupKind, type Room } from "./level";
import type { Robot } from "./gameStore";
import type { PickupRuntime } from "./LevelMesh";

type Props = {
  level: Level;
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  robots: Robot[];
  pickups: PickupRuntime[];
  onClose: () => void;
};

// Match the in-world emissive colors used by Pickups so the map dots read
// as the same item type players see in the cockpit.
const PICKUP_DOT_COLOR: Record<PickupKind, string> = {
  shield_cell: "#33aaff",
  ammo_core: "#ff8a22",
  score_chip: "#33ff88",
};
const PICKUP_LABEL: Record<PickupKind, string> = {
  shield_cell: "Shield cell",
  ammo_core: "Ammo core",
  score_chip: "Score chip",
};

const KIND_COLOR: Record<Room["kind"], string> = {
  hub: "#ff8a3a",
  shaft: "#7a55ff",
  reactor: "#ff3344",
};
const KIND_LABEL: Record<Room["kind"], string> = {
  hub: "HUB",
  shaft: "SHAFT",
  reactor: "REACTOR",
};
const CORRIDOR_COLOR = "#3a8acc";

type RoomGeo = {
  room: Room;
  center: THREE.Vector3;
  size: THREE.Vector3;
  color: THREE.Color;
};

function buildRoomGeos(level: Level): RoomGeo[] {
  return level.rooms.map((r) => {
    const minX = r.min[0] * CELL - HALF, maxX = r.max[0] * CELL + HALF;
    const minY = r.min[1] * CELL - HALF, maxY = r.max[1] * CELL + HALF;
    const minZ = r.min[2] * CELL - HALF, maxZ = r.max[2] * CELL + HALF;
    return {
      room: r,
      center: new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
      size: new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ),
      color: new THREE.Color(KIND_COLOR[r.kind]),
    };
  });
}

type CorridorSeg = {
  center: THREE.Vector3;
  size: THREE.Vector3;
};

// Build short box segments along each corridor path so corridors read as
// fat tubes between rooms instead of single thin lines.
function buildCorridorSegs(level: Level): CorridorSeg[] {
  const segs: CorridorSeg[] = [];
  const W = CELL * 0.55; // fat tube cross-section
  for (const cor of level.corridors) {
    const path = cor.path;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const ax = a[0] * CELL, ay = a[1] * CELL, az = a[2] * CELL;
      const bx = b[0] * CELL, by = b[1] * CELL, bz = b[2] * CELL;
      const cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
      const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), dz = Math.abs(bz - az);
      // Extend by W on the running axis so adjacent segments overlap and read as a tube.
      segs.push({
        center: new THREE.Vector3(cx, cy, cz),
        size: new THREE.Vector3(
          dx > 0 ? dx + W : W,
          dy > 0 ? dy + W : W,
          dz > 0 ? dz + W : W,
        ),
      });
    }
  }
  return segs;
}

// Bounds across all rooms + corridor cells, used to frame the map camera.
function levelBounds(level: Level) {
  const box = new THREE.Box3();
  for (const r of level.rooms) {
    box.expandByPoint(new THREE.Vector3(r.min[0] * CELL - HALF, r.min[1] * CELL - HALF, r.min[2] * CELL - HALF));
    box.expandByPoint(new THREE.Vector3(r.max[0] * CELL + HALF, r.max[1] * CELL + HALF, r.max[2] * CELL + HALF));
  }
  for (const cor of level.corridors) {
    for (const p of cor.path) {
      box.expandByPoint(new THREE.Vector3(p[0] * CELL, p[1] * CELL, p[2] * CELL));
    }
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { center, size, radius: Math.max(40, size.length() / 2) };
}

// Find which room (if any) currently contains the ship.
function findCurrentRoom(level: Level, shipPos: THREE.Vector3): Room | null {
  const cx = Math.round(shipPos.x / CELL);
  const cy = Math.round(shipPos.y / CELL);
  const cz = Math.round(shipPos.z / CELL);
  for (const r of level.rooms) {
    if (cx >= r.min[0] && cx <= r.max[0] &&
        cy >= r.min[1] && cy <= r.max[1] &&
        cz >= r.min[2] && cz <= r.max[2]) {
      return r;
    }
  }
  return null;
}

function MapScene({
  level, shipPos, shipQuat, robots, pickups, yaw, pitch, zoom, floorY,
}: {
  level: Level;
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  robots: Robot[];
  pickups: PickupRuntime[];
  yaw: number;
  pitch: number;
  zoom: number;
  floorY: number;
}) {
  const roomGeos = useMemo(() => buildRoomGeos(level), [level]);
  const corridorSegs = useMemo(() => buildCorridorSegs(level), [level]);
  const bounds = useMemo(() => levelBounds(level), [level]);
  const { camera } = useThree();

  const shipMarker = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const dropRef = useRef<THREE.Mesh>(null);
  const robotGroup = useRef<THREE.Group>(null);
  const pickupGroup = useRef<THREE.Group>(null);

  useFrame((state) => {
    // Orbit camera around level center. dist scales with bounds size + zoom.
    const dist = bounds.radius * 2.0 * zoom;
    const cy = Math.cos(pitch);
    const sy = Math.sin(pitch);
    const cx = Math.cos(yaw);
    const sx = Math.sin(yaw);
    camera.position.set(
      bounds.center.x + dist * cy * sx,
      bounds.center.y + dist * sy,
      bounds.center.z + dist * cy * cx,
    );
    camera.lookAt(bounds.center);

    if (shipMarker.current) {
      shipMarker.current.position.copy(shipPos);
      shipMarker.current.quaternion.copy(shipQuat);
    }

    // Pulsing halo around ship for visibility at any zoom.
    if (haloRef.current) {
      const t = state.clock.elapsedTime;
      const s = 1 + Math.sin(t * 4) * 0.25;
      haloRef.current.scale.set(s, s, s);
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.45 + Math.sin(t * 4) * 0.2;
    }

    // Vertical drop-line from ship down to the floor plane: scale a thin box.
    if (dropRef.current) {
      const dropLen = Math.max(0.1, shipPos.y - floorY);
      dropRef.current.position.set(shipPos.x, (shipPos.y + floorY) / 2, shipPos.z);
      dropRef.current.scale.set(1, dropLen, 1);
    }

    if (robotGroup.current) {
      const children = robotGroup.current.children;
      for (let i = 0; i < robots.length; i++) {
        const r = robots[i]!;
        const c = children[i] as THREE.Mesh | undefined;
        if (!c) continue;
        c.position.copy(r.pos);
        c.visible = r.alive;
      }
    }

    // Pickup dots — hide collected ones, gently pulse the rest so they
    // read as live loot even at small zoom.
    if (pickupGroup.current) {
      const children = pickupGroup.current.children;
      const t = state.clock.elapsedTime;
      const s = 1 + Math.sin(t * 3) * 0.18;
      for (let i = 0; i < pickups.length; i++) {
        const p = pickups[i]!;
        const c = children[i] as THREE.Mesh | undefined;
        if (!c) continue;
        c.visible = p.active;
        if (p.active) c.scale.setScalar(s);
      }
    }
  });

  // Reference grid placed at the bottom of the level bounds.
  const gridSize = Math.max(bounds.size.x, bounds.size.z) * 1.6;
  const gridDivisions = Math.max(8, Math.round(gridSize / CELL));

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[80, 120, 80]} intensity={0.7} />

      {/* Reference grid at floor level */}
      <gridHelper
        args={[gridSize, gridDivisions, "#1d4d70", "#0e2a40"]}
        position={[bounds.center.x, floorY, bounds.center.z]}
      />

      {/* Filled, semi-transparent room volumes — kind-colored */}
      {roomGeos.map((g, i) => (
        <group key={`room-${i}`} position={g.center}>
          {/* Floor footprint — opaque slab so vertical relationships read clearly */}
          <mesh position={[0, -g.size.y / 2 - 0.05, 0]}>
            <boxGeometry args={[g.size.x * 0.96, 0.4, g.size.z * 0.96]} />
            <meshBasicMaterial color={g.color} transparent opacity={0.55} toneMapped={false} />
          </mesh>
          {/* Volume — translucent box so the inside is visible */}
          <mesh>
            <boxGeometry args={[g.size.x, g.size.y, g.size.z]} />
            <meshBasicMaterial
              color={g.color}
              transparent
              opacity={0.18}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {/* Edges for crisp silhouette */}
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(g.size.x, g.size.y, g.size.z)]} />
            <lineBasicMaterial color={g.color} transparent opacity={0.95} toneMapped={false} />
          </lineSegments>
        </group>
      ))}

      {/* Corridor tubes — short fat box segments */}
      {corridorSegs.map((s, i) => (
        <mesh key={`cor-${i}`} position={s.center}>
          <boxGeometry args={[s.size.x, s.size.y, s.size.z]} />
          <meshBasicMaterial
            color={CORRIDOR_COLOR}
            transparent
            opacity={0.55}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Reactor pulse marker */}
      <ReactorMarker pos={level.reactor} />

      {/* Robot markers — small yellow boxes */}
      <group ref={robotGroup}>
        {robots.map((r) => (
          <mesh key={r.id}>
            <boxGeometry args={[1.6, 1.6, 1.6]} />
            <meshBasicMaterial color="#ffcc22" toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* Uncollected pickup dots — small spheres colored by kind, drawn
          on top of room volumes so they remain visible inside translucent
          arenas. */}
      <group ref={pickupGroup}>
        {pickups.map((p, i) => (
          <mesh
            key={`pickup-${i}`}
            position={[p.pickup.pos[0], p.pickup.pos[1], p.pickup.pos[2]]}
            renderOrder={8}
          >
            <sphereGeometry args={[0.9, 10, 10]} />
            <meshBasicMaterial
              color={PICKUP_DOT_COLOR[p.pickup.kind]}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* Vertical drop-line from ship to floor — render before ship marker */}
      <mesh ref={dropRef}>
        <boxGeometry args={[0.25, 1, 0.25]} />
        <meshBasicMaterial color="#66ff88" transparent opacity={0.55} toneMapped={false} />
      </mesh>

      {/* Player ship marker — large arrow + halo, drawn on top of everything */}
      <group ref={shipMarker}>
        {/* Pulsing halo ring */}
        <mesh ref={haloRef} renderOrder={10}>
          <ringGeometry args={[2.6, 3.4, 32]} />
          <meshBasicMaterial
            color="#aaffbb"
            side={THREE.DoubleSide}
            transparent
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        {/* Heading arrow — points along -Z (ship forward) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.5]} renderOrder={11}>
          <coneGeometry args={[1.6, 4.5, 4]} />
          <meshBasicMaterial color="#66ff88" depthTest={false} toneMapped={false} />
        </mesh>
        {/* Body sphere */}
        <mesh renderOrder={11}>
          <sphereGeometry args={[1.0, 12, 12]} />
          <meshBasicMaterial color="#eaffea" depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

function ReactorMarker({ pos }: { pos: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.scale.setScalar(1 + Math.sin(t * 4) * 0.25);
  });
  return (
    <mesh ref={ref} position={pos} renderOrder={9}>
      <sphereGeometry args={[2.6, 16, 16]} />
      <meshBasicMaterial color="#ff3344" depthTest={false} toneMapped={false} />
    </mesh>
  );
}

export function MapView({ level, shipPos, shipQuat, robots, pickups, onClose }: Props) {
  // Default to a pleasing isometric-ish angle.
  const [yaw, setYaw] = useState(Math.PI / 4);
  const [pitch, setPitch] = useState(Math.PI / 5);
  const [zoom, setZoom] = useState(1);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  // Floor plane Y for grid + drop-line: anchor to bottom of level bounds.
  const bounds = useMemo(() => levelBounds(level), [level]);
  const floorY = bounds.center.y - bounds.size.y / 2 - 1;

  // Track current room name with a tiny re-render loop tied to the map being open.
  const [roomLabel, setRoomLabel] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const r = findCurrentRoom(level, shipPos);
      const next = r ? KIND_LABEL[r.kind] : "CORRIDOR";
      setRoomLabel((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [level, shipPos]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.x;
    const dy = e.clientY - dragging.current.y;
    dragging.current.x = e.clientX;
    dragging.current.y = e.clientY;
    setYaw((y) => y + dx * 0.005);
    setPitch((p) => Math.max(-1.4, Math.min(1.4, p + dy * 0.005)));
  };
  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => Math.max(0.4, Math.min(3, z * (1 + e.deltaY * 0.001))));
  };

  // Keyboard orbit while map is open.
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === "KeyA" || e.code === "ArrowLeft") setYaw((y) => y - 0.1);
      if (e.code === "KeyD" || e.code === "ArrowRight") setYaw((y) => y + 0.1);
      if (e.code === "KeyW" || e.code === "ArrowUp") setPitch((p) => Math.max(-1.4, p - 0.1));
      if (e.code === "KeyS" || e.code === "ArrowDown") setPitch((p) => Math.min(1.4, p + 0.1));
      if (e.code === "Equal" || e.code === "NumpadAdd") setZoom((z) => Math.max(0.4, z * 0.9));
      if (e.code === "Minus" || e.code === "NumpadSubtract") setZoom((z) => Math.min(3, z * 1.1));
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, []);

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 flex flex-col bg-black/85 backdrop-blur-sm"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
    >
      <div className="flex items-center justify-between border-b border-cyan-400/40 px-6 py-3">
        <div className="flex items-baseline gap-4">
          <h2 className="text-xl font-black tracking-[0.4em] text-cyan-300">AUTOMAP</h2>
          <span className="text-xs uppercase tracking-widest text-cyan-200/60">
            Game paused · Drag to orbit · Wheel to zoom · Tab to close
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-200">
            You are in: <span className="ml-1 text-cyan-50">{roomLabel || "—"}</span>
          </span>
          <button
            onClick={onClose}
            className="rounded border border-cyan-400/50 bg-cyan-500/10 px-4 py-1 text-xs font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/30"
          >
            CLOSE
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        <Canvas
          camera={{ fov: 45, near: 1, far: 5000, position: [200, 200, 200] }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor(new THREE.Color("#02060a"), 0.0)}
        >
          <MapScene
            level={level}
            shipPos={shipPos}
            shipQuat={shipQuat}
            robots={robots}
            pickups={pickups}
            yaw={yaw}
            pitch={pitch}
            zoom={zoom}
            floorY={floorY}
          />
        </Canvas>

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-4 left-4 rounded border border-cyan-400/30 bg-black/60 p-3 text-[11px] uppercase tracking-widest text-cyan-100/80">
          <Legend swatch="#66ff88" label="Your ship (arrow = facing)" />
          <Legend swatch="#ffcc22" label="Robots" />
          <Legend swatch="#ff3344" label="Reactor chamber" />
          <Legend swatch="#ff8a3a" label="Hub room" />
          <Legend swatch="#7a55ff" label="Shaft" />
          <Legend swatch="#3a8acc" label="Corridor" />
          <Legend swatch={PICKUP_DOT_COLOR.shield_cell} label={PICKUP_LABEL.shield_cell} />
          <Legend swatch={PICKUP_DOT_COLOR.ammo_core} label={PICKUP_LABEL.ammo_core} />
          <Legend swatch={PICKUP_DOT_COLOR.score_chip} label={PICKUP_LABEL.score_chip} />
        </div>
      </div>
    </div>
  );
}

function Legend({ swatch, label, dim }: { swatch: string; label: string; dim?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${dim ? "opacity-70" : ""}`}>
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: swatch }} />
      <span>{label}</span>
    </div>
  );
}
