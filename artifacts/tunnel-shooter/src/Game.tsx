import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { LevelMesh } from "./LevelMesh";
import { MapView } from "./MapView";
import { bfsNextStep, clampToLevel, generateLevel, key, losAxisAligned, neighborCells, CELL, HALF, type Level } from "./level";
import {
  initialState,
  ROBOT_ARCHETYPES,
  type GameState,
  type Laser,
  type Robot,
  type RobotKind,
} from "./gameStore";

type Debris = {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angAxis: THREE.Vector3; // unit axis
  angRate: number;        // rad/sec
  life: number;
  maxLife: number;
  geoIdx: number;
  kind: RobotKind;
  bornAt: number;
};

type Explosion = {
  active: boolean;
  pos: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  kind: "spark" | "robot" | "reactor";
};

type SharedRefs = {
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  shipVel: THREE.Vector3;
  lasers: Laser[];
  robots: Robot[];
  explosions: Explosion[];
  debris: Debris[];
  level: Level;
  setHud: React.Dispatch<React.SetStateAction<GameState>>;
  hud: React.MutableRefObject<GameState>;
  keys: Set<string>;
  mouse: {
    dx: number; dy: number;
    aimX: number; aimY: number;
    locked: boolean;
    firing: boolean;
  };
  paused: { current: boolean };
};

// ---------- Module-scope scratch (no per-frame allocation in hot paths) ----------
const _vx = new THREE.Vector3();
const _vy = new THREE.Vector3();
const _vz = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _vu = new THREE.Vector3();
const _vBase = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vPrev = new THREE.Vector3();
const _vDiff = new THREE.Vector3();
const _quatA = new THREE.Quaternion();

// ---------- Pool sizing ----------
const LASER_POOL_SIZE = 64;
const EXPLOSION_POOL_SIZE = 32;
const DEBRIS_POOL_SIZE = 60;
const DEBRIS_PER_DEATH = 7;

// Debris reuses the existing robot sub-geometries (hull shard, belt fragment,
// ring fragment) at a smaller display scale so chunks read as "pieces of that
// robot." Collider radii are matched to the displayed size.
// (Initialized below once ROBOT_* geometries are declared.)
let DEBRIS_GEOS: THREE.BufferGeometry[] = [];
let DEBRIS_DISPLAY_SCALES: number[] = [];
let DEBRIS_RADII: number[] = [];

// ---------- Shared geometries / materials ----------
const LASER_CORE_GEO = new THREE.CylinderGeometry(0.08, 0.08, 1.8, 6);
const LASER_HALO_GEO = new THREE.CylinderGeometry(0.28, 0.28, 1.8, 6);

