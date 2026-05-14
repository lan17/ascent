import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { LevelMesh } from "./LevelMesh";
import { MapView } from "./MapView";
import { clampToLevel, generateLevel, key, CELL, type Level } from "./level";
import { initialState, type GameState, type Laser, type Robot } from "./gameStore";

type SharedRefs = {
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  shipVel: THREE.Vector3;
  lasers: Laser[];
  robots: Robot[];
  level: Level;
  setHud: React.Dispatch<React.SetStateAction<GameState>>;
  hud: React.MutableRefObject<GameState>;
  keys: Set<string>;
  mouse: {
    dx: number; dy: number; // relative movement (used when pointer-locked)
    aimX: number; aimY: number; // -1..1 offset from canvas center (used when free)
    locked: boolean;
    firing: boolean;
  };
};

let nextLaserId = 1;
let nextRobotId = 1;

function spawnLaser(refs: SharedRefs, pos: THREE.Vector3, dir: THREE.Vector3, hostile: boolean) {
  refs.lasers.push({
    id: nextLaserId++,
    pos: pos.clone(),
    vel: dir.clone().normalize().multiplyScalar(hostile ? 60 : 110),
    life: 2.0,
    hostile,
  });
}

function ShipController({ refs }: { refs: SharedRefs }) {
  const { camera } = useThree();
  const fireCooldown = useRef(0);

  useFrame((_, dt) => {
    if (refs.hud.current.status !== "playing") return;
    const d = Math.min(dt, 0.05);

    // --- Orientation ---
    const q = refs.shipQuat;
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

    // Mouse pitch/yaw
    let yaw = 0;
    let pitch = 0;
    if (refs.mouse.locked) {
      // Mouse-look: accumulated relative motion since last frame.
      const sens = 0.0025;
      yaw = -refs.mouse.dx * sens;
      pitch = -refs.mouse.dy * sens;
      refs.mouse.dx = 0;
      refs.mouse.dy = 0;
    } else {
      // Free-aim: cursor position over canvas → continuous turn rate.
      // Small center deadzone so resting the cursor doesn't drift the ship.
      const DEAD = 0.08;
      const MAX_RATE = 2.2; // rad/sec at edge
      const applyAxis = (v: number) => {
        const m = Math.abs(v);
        if (m < DEAD) return 0;
        const t = (m - DEAD) / (1 - DEAD); // 0..1 outside deadzone
        return Math.sign(v) * t * t * MAX_RATE * d; // ease-in for fine control
      };
      yaw = -applyAxis(refs.mouse.aimX);
      pitch = -applyAxis(refs.mouse.aimY);
    }

    // Keyboard pitch/yaw if no pointer lock
    let kbYaw = 0, kbPitch = 0, kbRoll = 0;
    const k = refs.keys;
    if (k.has("ArrowLeft")) kbYaw += 1.4 * d;
    if (k.has("ArrowRight")) kbYaw -= 1.4 * d;
    if (k.has("ArrowUp")) kbPitch += 1.4 * d;
    if (k.has("ArrowDown")) kbPitch -= 1.4 * d;
    if (k.has("KeyQ")) kbRoll += 1.6 * d;
    if (k.has("KeyE")) kbRoll -= 1.6 * d;

    const dq = new THREE.Quaternion();
    dq.setFromAxisAngle(localY, yaw + kbYaw);
    q.premultiply(dq);
    dq.setFromAxisAngle(localX, pitch + kbPitch);
    q.premultiply(dq);
    dq.setFromAxisAngle(localZ, kbRoll);
    q.premultiply(dq);
    q.normalize();

    // --- Thrust ---
    const accel = 70;
    const thrust = new THREE.Vector3();
    if (k.has("KeyW")) thrust.addScaledVector(localZ, -1);
    if (k.has("KeyS")) thrust.addScaledVector(localZ, 1);
    if (k.has("KeyA")) thrust.addScaledVector(localX, -1);
    if (k.has("KeyD")) thrust.addScaledVector(localX, 1);
    if (k.has("ShiftLeft") || k.has("ShiftRight")) thrust.addScaledVector(localY, 1);
    if (k.has("ControlLeft") || k.has("ControlRight")) thrust.addScaledVector(localY, -1);
    if (thrust.lengthSq() > 0) thrust.normalize().multiplyScalar(accel);
    refs.shipVel.addScaledVector(thrust, d);

    // damping (no atmosphere drag, just gentle)
    refs.shipVel.multiplyScalar(Math.pow(0.18, d));
    const maxSpeed = 28;
    if (refs.shipVel.length() > maxSpeed) refs.shipVel.setLength(maxSpeed);

    const prev = refs.shipPos.clone();
    refs.shipPos.addScaledVector(refs.shipVel, d);
    const clamped = clampToLevel(refs.level, refs.shipPos, prev);
    if (!clamped.equals(refs.shipPos)) {
      // dampen velocity component into wall
      const diff = clamped.clone().sub(refs.shipPos);
      if (Math.abs(diff.x) > 0.0001) refs.shipVel.x = 0;
      if (Math.abs(diff.y) > 0.0001) refs.shipVel.y = 0;
      if (Math.abs(diff.z) > 0.0001) refs.shipVel.z = 0;
      refs.shipPos.copy(clamped);
    }

    // --- Camera ---
    camera.position.copy(refs.shipPos);
    camera.quaternion.copy(refs.shipQuat);

    // --- Fire ---
    fireCooldown.current -= d;
    if ((k.has("Space") || refs.mouse.firing) && fireCooldown.current <= 0) {
      fireCooldown.current = 0.16;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      // twin cannons offset
      const right = localX.clone().multiplyScalar(0.6);
      const down = localY.clone().multiplyScalar(-0.3);
      const base = refs.shipPos.clone().add(down).add(fwd.clone().multiplyScalar(1.5));
      spawnLaser(refs, base.clone().add(right), fwd, false);
      spawnLaser(refs, base.clone().sub(right), fwd, false);
    }
  });

  return null;
}

