import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CELL, HALF, type Level } from "./level";
import type { Robot } from "./gameStore";

type Props = {
  level: Level;
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  robots: Robot[];
  onClose: () => void;
};

// Build clean wireframe geometry: one box outline per room + polyline per corridor.
// This avoids drawing every cell face, which produced overlapping line clutter.
function buildMapGeometry(level: Level) {
  const positions: number[] = [];
  const colors: number[] = [];

  const KIND_COLOR: Record<string, THREE.Color> = {
    hub:     new THREE.Color("#ff8a3a"),
    shaft:   new THREE.Color("#7a55ff"),
    reactor: new THREE.Color("#ff3344"),
  };
  const CORRIDOR_COLOR = new THREE.Color("#3a8acc");

  // Each room → 12 edges of its bounding box.
  const boxEdges: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const r of level.rooms) {
    const col = KIND_COLOR[r.kind] ?? KIND_COLOR.hub!;
    const minX = r.min[0] * CELL - HALF, maxX = r.max[0] * CELL + HALF;
    const minY = r.min[1] * CELL - HALF, maxY = r.max[1] * CELL + HALF;
    const minZ = r.min[2] * CELL - HALF, maxZ = r.max[2] * CELL + HALF;
    const corners: Array<[number, number, number]> = [
      [minX, minY, minZ], [maxX, minY, minZ],
      [maxX, minY, maxZ], [minX, minY, maxZ],
      [minX, maxY, minZ], [maxX, maxY, minZ],
      [maxX, maxY, maxZ], [minX, maxY, maxZ],
    ];
    for (const [a, b] of boxEdges) {
      const A = corners[a]!, B = corners[b]!;
      positions.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }
  }

  // Each corridor → polyline through its cell centers.
  for (const cor of level.corridors) {
    const path = cor.path;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!, b = path[i + 1]!;
      positions.push(a[0] * CELL, a[1] * CELL, a[2] * CELL,
                     b[0] * CELL, b[1] * CELL, b[2] * CELL);
      colors.push(CORRIDOR_COLOR.r, CORRIDOR_COLOR.g, CORRIDOR_COLOR.b,
                  CORRIDOR_COLOR.r, CORRIDOR_COLOR.g, CORRIDOR_COLOR.b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
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
  return { center, radius: Math.max(40, size.length() / 2) };
}

function MapScene({ level, shipPos, shipQuat, robots, yaw, pitch, zoom }: {
  level: Level;
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  robots: Robot[];
  yaw: number;
  pitch: number;
  zoom: number;
}) {
  const geo = useMemo(() => buildMapGeometry(level), [level]);
  useEffect(() => () => geo.dispose(), [geo]);
  const bounds = useMemo(() => levelBounds(level), [level]);
  const { camera } = useThree();

  const shipMarker = useRef<THREE.Group>(null);
  const robotGroup = useRef<THREE.Group>(null);

  useFrame(() => {
    // Orbit camera around level center
    const dist = bounds.radius * 1.6 * zoom;
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

    // Update ship marker
    if (shipMarker.current) {
      shipMarker.current.position.copy(shipPos);
      shipMarker.current.quaternion.copy(shipQuat);
    }

    // Update robot dots
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
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <lineSegments geometry={geo}>
        <lineBasicMaterial vertexColors transparent opacity={0.85} toneMapped={false} />
      </lineSegments>

      {/* Reactor marker — pulsing red sphere */}
      <ReactorMarker pos={level.reactor} />

      {/* Player ship — bright green arrow pointing forward (-Z) */}
      <group ref={shipMarker}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[1.4, 3.2, 4]} />
          <meshBasicMaterial color="#66ff88" toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.6, 8, 8]} />
          <meshBasicMaterial color="#aaffbb" toneMapped={false} />
        </mesh>
      </group>

      {/* Robot markers — small yellow squares */}
      <group ref={robotGroup}>
        {robots.map((r) => (
          <mesh key={r.id}>
            <boxGeometry args={[1.6, 1.6, 1.6]} />
            <meshBasicMaterial color="#ffcc22" toneMapped={false} />
          </mesh>
        ))}
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
    <mesh ref={ref} position={pos}>
      <sphereGeometry args={[2.2, 16, 16]} />
      <meshBasicMaterial color="#ff3344" toneMapped={false} />
    </mesh>
  );
}

export function MapView({ level, shipPos, shipQuat, robots, onClose }: Props) {
  const [yaw, setYaw] = useState(0.6);
  const [pitch, setPitch] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  // Keep input handlers attached to the overlay div, not window, so the underlying
  // game's pointer-lock state isn't disturbed.
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

  // Keyboard rotation while map is open
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
            Drag to orbit · Wheel to zoom · Tab to close
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded border border-cyan-400/50 bg-cyan-500/10 px-4 py-1 text-xs font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/30"
        >
          CLOSE
        </button>
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
            yaw={yaw}
            pitch={pitch}
            zoom={zoom}
          />
        </Canvas>

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-4 left-4 rounded border border-cyan-400/30 bg-black/60 p-3 text-[11px] uppercase tracking-widest text-cyan-100/80">
          <Legend swatch="#66ff88" label="Your ship" />
          <Legend swatch="#ffcc22" label="Robots" />
          <Legend swatch="#ff3344" label="Reactor chamber" />
          <Legend swatch="#ff8a3a" label="Hub room" />
          <Legend swatch="#7a55ff" label="Shaft" />
          <Legend swatch="#3a8acc" label="Corridor" />
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