const LASER_CORE_MAT_FRIENDLY = new THREE.MeshBasicMaterial({ color: "#ffaaaa", toneMapped: false });
const LASER_CORE_MAT_HOSTILE = new THREE.MeshBasicMaterial({ color: "#88ffaa", toneMapped: false });
const LASER_HALO_MAT_FRIENDLY = new THREE.MeshBasicMaterial({
  color: "#ff3a55", transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const LASER_HALO_MAT_HOSTILE = new THREE.MeshBasicMaterial({
  color: "#33ff88", transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

const ROBOT_HULL_GEO = new THREE.OctahedronGeometry(1.4, 0);
const ROBOT_BELT_GEO = new THREE.TorusGeometry(1.05, 0.18, 8, 16);
const ROBOT_RING_GEO = new THREE.TorusGeometry(1.7, 0.05, 6, 32);

// Debris reuses the robot sub-geometries directly. Mesh scale shrinks them to
// chunk size; collider radius matches the rendered radius.
DEBRIS_GEOS = [ROBOT_HULL_GEO, ROBOT_BELT_GEO, ROBOT_RING_GEO];
DEBRIS_DISPLAY_SCALES = [0.4, 0.5, 0.35];
DEBRIS_RADII = [
  1.4 * DEBRIS_DISPLAY_SCALES[0]!,            // hull shard ~0.56
  (1.05 + 0.18) * DEBRIS_DISPLAY_SCALES[1]!,  // belt fragment ~0.62
  (1.7 + 0.05) * DEBRIS_DISPLAY_SCALES[2]!,   // ring fragment ~0.61
];
const ROBOT_EYE_GEO = new THREE.SphereGeometry(0.5, 16, 16);
const ROBOT_HALO_GEO = new THREE.SphereGeometry(0.85, 12, 12);

const ROBOT_HULL_MAT = new THREE.MeshStandardMaterial({
  color: "#7a8392", emissive: "#0a1018", emissiveIntensity: 0.4,
  metalness: 0.85, roughness: 0.35, flatShading: true,
});
const ROBOT_BELT_MAT = new THREE.MeshStandardMaterial({
  color: "#3a3540", metalness: 0.95, roughness: 0.25, flatShading: true,
});
const ROBOT_RING_MAT = new THREE.MeshStandardMaterial({
  color: "#33ff88", emissive: "#33ff88", emissiveIntensity: 2.2, toneMapped: false,
});
const ROBOT_HALO_MAT = new THREE.MeshBasicMaterial({
  color: "#33ff88", transparent: true, opacity: 0.18,
  blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

// Per-kind hull material used by debris pieces (tinted to the source robot).
const DEBRIS_HULL_MATS: Record<RobotKind, THREE.MeshStandardMaterial> = (() => {
  const out = {} as Record<RobotKind, THREE.MeshStandardMaterial>;
  for (const k of Object.keys(ROBOT_ARCHETYPES) as RobotKind[]) {
    const a = ROBOT_ARCHETYPES[k];
    const m = ROBOT_HULL_MAT.clone();
    m.color.set(a.tint);
    m.emissive.set(a.tint);
    m.emissiveIntensity = 0.25;
    out[k] = m;
  }
  return out;
})();

const EXPLOSION_CORE_GEO = new THREE.IcosahedronGeometry(1, 1);
const EXPLOSION_HALO_GEO = new THREE.SphereGeometry(1, 12, 12);
const EXPLOSION_RING_GEO = new THREE.RingGeometry(0.7, 1.0, 24);

const EXPLOSION_PALETTE: Record<Explosion["kind"], { core: string; halo: string; ring: string }> = {
  spark:   { core: "#ffd28a", halo: "#ff9a44", ring: "#ffb066" },
  robot:   { core: "#bfffd6", halo: "#33ff88", ring: "#88ffbb" },
  reactor: { core: "#fff0b0", halo: "#ff6a1a", ring: "#ffaa55" },
};

const SHIP_RING_GEO = new THREE.RingGeometry(0.08, 0.1, 24);
const SHIP_RING_MAT = new THREE.MeshBasicMaterial({
  color: "#ff7a2e", transparent: true, opacity: 0.7, side: THREE.DoubleSide,
});

function spawnDebris(refs: SharedRefs, pos: THREE.Vector3, kind: RobotKind) {
  // Find an inactive slot; otherwise recycle the oldest active piece.
  const pool = refs.debris;
  let slot = -1;
  let oldest = Infinity;
  let oldestSlot = 0;
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i]!.active) { slot = i; break; }
    if (pool[i]!.bornAt < oldest) { oldest = pool[i]!.bornAt; oldestSlot = i; }
  }
  if (slot < 0) slot = oldestSlot;
  const d = pool[slot]!;
  d.active = true;
  d.bornAt = performance.now();
  d.maxLife = 1.4 + Math.random() * 0.7;
  d.life = d.maxLife;
  d.kind = kind;
  d.geoIdx = Math.floor(Math.random() * DEBRIS_GEOS.length);

  const ox = (Math.random() * 2 - 1) * 0.4;
  const oy = (Math.random() * 2 - 1) * 0.4;
  const oz = (Math.random() * 2 - 1) * 0.4;
  d.pos.set(pos.x + ox, pos.y + oy, pos.z + oz);
  const spread = 9 + Math.random() * 4;
  d.vel.set(
    (Math.random() * 2 - 1) * spread,
    (Math.random() * 2 - 1) * spread,
    (Math.random() * 2 - 1) * spread,
  );
  d.quat.identity();
  d.angAxis.set(
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
  );
  if (d.angAxis.lengthSq() < 1e-6) d.angAxis.set(0, 1, 0);
  d.angAxis.normalize();
  d.angRate = (Math.random() * 6 + 3) * (Math.random() < 0.5 ? -1 : 1);
}

function clearAllDebris(refs: SharedRefs) {
  for (let i = 0; i < refs.debris.length; i++) {
    refs.debris[i]!.active = false;
  }
}

function spawnExplosion(refs: SharedRefs, pos: THREE.Vector3, kind: Explosion["kind"]) {
  const pool = refs.explosions;
  const cfg =
    kind === "reactor" ? { life: 1.1, size: 6.5 } :
    kind === "robot"   ? { life: 0.7, size: 3.2 } :
                         { life: 0.28, size: 1.0 };
  for (let i = 0; i < pool.length; i++) {
    const E = pool[i]!;
    if (E.active) continue;
    E.active = true;
    E.kind = kind;
    E.life = cfg.life;
    E.maxLife = cfg.life;
    E.size = cfg.size;
    E.pos.copy(pos);
    return;
  }
}

function spawnLaser(
  refs: SharedRefs,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  hostile: boolean,
  speed = hostile ? 60 : 110,
  damage = hostile ? 12 : 25,
  life = 2.0,
) {
  const pool = refs.lasers;
  for (let i = 0; i < pool.length; i++) {
    const L = pool[i]!;
    if (L.active) continue;
    L.active = true;
    L.hostile = hostile;
    L.life = life;
    L.damage = damage;
    L.pos.copy(pos);
    L.vel.copy(dir).normalize().multiplyScalar(speed);
    return;
  }
}

function ShipController({ refs }: { refs: SharedRefs }) {
  const { camera } = useThree();
  const fireCooldown = useRef(0);

  useFrame((_, dt) => {
    if (refs.hud.current.status !== "playing") return;
    if (refs.paused.current) return;
    const d = Math.min(dt, 0.05);

    // --- Orientation ---
    const q = refs.shipQuat;
    _vx.set(1, 0, 0).applyQuaternion(q);
    _vy.set(0, 1, 0).applyQuaternion(q);
    _vz.set(0, 0, 1).applyQuaternion(q);

    // Mouse pitch/yaw
    let yaw = 0;
    let pitch = 0;
    if (refs.mouse.locked) {
      const sens = 0.0025;
      yaw = -refs.mouse.dx * sens;
      pitch = -refs.mouse.dy * sens;
      refs.mouse.dx = 0;
      refs.mouse.dy = 0;
    } else {
      const DEAD = 0.08;
      const MAX_RATE = 2.2;
      const applyAxis = (v: number) => {
        const m = Math.abs(v);
        if (m < DEAD) return 0;
        const t = (m - DEAD) / (1 - DEAD);
        return Math.sign(v) * t * t * MAX_RATE * d;
      };
      yaw = -applyAxis(refs.mouse.aimX);
      pitch = -applyAxis(refs.mouse.aimY);
    }

    // Keyboard pitch/yaw
    let kbYaw = 0, kbPitch = 0, kbRoll = 0;
    const k = refs.keys;
    if (k.has("ArrowLeft")) kbYaw += 1.4 * d;
    if (k.has("ArrowRight")) kbYaw -= 1.4 * d;
    if (k.has("ArrowUp")) kbPitch += 1.4 * d;
    if (k.has("ArrowDown")) kbPitch -= 1.4 * d;
    if (k.has("KeyQ")) kbRoll += 1.6 * d;
    if (k.has("KeyE")) kbRoll -= 1.6 * d;

    _quatA.setFromAxisAngle(_vy, yaw + kbYaw);
    q.premultiply(_quatA);
    _quatA.setFromAxisAngle(_vx, pitch + kbPitch);
    q.premultiply(_quatA);
    _quatA.setFromAxisAngle(_vz, kbRoll);
    q.premultiply(_quatA);
    q.normalize();

    // --- Thrust ---
    const accel = 70;
    _vt.set(0, 0, 0);
    const shift = k.has("ShiftLeft") || k.has("ShiftRight");
    if (k.has("KeyW")) _vt.addScaledVector(shift ? _vy : _vz, shift ? 1 : -1);
    if (k.has("KeyS")) _vt.addScaledVector(shift ? _vy : _vz, shift ? -1 : 1);
    if (k.has("KeyA")) _vt.addScaledVector(_vx, -1);
    if (k.has("KeyD")) _vt.addScaledVector(_vx, 1);
    if (_vt.lengthSq() > 0) _vt.normalize().multiplyScalar(accel);
    refs.shipVel.addScaledVector(_vt, d);

    refs.shipVel.multiplyScalar(Math.pow(0.18, d));
    const maxSpeed = 28;
    if (refs.shipVel.length() > maxSpeed) refs.shipVel.setLength(maxSpeed);

    _vPrev.copy(refs.shipPos);
    refs.shipPos.addScaledVector(refs.shipVel, d);
    const clamped = clampToLevel(refs.level, refs.shipPos, _vPrev);
    if (!clamped.equals(refs.shipPos)) {
      _vDiff.copy(clamped).sub(refs.shipPos);
      if (Math.abs(_vDiff.x) > 0.0001) refs.shipVel.x = 0;
      if (Math.abs(_vDiff.y) > 0.0001) refs.shipVel.y = 0;
      if (Math.abs(_vDiff.z) > 0.0001) refs.shipVel.z = 0;
      refs.shipPos.copy(clamped);
    }

    // Ship-vs-robot blocking: treat each live robot as a solid sphere.
    const SHIP_R = 0.7;
    const robots = refs.robots;
    let pushedByRobot = false;
    for (let i = 0; i < robots.length; i++) {
      const r = robots[i]!;
      if (!r.alive) continue;
      const arch = ROBOT_ARCHETYPES[r.kind];
      const robotR = 1.4 * arch.scale + SHIP_R;
      _vDiff.copy(refs.shipPos).sub(r.pos);
      const distSq = _vDiff.lengthSq();
      if (distSq >= robotR * robotR) continue;
      if (distSq < 1e-6) {
        _vDiff.set(0, 0, -1).applyQuaternion(refs.shipQuat);
        refs.shipPos.addScaledVector(_vDiff, robotR);
        continue;
      }
      const dist = Math.sqrt(distSq);
      _vDiff.multiplyScalar(1 / dist); // unit normal robot -> ship
      const penetration = robotR - dist;
      refs.shipPos.addScaledVector(_vDiff, penetration);
      const vDotN = refs.shipVel.dot(_vDiff);
      if (vDotN < 0) refs.shipVel.addScaledVector(_vDiff, -vDotN);
      pushedByRobot = true;
    }
    if (pushedByRobot) {
      _vPrev.copy(refs.shipPos);
      const c2 = clampToLevel(refs.level, refs.shipPos, _vPrev);
      if (!c2.equals(refs.shipPos)) {
        _vDiff.copy(c2).sub(refs.shipPos);
        if (Math.abs(_vDiff.x) > 0.0001) refs.shipVel.x = 0;
        if (Math.abs(_vDiff.y) > 0.0001) refs.shipVel.y = 0;
        if (Math.abs(_vDiff.z) > 0.0001) refs.shipVel.z = 0;
        refs.shipPos.copy(c2);
      }
    }

    // --- Camera ---
    camera.position.copy(refs.shipPos);
    camera.quaternion.copy(refs.shipQuat);

    // --- Fire ---
    fireCooldown.current -= d;
    if ((k.has("Space") || refs.mouse.firing) && fireCooldown.current <= 0) {
      fireCooldown.current = 0.16;
      // fwd = (0,0,-1) rotated by q
      _vu.set(0, 0, -1).applyQuaternion(q);
      // base = shipPos + (-0.3)*localY + 1.5*fwd
      _vBase.copy(refs.shipPos).addScaledVector(_vy, -0.3).addScaledVector(_vu, 1.5);
      // right cannon
      _vt.copy(_vBase).addScaledVector(_vx, 0.6);
      spawnLaser(refs, _vt, _vu, false);
      // left cannon
      _vt.copy(_vBase).addScaledVector(_vx, -0.6);
      spawnLaser(refs, _vt, _vu, false);
    }
  });

  return null;
}

function LaserPool({ refs }: { refs: SharedRefs }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const coreRefs = useRef<(THREE.Mesh | null)[]>([]);
  const haloRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    if (refs.paused.current) return;
    const pool = refs.lasers;
    for (let i = 0; i < pool.length; i++) {
      const L = pool[i]!;
      const g = groupRefs.current[i];
      if (!g) continue;
      if (!L.active) {
        if (g.visible) g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.copy(L.pos);
      _vTarget.copy(L.pos).add(L.vel);
      g.lookAt(_vTarget);
      g.rotateX(Math.PI / 2);
      const core = coreRefs.current[i];
      const halo = haloRefs.current[i];
      const coreMat = L.hostile ? LASER_CORE_MAT_HOSTILE : LASER_CORE_MAT_FRIENDLY;
      const haloMat = L.hostile ? LASER_HALO_MAT_HOSTILE : LASER_HALO_MAT_FRIENDLY;
      if (core && core.material !== coreMat) core.material = coreMat;
      if (halo && halo.material !== haloMat) halo.material = haloMat;
    }
  });

  const slots = useMemo(
    () => Array.from({ length: LASER_POOL_SIZE }, (_, i) => i),
    [],
  );
  return (
    <>
      {slots.map((i) => (
        <group key={i} visible={false} ref={(el) => { groupRefs.current[i] = el; }}>
          <mesh
            geometry={LASER_CORE_GEO}
            material={LASER_CORE_MAT_FRIENDLY}
            ref={(el) => { coreRefs.current[i] = el; }}
          />
          <mesh
            geometry={LASER_HALO_GEO}
            material={LASER_HALO_MAT_FRIENDLY}
            ref={(el) => { haloRefs.current[i] = el; }}
          />
        </group>
      ))}
    </>
  );
}

function RobotPool({ refs }: { refs: SharedRefs }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const eyeMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // Per-kind material caches so tint matches archetype.
  type KindMatEntry = {
    hull: THREE.MeshStandardMaterial;
    ring: THREE.MeshStandardMaterial;
    halo: THREE.MeshBasicMaterial;
    eyeRGB: [number, number, number];
  };
  const kindMats = useMemo<Record<RobotKind, KindMatEntry>>(() => {
    const entries = (Object.keys(ROBOT_ARCHETYPES) as RobotKind[]).map((k): [RobotKind, KindMatEntry] => {
      const a = ROBOT_ARCHETYPES[k];
      const ring = ROBOT_RING_MAT.clone();
      ring.color.set(a.ringColor);
      ring.emissive.set(a.ringColor);
      const halo = ROBOT_HALO_MAT.clone();
      halo.color.set(a.haloColor);
      const hull = ROBOT_HULL_MAT.clone();
      hull.color.set(a.tint);
      const c = new THREE.Color(a.ringColor);
      return [k, { hull, ring, halo, eyeRGB: [c.r, c.g, c.b] }];
    });
    return Object.fromEntries(entries) as Record<RobotKind, KindMatEntry>;
  }, []);

  useFrame((state) => {
    if (refs.paused.current) return;
    const t = state.clock.elapsedTime;
    const robots = refs.robots;
    for (let i = 0; i < robots.length; i++) {
      const r = robots[i]!;
      const g = groupRefs.current[i];
      if (!g) continue;
      if (!r.alive) {
        if (g.visible) g.visible = false;
        continue;
      }
      g.visible = true;
      const tt = t + r.bobPhase;
      g.position.copy(r.pos);
      g.position.y += Math.sin(tt * 1.2) * 0.5;
      g.rotation.y = tt * 0.6;
      const ring = ringRefs.current[i];
      if (ring) {
        ring.rotation.x = tt * 1.4;
        ring.rotation.z = tt * 0.9;
      }
      const m = eyeMatRefs.current[i];
      if (m) {
        const pulse = 0.7 + Math.sin(tt * 6) * 0.3;
        const rgb = kindMats[r.kind].eyeRGB;
        m.color.setRGB(rgb[0] * pulse, rgb[1] * pulse, rgb[2] * pulse);
      }
    }
  });

  return (
    <>
      {refs.robots.map((r, i) => {
        const a = ROBOT_ARCHETYPES[r.kind];
        const mats = kindMats[r.kind];
        return (
          <group
            key={i}
            ref={(el) => { groupRefs.current[i] = el; }}
            scale={a.scale}
          >
            <mesh geometry={ROBOT_HULL_GEO} material={mats.hull} />
            <mesh geometry={ROBOT_BELT_GEO} material={ROBOT_BELT_MAT} rotation={[Math.PI / 2, 0, 0]} />
            <mesh
              geometry={ROBOT_RING_GEO}
              material={mats.ring}
              ref={(el) => { ringRefs.current[i] = el; }}
            />
            <mesh geometry={ROBOT_EYE_GEO}>
              <meshBasicMaterial
                color={a.ringColor}
                toneMapped={false}
                ref={(m) => { eyeMatRefs.current[i] = m; }}
              />
            </mesh>
            <mesh geometry={ROBOT_HALO_GEO} material={mats.halo} />
          </group>
        );
      })}
    </>
  );
}

function ExplosionPool({ refs }: { refs: SharedRefs }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const coreMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const haloMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const ringMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const ringMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const { camera } = useThree();

  useFrame((state, dt) => {
    if (refs.paused.current) return;
    const d = Math.min(dt, 0.05);
    const pool = refs.explosions;
    for (let i = 0; i < pool.length; i++) {
      const E = pool[i]!;
      const g = groupRefs.current[i];
      if (!g) continue;
      if (!E.active) {
        if (g.visible) g.visible = false;
        continue;
      }
      E.life -= d;
      if (E.life <= 0) {
        E.active = false;
        g.visible = false;
        continue;
      }
      const u = 1 - E.life / E.maxLife;
      const fade = 1 - u;
      const coreScale = E.size * (0.35 + u * 0.55);
      const haloScale = E.size * (0.6 + u * 1.0);
      const ringScale = E.size * (0.7 + u * 1.4);

      g.visible = true;
      g.position.copy(E.pos);

      const core = g.children[0] as THREE.Mesh | undefined;
      const halo = g.children[1] as THREE.Mesh | undefined;
      if (core) {
        core.scale.setScalar(coreScale);
        core.rotation.x = state.clock.elapsedTime * 6 + i;
        core.rotation.y = state.clock.elapsedTime * 4 + i;
      }
      if (halo) halo.scale.setScalar(haloScale);

      const ring = ringMeshRefs.current[i];
      if (ring) {
        ring.scale.setScalar(ringScale);
        // Billboard the ring toward the camera
        ring.lookAt(camera.position);
      }

      const palette = EXPLOSION_PALETTE[E.kind];
      const coreMat = coreMatRefs.current[i];
      const haloMat = haloMatRefs.current[i];
      const ringMat = ringMatRefs.current[i];
      if (coreMat) {
        coreMat.color.set(palette.core);
        coreMat.opacity = Math.min(1, fade * 1.2);
      }
      if (haloMat) {
        haloMat.color.set(palette.halo);
        haloMat.opacity = fade * 0.55;
      }
      if (ringMat) {
        ringMat.color.set(palette.ring);
        ringMat.opacity = fade * 0.8;
      }
    }
  });

  const slots = useMemo(
    () => Array.from({ length: EXPLOSION_POOL_SIZE }, (_, i) => i),
    [],
  );
  return (
    <>
      {slots.map((i) => (
        <group key={i} visible={false} ref={(el) => { groupRefs.current[i] = el; }}>
          <mesh geometry={EXPLOSION_CORE_GEO}>
            <meshBasicMaterial
              transparent
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
              color="#ffd28a"
              ref={(m) => { coreMatRefs.current[i] = m; }}
            />
          </mesh>
          <mesh geometry={EXPLOSION_HALO_GEO}>
            <meshBasicMaterial
              transparent
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
              color="#ff9a44"
              ref={(m) => { haloMatRefs.current[i] = m; }}
            />
          </mesh>
          <mesh
            geometry={EXPLOSION_RING_GEO}
            ref={(el) => { ringMeshRefs.current[i] = el; }}
          >
            <meshBasicMaterial
              transparent
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
              color="#ffb066"
              ref={(m) => { ringMatRefs.current[i] = m; }}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

function DebrisPool({ refs }: { refs: SharedRefs }) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    if (refs.paused.current) return;
    const pool = refs.debris;
    for (let i = 0; i < pool.length; i++) {
      const d = pool[i]!;
      const m = meshRefs.current[i];
      if (!m) continue;
      if (!d.active) {
        if (m.visible) m.visible = false;
        continue;
      }
      m.position.copy(d.pos);
      m.quaternion.copy(d.quat);

      // Pick the geometry/material for this piece (cheap if unchanged).
      const geo = DEBRIS_GEOS[d.geoIdx]!;
      if (m.geometry !== geo) m.geometry = geo;
      const mat = DEBRIS_HULL_MATS[d.kind];
      if (m.material !== mat) m.material = mat;

      // Shrink near end of life so it fades out. Combine with the per-geo
      // display scale so reused robot sub-geometries appear as chunks.
      const u = d.life / d.maxLife;
      const fade = u < 0.3 ? Math.max(0, u / 0.3) : 1;
      m.scale.setScalar(DEBRIS_DISPLAY_SCALES[d.geoIdx]! * fade);
      m.visible = true;
    }
  });

  const slots = useMemo(
    () => Array.from({ length: DEBRIS_POOL_SIZE }, (_, i) => i),
    [],
  );
  return (
    <>
      {slots.map((i) => (
        <mesh
          key={i}
          visible={false}
          geometry={DEBRIS_GEOS[0]}
          material={DEBRIS_HULL_MATS.grunt}
          ref={(el) => { meshRefs.current[i] = el; }}
        />
      ))}
    </>
  );
}

function GameLoop({ refs }: { refs: SharedRefs }) {
  useFrame((_, dt) => {
    if (refs.hud.current.status !== "playing") return;
    if (refs.paused.current) return;
    const d = Math.min(dt, 0.05);

    // Integrate debris (kinematic): move, dampen, bounce off level walls.
    const debrisPool = refs.debris;
    const linDamp = Math.pow(0.55, d);
    for (let i = 0; i < debrisPool.length; i++) {
      const dp = debrisPool[i]!;
      if (!dp.active) continue;
      dp.life -= d;
      if (dp.life <= 0) { dp.active = false; continue; }

      _vPrev.copy(dp.pos);
      dp.pos.addScaledVector(dp.vel, d);
      _vTarget.copy(dp.pos);
      const clamped = clampToLevel(refs.level, _vTarget, _vPrev);
      // Reflect velocity on whichever axes were corrected by the wall clamp.
      if (Math.abs(clamped.x - dp.pos.x) > 1e-4) dp.vel.x = -dp.vel.x * 0.55;
      if (Math.abs(clamped.y - dp.pos.y) > 1e-4) dp.vel.y = -dp.vel.y * 0.55;
      if (Math.abs(clamped.z - dp.pos.z) > 1e-4) dp.vel.z = -dp.vel.z * 0.55;
      dp.pos.copy(clamped);
      dp.vel.multiplyScalar(linDamp);
      // Spin
      _quatA.setFromAxisAngle(dp.angAxis, dp.angRate * d);
      dp.quat.multiply(_quatA);
      dp.angRate *= linDamp;
    }

    // Lasers — iterate fixed pool, no React render, no splice
    const pool = refs.lasers;
    for (let i = 0; i < pool.length; i++) {
      const L = pool[i]!;
      if (!L.active) continue;
      L.life -= d;
      L.pos.addScaledVector(L.vel, d);
      if (L.life <= 0) { L.active = false; continue; }

      const cx = Math.round(L.pos.x / CELL);
      const cy = Math.round(L.pos.y / CELL);
      const cz = Math.round(L.pos.z / CELL);
      const cell = refs.level.cells.get(key(cx, cy, cz));
      if (!cell) { L.active = false; continue; }

      // Hit player?
      if (L.hostile) {
        const distSq = L.pos.distanceToSquared(refs.shipPos);
        if (distSq < 1.6 * 1.6) {
          let dmg = L.damage;
          const hud = refs.hud.current;
          if (hud.shields > 0) {
            const absorbed = Math.min(hud.shields, dmg);
            hud.shields -= absorbed;
            dmg -= absorbed;
          }
          hud.health -= dmg;
          spawnExplosion(refs, L.pos, "spark");
          L.active = false;
          if (hud.health <= 0) {
            hud.health = 0;
            hud.status = "dead";
            hud.message = "SHIP DESTROYED";
          }
          refs.setHud({ ...hud });
          continue;
        }
      } else {
        // Hit robot?
        let hit = false;
        const robots = refs.robots;
        for (let r = 0; r < robots.length; r++) {
          const R = robots[r]!;
          if (!R.alive) continue;
          if (L.pos.distanceToSquared(R.pos) < 1.8 * 1.8) {
            R.hp -= 25;
            spawnExplosion(refs, L.pos, "spark");
            if (R.hp <= 0) {
              R.alive = false;
              spawnExplosion(refs, R.pos, "robot");
              for (let dpi = 0; dpi < DEBRIS_PER_DEATH; dpi++) {
                spawnDebris(refs, R.pos, R.kind);
              }
              const hud = refs.hud.current;
              hud.score += ROBOT_ARCHETYPES[R.kind].scoreValue;
              hud.enemiesLeft -= 1;
              if (!hud.reactorAlive && hud.enemiesLeft <= 0) {
                hud.status = "won";
                hud.message = "MINE CLEARED";
              }
              refs.setHud({ ...hud });
            }
            hit = true;
            break;
          }
        }
        // Hit reactor?
        if (!hit && refs.hud.current.reactorAlive) {
          if (L.pos.distanceToSquared(refs.level.reactor) < 3.5 * 3.5) {
            const hud = refs.hud.current;
            hud.score += 25;
            spawnExplosion(refs, L.pos, "spark");
            (refs.level as any).reactorHp = ((refs.level as any).reactorHp ?? 200) - 25;
            if ((refs.level as any).reactorHp <= 0) {
              hud.reactorAlive = false;
              spawnExplosion(refs, refs.level.reactor, "reactor");
              hud.score += 1000;
              if (hud.enemiesLeft <= 0) {
                hud.status = "won";
                hud.message = "REACTOR DESTROYED — MINE COLLAPSING";
              }
            }
            refs.setHud({ ...hud });
            hit = true;
          }
        }
        if (hit) { L.active = false; continue; }
      }

      // Wall-edge kill
      const lx = L.pos.x - cx * CELL;
      const ly = L.pos.y - cy * CELL;
      const lz = L.pos.z - cz * CELL;
      const H = CELL / 2;
      if ((lx > H && !cell.open.px) || (lx < -H && !cell.open.nx) ||
          (ly > H && !cell.open.py) || (ly < -H && !cell.open.ny) ||
          (lz > H && !cell.open.pz) || (lz < -H && !cell.open.nz)) {
        spawnExplosion(refs, L.pos, "spark");
        L.active = false;
      }
    }

    // Robot AI: patrol corridors, pursue when LOS or short BFS path to player.
    const robots = refs.robots;
    const pcx = Math.round(refs.shipPos.x / CELL);
    const pcy = Math.round(refs.shipPos.y / CELL);
    const pcz = Math.round(refs.shipPos.z / CELL);
    for (let i = 0; i < robots.length; i++) {
      const r = robots[i]!;
      if (!r.alive) continue;
      r.bobPhase += d;
      r.fireCooldown -= d;
      r.aiTimer -= d;
      r.strafeTimer -= d;

      const arch = ROBOT_ARCHETYPES[r.kind];
      const rcx = Math.round(r.pos.x / CELL);
      const rcy = Math.round(r.pos.y / CELL);
      const rcz = Math.round(r.pos.z / CELL);

      // Periodically (or when waypoint reached) decide mode + pick a target cell.
      const reachedTarget =
        !r.targetCell ||
        (r.targetCell[0] === rcx && r.targetCell[1] === rcy && r.targetCell[2] === rcz);
      if (r.aiTimer <= 0 || reachedTarget) {
        r.aiTimer = 0.4 + Math.random() * 0.3;

        const losDist = losAxisAligned(refs.level, rcx, rcy, rcz, pcx, pcy, pcz);
        let nextStep: [number, number, number] | null = null;
        if (losDist >= 0 && losDist <= arch.losChaseRange) {
          const dx = pcx === rcx ? 0 : pcx > rcx ? 1 : -1;
          const dy = pcy === rcy ? 0 : pcy > rcy ? 1 : -1;
          const dz = pcz === rcz ? 0 : pcz > rcz ? 1 : -1;
          // Close-range evasion: backstep or sidestep instead of marching in.
          if (losDist <= 3 && Math.random() < 0.5) {
            const nbrs = neighborCells(refs.level, rcx, rcy, rcz);
            // Backstep toward the cell we came from, if it's still a neighbor.
            if (
              r.lastCell &&
              Math.random() < 0.45 &&
              nbrs.some(
                (n) =>
                  n[0] === r.lastCell![0] &&
                  n[1] === r.lastCell![1] &&
                  n[2] === r.lastCell![2],
              )
            ) {
              nextStep = r.lastCell;
            } else {
              // Sidestep: any neighbor that isn't the direct approach toward player.
              const sides = nbrs.filter((n) => {
                const ndx = n[0] - rcx, ndy = n[1] - rcy, ndz = n[2] - rcz;
                return !(ndx === dx && ndy === dy && ndz === dz);
              });
              if (sides.length > 0) {
                nextStep = sides[Math.floor(Math.random() * sides.length)]!;
              }
            }
          }
          if (!nextStep && (dx || dy || dz)) nextStep = [rcx + dx, rcy + dy, rcz + dz];
          r.mode = "chase";
        } else {
          // Try short BFS to player.
          const step = bfsNextStep(refs.level, rcx, rcy, rcz, pcx, pcy, pcz, arch.bfsBudget);
          if (step) {
            nextStep = step;
            r.mode = "chase";
          } else {
            r.mode = "patrol";
          }
        }

        if (r.mode === "patrol" || !nextStep) {
          // Pick a random open neighbor; avoid backtracking when possible.
          const nbrs = neighborCells(refs.level, rcx, rcy, rcz);
          if (nbrs.length > 0) {
            let pool = nbrs;
            if (r.lastCell && nbrs.length > 1) {
              const filtered = nbrs.filter(
                (n) => !(n[0] === r.lastCell![0] && n[1] === r.lastCell![1] && n[2] === r.lastCell![2]),
              );
              if (filtered.length > 0) pool = filtered;
            }
            nextStep = pool[Math.floor(Math.random() * pool.length)]!;
          }
        }

        if (reachedTarget) r.lastCell = [rcx, rcy, rcz];
        r.targetCell = nextStep;
      }

      // Refresh strafe offset so the robot drifts within its target cell instead
      // of marching dead-center. Bigger jukes when chasing.
      if (r.strafeTimer <= 0) {
        if (r.mode === "chase") {
          r.strafeTimer = 0.35 + Math.random() * 0.45;
          const mag = 5.5;
          r.cellOffset.set(
            (Math.random() * 2 - 1) * mag,
            (Math.random() * 2 - 1) * mag * 0.6,
            (Math.random() * 2 - 1) * mag,
          );
        } else {
          r.strafeTimer = 0.8 + Math.random() * 0.6;
          r.cellOffset.set(0, 0, 0);
        }
      }

      // Move toward the current target cell center, biased by the strafe offset.
      if (r.targetCell) {
        _vt.set(
          r.targetCell[0] * CELL + r.cellOffset.x,
          r.targetCell[1] * CELL + r.cellOffset.y,
          r.targetCell[2] * CELL + r.cellOffset.z,
        ).sub(r.pos);
        const stepDist = _vt.length();
        if (stepDist > 0.0001) {
          const speed = r.mode === "chase" ? arch.chaseSpeed : arch.patrolSpeed;
          const move = Math.min(stepDist, speed * d);
          _vPrev.copy(r.pos);
          r.pos.addScaledVector(_vt, move / stepDist);
          // Respect walls — clamp against the cell we ended up in.
          const clamped = clampToLevel(refs.level, r.pos, _vPrev);
          if (!clamped.equals(r.pos)) r.pos.copy(clamped);
        }
      }

      // Fire when same cell or with axis-aligned LOS.
      if (r.fireCooldown <= 0) {
        _vu.copy(refs.shipPos).sub(r.pos);
        const distToPlayer = _vu.length();
        if (distToPlayer < arch.fireRange) {
          const sameCell = rcx === pcx && rcy === pcy && rcz === pcz;
          const losD = sameCell ? 0 : losAxisAligned(refs.level, rcx, rcy, rcz, pcx, pcy, pcz);
          if (sameCell || losD >= 0) {
            r.fireCooldown = arch.fireMin + Math.random() * (arch.fireMax - arch.fireMin);
            _vu.normalize();
            _vt.copy(r.pos).addScaledVector(_vu, 1.5);
            spawnLaser(refs, _vt, _vu, true, arch.laserSpeed, arch.damage);
          } else {
            r.fireCooldown = 0.5;
          }
        }
      }
    }
  });

  return null;
}

function ShipBody({ refs }: { refs: SharedRefs }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (refs.paused.current) return;
    if (!ref.current) return;
    _vu.set(0, 0, -1).applyQuaternion(refs.shipQuat);
    ref.current.position.copy(refs.shipPos).addScaledVector(_vu, 0.4);
    ref.current.quaternion.copy(refs.shipQuat);
  });
  return (
    <group ref={ref}>
      <mesh geometry={SHIP_RING_GEO} material={SHIP_RING_MAT} />
    </group>
  );
}

function DustField() {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const N = 600;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({
    color: "#ffaa66",
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const { camera } = useThree();
  useFrame(() => {
    if (ref.current) {
      ref.current.position.copy(camera.position);
    }
  });
  return <points ref={ref} geometry={geo} material={mat} />;
}

// Note: DustField follows the camera, which is itself frozen during pause
// (ShipController early-returns), so dust positions naturally don't advance.

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function Game() {
  const [webglOk] = useState(() => hasWebGL());
  if (!webglOk) {
    const href = typeof window !== "undefined" ? window.location.href : "#";
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black p-8 text-center text-orange-200">
        <h1 className="mb-4 text-3xl font-black tracking-[0.3em] text-orange-400">
          DEEP MINE
        </h1>
        <p className="mb-2 max-w-md text-sm text-orange-200/80">
          This 3D game needs WebGL, which is disabled in this embedded preview pane.
        </p>
        <p className="mb-6 max-w-md text-sm text-orange-200/80">
          Open it in a real browser tab to play.
        </p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-orange-400/70 bg-orange-500/10 px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-orange-200 transition hover:bg-orange-500/30 hover:text-orange-50"
        >
          OPEN IN NEW TAB
        </a>
      </div>
    );
  }
  return <GameInner />;
}

let nextRobotId = 1;

// Deterministic mix of robot archetypes across spawn slots so each level has
// a varied roster (roughly 40% grunt, 30% scout, 15% turret, 15% sniper).
const ROBOT_KIND_MIX: RobotKind[] = [
  "grunt", "scout", "grunt", "turret",
  "scout", "grunt", "sniper", "scout",
  "grunt", "turret", "scout", "sniper",
  "grunt", "scout", "grunt", "turret",
  "scout", "sniper", "grunt", "scout",
];
function pickRobotKind(idx: number): RobotKind {
  return ROBOT_KIND_MIX[idx % ROBOT_KIND_MIX.length]!;
}

function GameInner() {
  const [hudState, setHudState] = useState<GameState>(initialState);
  const hudRef = useRef<GameState>(hudState);
  hudRef.current = hudState;
  const [mapOpen, setMapOpen] = useState(false);
  const mapOpenRef = useRef(false);
  mapOpenRef.current = mapOpen;
  const pausedRef = useRef(false);
  pausedRef.current = mapOpen;

  const level = useMemo(() => generateLevel(Math.floor(Math.random() * 99999) + 1), []);

  const refs = useMemo<SharedRefs>(() => {
    const robots: Robot[] = level.enemySpawns.map((p, idx) => {
      const kind = pickRobotKind(idx);
      return {
        id: nextRobotId++,
        kind,
        pos: p.clone(),
        hp: ROBOT_ARCHETYPES[kind].maxHp,
        fireCooldown: 1 + Math.random() * 2,
        bobPhase: Math.random() * 6.28,
        alive: true,
        mode: "patrol",
        targetCell: null,
        lastCell: null,
        aiTimer: Math.random() * 0.4,
        cellOffset: new THREE.Vector3(),
        strafeTimer: Math.random() * 0.5,
      };
    });
    const lasers: Laser[] = [];
    for (let i = 0; i < LASER_POOL_SIZE; i++) {
      lasers.push({
        id: i,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        hostile: false,
        active: false,
        damage: 0,
      });
    }
    const explosions: Explosion[] = [];
    for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
      explosions.push({
        active: false,
        pos: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        kind: "spark",
      });
    }
    const debris: Debris[] = [];
    for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
      debris.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        angAxis: new THREE.Vector3(0, 1, 0),
        angRate: 0,
        life: 0,
        maxLife: 1,
        geoIdx: 0,
        kind: "grunt",
        bornAt: 0,
      });
    }
    return {
      shipPos: level.start.clone(),
      shipQuat: new THREE.Quaternion(),
      shipVel: new THREE.Vector3(),
      lasers,
      robots,
      explosions,
      debris,
      level,
      setHud: setHudState,
      hud: hudRef,
      keys: new Set<string>(),
      mouse: { dx: 0, dy: 0, aimX: 0, aimY: 0, locked: false, firing: false },
      paused: pausedRef,
    };
  }, [level]);

  useEffect(() => {
    setHudState((s) => ({ ...s, enemiesLeft: refs.robots.length }));
  }, [refs]);

  // Single source of truth for opening/closing the map. Always clears input
  // state on both edges (open and close) so held keys / pending mouse delta
  // don't leak across the pause boundary.
  const setMapOpenWithReset = (next: boolean | ((prev: boolean) => boolean)) => {
    setMapOpen((prev) => {
      const nv = typeof next === "function" ? next(prev) : next;
      refs.keys.clear();
      refs.mouse.firing = false;
      refs.mouse.dx = 0;
      refs.mouse.dy = 0;
      refs.mouse.aimX = 0;
      refs.mouse.aimY = 0;
      if (nv && document.pointerLockElement) document.exitPointerLock();
      return nv;
    });
  };

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === "Tab" && hudRef.current.status === "playing") {
        setMapOpenWithReset((m) => !m);
        return;
      }
      if (mapOpenRef.current) return;
      refs.keys.add(e.code);
    };
    const ku = (e: KeyboardEvent) => {
      refs.keys.delete(e.code);
    };
    const md = (e: MouseEvent) => { if (e.button === 0) refs.mouse.firing = true; };
    const mu = (e: MouseEvent) => { if (e.button === 0) refs.mouse.firing = false; };
    const mm = (e: MouseEvent) => {
      if (refs.mouse.locked) {
        refs.mouse.dx += e.movementX;
        refs.mouse.dy += e.movementY;
        return;
      }
      if (mapOpenRef.current) return;
      const canvas = document.querySelector("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom
      ) {
        refs.mouse.aimX = 0;
        refs.mouse.aimY = 0;
        return;
      }
      const nx = (e.clientX - rect.left) / rect.width  * 2 - 1;
      const ny = (e.clientY - rect.top)  / rect.height * 2 - 1;
      refs.mouse.aimX = Math.max(-1, Math.min(1, nx));
      refs.mouse.aimY = Math.max(-1, Math.min(1, ny));
    };
    const clearAll = () => {
      refs.keys.clear();
      refs.mouse.firing = false;
      refs.mouse.dx = 0;
      refs.mouse.dy = 0;
      refs.mouse.aimX = 0;
      refs.mouse.aimY = 0;
    };
    const pl = () => {
      refs.mouse.locked = document.pointerLockElement !== null;
      if (!refs.mouse.locked) clearAll();
    };
    const blur = () => clearAll();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("mousemove", mm);
    document.addEventListener("pointerlockchange", pl);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("mousemove", mm);
      document.removeEventListener("pointerlockchange", pl);
      window.removeEventListener("blur", blur);
    };
  }, [refs]);

  const startGame = () => {
    setHudState({
      status: "playing",
      health: 100,
      shields: 100,
      score: 0,
      enemiesLeft: refs.robots.length,
      reactorAlive: true,
      message: "",
    });
    refs.shipPos.copy(level.start);
    refs.shipQuat.identity();
    refs.shipVel.set(0, 0, 0);
    for (let i = 0; i < refs.lasers.length; i++) refs.lasers[i]!.active = false;
    for (let i = 0; i < refs.explosions.length; i++) refs.explosions[i]!.active = false;
    clearAllDebris(refs);
    refs.robots.forEach((r, i) => {
      r.alive = true;
      r.hp = ROBOT_ARCHETYPES[r.kind].maxHp;
      r.pos.copy(level.enemySpawns[i]!);
      r.mode = "patrol";
      r.targetCell = null;
      r.lastCell = null;
      r.aiTimer = Math.random() * 0.4;
      r.fireCooldown = 1 + Math.random() * 2;
      r.cellOffset.set(0, 0, 0);
      r.strafeTimer = Math.random() * 0.5;
    });
    (level as any).reactorHp = 200;
  };

  return (
    <div
      className="absolute inset-0"
      onClick={() => {
        if (hudRef.current.status !== "playing" || mapOpenRef.current) return;
        if (document.pointerLockElement) return;
        const el = document.querySelector("canvas") as HTMLCanvasElement | null;
        el?.requestPointerLock?.();
      }}
    >
      <Canvas
        camera={{ fov: 78, near: 0.1, far: 600, position: [0, 0, 0] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(new THREE.Color("#04030a"));
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.25;
          scene.fog = new THREE.FogExp2(0x0a0810, 0.012);
        }}
      >
        <ambientLight intensity={0.45} color="#5a4a55" />
        <hemisphereLight args={["#a06840", "#1a1820", 0.6]} />
        <LevelMesh level={level} />
        <DustField />
        <ShipController refs={refs} />
        <ShipBody refs={refs} />
        <GameLoop refs={refs} />
        <LaserPool refs={refs} />
        <RobotPool refs={refs} />
        <ExplosionPool refs={refs} />
        <DebrisPool refs={refs} />
        <Headlight refs={refs} />
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={0.9}
            luminanceThreshold={0.7}
            luminanceSmoothing={0.4}
            mipmapBlur
            radius={0.7}
          />
          <ChromaticAberration
            offset={new THREE.Vector2(0.0008, 0.0012)}
            blendFunction={BlendFunction.NORMAL}
            radialModulation={false}
            modulationOffset={0}
          />
          <Vignette eskil={false} offset={0.2} darkness={0.85} />
        </EffectComposer>
      </Canvas>
      <Hud
        state={hudState}
        onStart={startGame}
      />
      {hudState.status === "playing" && !mapOpen && (
        <MiniRadar refs={refs} />
      )}
      {mapOpen && hudState.status === "playing" && (
        <MapView
          level={level}
          shipPos={refs.shipPos}
          shipQuat={refs.shipQuat}
          robots={refs.robots}
          onClose={() => setMapOpenWithReset(false)}
        />
      )}
    </div>
  );
}