function LaserMesh({ laser }: { laser: Laser }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.position.copy(laser.pos);
      ref.current.lookAt(laser.pos.clone().add(laser.vel));
      ref.current.rotateX(Math.PI / 2);
    }
  });
  const color = laser.hostile ? "#33ff88" : "#ff3a55";
  const glow = laser.hostile ? "#88ffaa" : "#ffaaaa";
  return (
    <group ref={ref}>
      {/* Bright inner core */}
      <mesh>
        <cylinderGeometry args={[0.08, 0.08, 1.8, 6]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      {/* Outer additive halo */}
      <mesh>
        <cylinderGeometry args={[0.28, 0.28, 1.8, 6]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight color={color} intensity={1.4} distance={6} decay={2} />
    </group>
  );
}

function RobotMesh({ robot }: { robot: Robot }) {
  const ref = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const eyeRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime + robot.bobPhase;
    if (ref.current) {
      ref.current.position.copy(robot.pos);
      ref.current.rotation.y = t * 0.6;
    }
    if (ringRef.current) {
      ringRef.current.rotation.x = t * 1.4;
      ringRef.current.rotation.z = t * 0.9;
    }
    if (eyeRef.current) {
      const m = eyeRef.current.material as THREE.MeshBasicMaterial;
      const pulse = 0.7 + Math.sin(t * 6) * 0.3;
      (m.color as THREE.Color).setRGB(0.2 * pulse, 1.0 * pulse, 0.45 * pulse);
    }
  });
  if (!robot.alive) return null;
  return (
    <group ref={ref}>
      {/* Hull — faceted body */}
      <mesh>
        <octahedronGeometry args={[1.4, 0]} />
        <meshStandardMaterial
          color="#7a8392"
          emissive="#0a1018"
          emissiveIntensity={0.4}
          metalness={0.85}
          roughness={0.35}
          flatShading
        />
      </mesh>
      {/* Belt of armor plates */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.05, 0.18, 8, 16]} />
        <meshStandardMaterial
          color="#3a3540"
          metalness={0.95}
          roughness={0.25}
          flatShading
        />
      </mesh>
      {/* Spinning targeting ring */}
      <mesh ref={ringRef}>
        <torusGeometry args={[1.7, 0.05, 6, 32]} />
        <meshStandardMaterial
          color="#33ff88"
          emissive="#33ff88"
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </mesh>
      {/* Glowing eye */}
      <mesh ref={eyeRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color="#33ff88" toneMapped={false} />
      </mesh>
      {/* Halo glow */}
      <mesh>
        <sphereGeometry args={[0.85, 12, 12]} />
        <meshBasicMaterial
          color="#33ff88"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight color="#33ff88" intensity={1.2} distance={9} decay={2} />
    </group>
  );
}