function Headlight({ refs }: { refs: SharedRefs }) {
  const ref = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(new THREE.Object3D());
  const { scene } = useThree();
  useEffect(() => {
    scene.add(targetRef.current);
    if (ref.current) ref.current.target = targetRef.current;
    return () => { scene.remove(targetRef.current); };
  }, [scene]);
  useFrame(() => {
    if (refs.paused.current) return;
    if (!ref.current) return;
    ref.current.position.copy(refs.shipPos);
    _vu.set(0, 0, -1).applyQuaternion(refs.shipQuat);
    targetRef.current.position.copy(refs.shipPos).addScaledVector(_vu, 20);
  });
  return (
    <spotLight
      ref={ref}
      color="#ffe0b8"
      intensity={90}
      distance={80}
      angle={1.1}
      penumbra={0.55}
      decay={1.3}
    />
  );
}

function MiniRadar({ refs }: { refs: SharedRefs }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const SIZE = 180;
    const R = SIZE / 2;
    const WORLD_R = 90;
    const scale = R / WORLD_R;
    const yWindow = CELL * 1.5;
    const fwd = new THREE.Vector3();

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      if (refs.hud.current.status !== "playing") {
        ctx.clearRect(0, 0, SIZE, SIZE);
        return;
      }

      const sp = refs.shipPos;
      fwd.set(0, 0, -1).applyQuaternion(refs.shipQuat);
      const yaw = Math.atan2(fwd.x, -fwd.z);
      const c = Math.cos(-yaw);
      const s = Math.sin(-yaw);

      const proj = (wx: number, wz: number): [number, number] => {
        const dx = wx - sp.x;
        const dz = wz - sp.z;
        const rx = dx * c - dz * s;
        const rz = dx * s + dz * c;
        return [R + rx * scale, R + rz * scale];
      };

      ctx.clearRect(0, 0, SIZE, SIZE);

      // Background disc
      ctx.fillStyle = "rgba(8, 12, 16, 0.65)";
      ctx.beginPath();
      ctx.arc(R, R, R - 1, 0, Math.PI * 2);
      ctx.fill();

      // Clip to circle for level content
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 2, 0, Math.PI * 2);
      ctx.clip();

      // Rooms — top-down slice near ship Y
      for (const room of refs.level.rooms) {
        const minY = room.min[1] * CELL - HALF;
        const maxY = room.max[1] * CELL + HALF;
        if (sp.y < minY - yWindow || sp.y > maxY + yWindow) continue;
        const minX = room.min[0] * CELL - HALF;
        const maxX = room.max[0] * CELL + HALF;
        const minZ = room.min[2] * CELL - HALF;
        const maxZ = room.max[2] * CELL + HALF;
        const p0 = proj(minX, minZ);
        const p1 = proj(maxX, minZ);
        const p2 = proj(maxX, maxZ);
        const p3 = proj(minX, maxZ);
        const color =
          room.kind === "reactor" ? "#ff3344" :
          room.kind === "hub" ? "#ff8a3a" : "#7a55ff";
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Corridors — thin connector lines
      ctx.strokeStyle = "#3a8acc";
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      for (const cor of refs.level.corridors) {
        for (let i = 0; i < cor.path.length - 1; i++) {
          const a = cor.path[i]!;
          const b = cor.path[i + 1]!;
          const ay = a[1] * CELL;
          const by = b[1] * CELL;
          if ((sp.y < ay - yWindow && sp.y < by - yWindow) ||
              (sp.y > ay + yWindow && sp.y > by + yWindow)) continue;
          const pa = proj(a[0] * CELL, a[2] * CELL);
          const pb = proj(b[0] * CELL, b[2] * CELL);
          ctx.beginPath();
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Robots within radar range
      for (const rb of refs.robots) {
        if (!rb.alive) continue;
        const dx = rb.pos.x - sp.x;
        const dz = rb.pos.z - sp.z;
        if (Math.hypot(dx, dz) > WORLD_R) continue;
        const dy = rb.pos.y - sp.y;
        const [px, py] = proj(rb.pos.x, rb.pos.z);
        ctx.fillStyle = "#ffcc22";
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        if (Math.abs(dy) > CELL * 0.7) {
          ctx.strokeStyle = "#ffcc22";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + (dy > 0 ? -6 : 6));
          ctx.stroke();
        }
      }

      // Reactor — always visible; clamp to edge if out of range.
      // Even after destruction, keep showing direction so players can find
      // the wrecked reactor chamber.
      {
        const alive = refs.hud.current.reactorAlive;
        const rx = refs.level.reactor.x - sp.x;
        const rz = refs.level.reactor.z - sp.z;
        const rrx = rx * c - rz * s;
        const rrz = rx * s + rz * c;
        const distPx = Math.hypot(rrx, rrz) * scale;
        let sx: number, sy: number, edge = false;
        if (distPx <= R - 10) {
          sx = R + rrx * scale;
          sy = R + rrz * scale;
        } else {
          const k = (R - 12) / distPx;
          sx = R + rrx * scale * k;
          sy = R + rrz * scale * k;
          edge = true;
        }
        const pulse = alive ? 0.65 + 0.35 * Math.sin(performance.now() * 0.008) : 0.5;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = alive ? "#ff3344" : "#6a6a72";
        ctx.beginPath();
        ctx.arc(sx, sy, edge ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (edge) {
          const ang = Math.atan2(rrz, rrx);
          ctx.strokeStyle = alive ? "#ff5566" : "#8a8a92";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(ang) * 8, sy + Math.sin(ang) * 8);
          ctx.stroke();
        }
      }

      ctx.restore();

      // Crosshair lines
      ctx.strokeStyle = "rgba(255, 138, 58, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(R, 4); ctx.lineTo(R, SIZE - 4);
      ctx.moveTo(4, R); ctx.lineTo(SIZE - 4, R);
      ctx.stroke();

      // Ship marker — triangle pointing up (ship forward)
      ctx.fillStyle = "#aaffbb";
      ctx.strokeStyle = "#0a1a14";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(R, R - 8);
      ctx.lineTo(R - 5, R + 5);
      ctx.lineTo(R + 5, R + 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Outer ring
      ctx.strokeStyle = "rgba(255, 138, 58, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(R, R, R - 1, 0, Math.PI * 2);
      ctx.stroke();
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [refs]);

  return (
    <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-orange-500/40 bg-black/40 shadow-lg">
      <canvas ref={canvasRef} width={180} height={180} className="block rounded-full" />
    </div>
  );
}

function Hud({ state, onStart }: { state: GameState; onStart: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {state.status === "playing" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-10 w-10">
            <div className="absolute left-1/2 top-1/2 h-[1px] w-6 -translate-x-1/2 -translate-y-1/2 bg-orange-400/80" />
            <div className="absolute left-1/2 top-1/2 h-6 w-[1px] -translate-x-1/2 -translate-y-1/2 bg-orange-400/80" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-400/70" />
          </div>
        </div>
      )}

      {state.status !== "menu" && (
        <>
          <div className="absolute left-4 bottom-4 w-72 rounded border border-orange-500/40 bg-black/60 p-3 text-xs uppercase tracking-widest text-orange-200">
            <div className="mb-1 flex justify-between">
              <span>Hull</span><span>{state.health}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-orange-950">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-orange-400 transition-[width]"
                style={{ width: `${state.health}%` }}
              />
            </div>
            <div className="mt-2 mb-1 flex justify-between">
              <span>Shields</span><span>{state.shields}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-orange-950">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-sky-300 transition-[width]"
                style={{ width: `${state.shields}%` }}
              />
            </div>
          </div>
          <div className="absolute right-4 bottom-4 rounded border border-orange-500/40 bg-black/60 p-3 text-right text-xs uppercase tracking-widest text-orange-200">
            <div>Score <span className="ml-2 text-orange-300">{state.score}</span></div>
            <div>Robots <span className="ml-2 text-orange-300">{state.enemiesLeft}</span></div>
            <div>Reactor <span className="ml-2 text-orange-300">{state.reactorAlive ? "ONLINE" : "DESTROYED"}</span></div>
          </div>
        </>
      )}

      {state.status === "menu" && (
        <Overlay>
          <h1 className="mb-3 text-4xl font-black tracking-[0.3em] text-orange-400">
            DEEP MINE
          </h1>
          <p className="mb-6 max-w-md text-center text-sm text-orange-200/80">
            Six degrees of freedom. Hostile robots. One reactor.
            Destroy every bot, blow the reactor, and get out.
          </p>
          <Controls />
          <Button onClick={onStart}>LAUNCH SHIP</Button>
          <p className="mt-4 text-[10px] uppercase tracking-widest text-orange-200/50">
            Original game inspired by classic 6DOF tunnel shooters.
          </p>
        </Overlay>
      )}
      {state.status === "dead" && (
        <Overlay>
          <h1 className="mb-3 text-4xl font-black tracking-[0.3em] text-red-500">
            DESTROYED
          </h1>
          <p className="mb-6 text-orange-200/80">Final score: {state.score}</p>
          <Button onClick={onStart}>RESPAWN</Button>
        </Overlay>
      )}
      {state.status === "won" && (
        <Overlay>
          <h1 className="mb-3 text-4xl font-black tracking-[0.3em] text-emerald-400">
            MINE CLEARED
          </h1>
          <p className="mb-6 text-orange-200/80">Final score: {state.score}</p>
          <Button onClick={onStart}>NEXT MINE</Button>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur">
      {children}
    </div>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-orange-400/70 bg-orange-500/10 px-6 py-3 text-sm font-bold uppercase tracking-[0.3em] text-orange-200 transition hover:bg-orange-500/30 hover:text-orange-50"
    >
      {children}
    </button>
  );
}

function Controls() {
  const Row = ({ k, label }: { k: string; label: string }) => (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="rounded border border-orange-400/40 bg-black/60 px-2 py-1 font-mono text-orange-200">
        {k}
      </span>
      <span className="text-orange-200/80">{label}</span>
    </div>
  );
  return (
    <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-2 rounded border border-orange-400/30 bg-black/40 p-4">
      <Row k="W / S" label="Thrust fwd / back" />
      <Row k="A / D" label="Strafe left / right" />
      <Row k="Shift + W / S" label="Strafe up / down" />
      <Row k="Mouse" label="Pitch & yaw (free-aim)" />
      <Row k="Click canvas" label="Lock mouse for FPS look" />
      <Row k="Q / E" label="Roll left / right" />
      <Row k="Arrows" label="Pitch & yaw (kbd)" />
      <Row k="Click / Space" label="Fire lasers" />
      <Row k="Tab" label="Toggle automap" />
      <Row k="Esc" label="Release mouse" />
    </div>
  );
}