function GameLoop({ refs, version }: { refs: SharedRefs; version: number }) {
  const [, setTick] = useState(0);
  void version;

  useFrame((_, dt) => {
    if (refs.hud.current.status !== "playing") return;
    const d = Math.min(dt, 0.05);

    // Move lasers, collide with walls + entities
    for (let i = refs.lasers.length - 1; i >= 0; i--) {
      const L = refs.lasers[i]!;
      L.life -= d;
      L.pos.addScaledVector(L.vel, d);
      if (L.life <= 0) { refs.lasers.splice(i, 1); continue; }

      // Wall collision: clamp; if it moved, kill
      const cx = Math.round(L.pos.x / CELL);
      const cy = Math.round(L.pos.y / CELL);
      const cz = Math.round(L.pos.z / CELL);
      const cell = refs.level.cells.get(key(cx, cy, cz));
      if (!cell) { refs.lasers.splice(i, 1); continue; }

      // Hit player?
      if (L.hostile) {
        const distSq = L.pos.distanceToSquared(refs.shipPos);
        if (distSq < 1.6 * 1.6) {
          let dmg = 12;
          const hud = refs.hud.current;
          if (hud.shields > 0) {
            const absorbed = Math.min(hud.shields, dmg);
            hud.shields -= absorbed;
            dmg -= absorbed;
          }
          hud.health -= dmg;
          refs.lasers.splice(i, 1);
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
        for (const r of refs.robots) {
          if (!r.alive) continue;
          if (L.pos.distanceToSquared(r.pos) < 1.8 * 1.8) {
            r.hp -= 25;
            if (r.hp <= 0) {
              r.alive = false;
              const hud = refs.hud.current;
              hud.score += 100;
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
            // reactor takes hits — track via score-style hp on hud message
            (refs.level as any).reactorHp = ((refs.level as any).reactorHp ?? 200) - 25;
            if ((refs.level as any).reactorHp <= 0) {
              hud.reactorAlive = false;
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
        if (hit) { refs.lasers.splice(i, 1); continue; }
      }

      // Wall-edge kill: if outside playable cell volume on a closed face
      const lx = L.pos.x - cx * CELL;
      const ly = L.pos.y - cy * CELL;
      const lz = L.pos.z - cz * CELL;
      const H = CELL / 2;
      if ((lx > H && !cell.open.px) || (lx < -H && !cell.open.nx) ||
          (ly > H && !cell.open.py) || (ly < -H && !cell.open.ny) ||
          (lz > H && !cell.open.pz) || (lz < -H && !cell.open.nz)) {
        refs.lasers.splice(i, 1);
      }
    }

    // Robot AI
    for (const r of refs.robots) {
      if (!r.alive) continue;
      r.bobPhase += d;
      // gentle bob
      r.pos.y += Math.sin(r.bobPhase * 1.2) * 0.04 * d * 30;
      r.fireCooldown -= d;
      const toPlayer = refs.shipPos.clone().sub(r.pos);
      const dist = toPlayer.length();
      if (dist < 28 && r.fireCooldown <= 0) {
        // line of sight: same cell as player or adjacent open cell
        const rcx = Math.round(r.pos.x / CELL);
        const rcy = Math.round(r.pos.y / CELL);
        const rcz = Math.round(r.pos.z / CELL);
        const pcx = Math.round(refs.shipPos.x / CELL);
        const pcy = Math.round(refs.shipPos.y / CELL);
        const pcz = Math.round(refs.shipPos.z / CELL);
        if (rcx === pcx && rcy === pcy && rcz === pcz) {
          r.fireCooldown = 1.4 + Math.random() * 0.8;
          const dir = toPlayer.normalize();
          spawnLaser(refs, r.pos.clone().add(dir.clone().multiplyScalar(1.5)), dir, true);
        } else {
          r.fireCooldown = 0.6;
        }
      }
    }

    // trigger render of HUD-less laser/robot meshes via state tick
    setTick((t) => (t + 1) % 1000000);
  });

  return (
    <>
      {refs.lasers.map((L) => <LaserMesh key={L.id} laser={L} />)}
      {refs.robots.map((R) => <RobotMesh key={R.id} robot={R} />)}
    </>
  );
}

function ShipBody({ refs }: { refs: SharedRefs }) {
  // Slim cockpit hint: a faint emissive ring "frame" rendered just in front of the camera.
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(refs.shipQuat);
    ref.current.position.copy(refs.shipPos).add(fwd.multiplyScalar(0.4));
    ref.current.quaternion.copy(refs.shipQuat);
  });
  return (
    <group ref={ref}>
      <mesh>
        <ringGeometry args={[0.08, 0.1, 24]} />
        <meshBasicMaterial color="#ff7a2e" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
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
  const { camera } = useThree();
  useFrame(() => {
    if (ref.current) {
      // keep dust field roughly around the camera
      ref.current.position.copy(camera.position);
    }
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial
        color="#ffaa66"
        size={0.08}
        sizeAttenuation
        transparent
        opacity={0.55}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

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

function GameInner() {
  const [hudState, setHudState] = useState<GameState>(initialState);
  const hudRef = useRef<GameState>(hudState);
  hudRef.current = hudState;
  const [mapOpen, setMapOpen] = useState(false);
  const mapOpenRef = useRef(false);
  mapOpenRef.current = mapOpen;

  const level = useMemo(() => generateLevel(Math.floor(Math.random() * 99999) + 1), []);

  const refs = useMemo<SharedRefs>(() => {
    const robots: Robot[] = level.enemySpawns.map((p) => ({
      id: nextRobotId++,
      pos: p.clone(),
      hp: 50,
      fireCooldown: 1 + Math.random() * 2,
      bobPhase: Math.random() * 6.28,
      alive: true,
    }));
    return {
      shipPos: level.start.clone(),
      shipQuat: new THREE.Quaternion(),
      shipVel: new THREE.Vector3(),
      lasers: [],
      robots,
      level,
      setHud: setHudState,
      hud: hudRef,
      keys: new Set<string>(),
      mouse: { dx: 0, dy: 0, aimX: 0, aimY: 0, locked: false, firing: false },
    };
  }, [level]);

  // Init enemies count
  useEffect(() => {
    setHudState((s) => ({ ...s, enemiesLeft: refs.robots.length }));
  }, [refs]);

  // Input handlers
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === "Tab" && hudRef.current.status === "playing") {
        setMapOpen((m) => {
          const next = !m;
          if (next) {
            refs.keys.clear();
            refs.mouse.firing = false;
            if (document.pointerLockElement) document.exitPointerLock();
          }
          return next;
        });
        return;
      }
      // Don't feed ship-control keys while map is open.
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
      // Free-aim mode: derive aim offset from cursor position over the game canvas.
      if (mapOpenRef.current) return;
      const canvas = document.querySelector("canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom
      ) {
        // cursor outside canvas: stop turning
        refs.mouse.aimX = 0;
        refs.mouse.aimY = 0;
        return;
      }
      const nx = (e.clientX - rect.left) / rect.width  * 2 - 1; // -1..1
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
    // reset world
    refs.shipPos.copy(level.start);
    refs.shipQuat.identity();
    refs.shipVel.set(0, 0, 0);
    refs.lasers.length = 0;
    refs.robots.forEach((r, i) => {
      r.alive = true;
      r.hp = 50;
      r.pos.copy(level.enemySpawns[i]!);
    });
    (level as any).reactorHp = 200;
    // Pointer lock is optional now — mouse turning works either way.
    // Don't auto-request; let the player opt in by clicking the canvas.
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
        <GameLoop refs={refs} version={hudState.status === "playing" ? 1 : 0} />
        {/* Headlight */}
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
      {mapOpen && hudState.status === "playing" && (
        <MapView
          level={level}
          shipPos={refs.shipPos}
          shipQuat={refs.shipQuat}
          robots={refs.robots}
          onClose={() => setMapOpen(false)}
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
    if (!ref.current) return;
    ref.current.position.copy(refs.shipPos);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(refs.shipQuat);
    targetRef.current.position.copy(refs.shipPos).add(fwd.multiplyScalar(20));
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

function Hud({ state, onStart }: { state: GameState; onStart: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {/* Crosshair */}
      {state.status === "playing" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-10 w-10">
            <div className="absolute left-1/2 top-1/2 h-[1px] w-6 -translate-x-1/2 -translate-y-1/2 bg-orange-400/80" />
            <div className="absolute left-1/2 top-1/2 h-6 w-[1px] -translate-x-1/2 -translate-y-1/2 bg-orange-400/80" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-400/70" />
          </div>
        </div>
      )}

      {/* HUD bars */}
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

      {/* Menus */}
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
      <Row k="Shift / Ctrl" label="Slide up / down" />
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
