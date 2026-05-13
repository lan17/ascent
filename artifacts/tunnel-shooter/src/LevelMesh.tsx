import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL, HALF, type Level } from "./level";

type Props = { level: Level };

type Junction = { pos: THREE.Vector3; color: THREE.Color; intensity: number };

export function LevelMesh({ level }: Props) {
  const { wallGeo, accentGeo, edgeGeo, panelGeo, junctions } = useMemo(() => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const accentPos: number[] = [];
    const accentNorm: number[] = [];
    const accentIdx: number[] = [];

    const panelPos: number[] = [];
    const panelNorm: number[] = [];
    const panelIdx: number[] = [];

    const edgePositions: number[] = [];
    const junctions: Junction[] = [];

    let vi = 0;
    let ai = 0;
    let pi = 0;

    const palette = [
      new THREE.Color("#7a3a18"),
      new THREE.Color("#5a2810"),
      new THREE.Color("#3a1a08"),
      new THREE.Color("#4a3020"),
      new THREE.Color("#2a1a14"),
    ];

    function quad(
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      n: THREE.Vector3, col: THREE.Color,
    ) {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
      for (let i = 0; i < 4; i++) {
        normals.push(n.x, n.y, n.z);
        colors.push(col.r, col.g, col.b);
      }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      edgePositions.push(
        a.x, a.y, a.z, b.x, b.y, b.z,
        b.x, b.y, b.z, c.x, c.y, c.z,
        c.x, c.y, c.z, d.x, d.y, d.z,
        d.x, d.y, d.z, a.x, a.y, a.z,
      );
      vi += 4;
    }

    // Inset accent strip on a wall: a thin emissive border just inside the face perimeter,
    // pushed slightly off the wall toward the cell interior so it reads as a glowing rim.
    function accentFrame(
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      n: THREE.Vector3,
    ) {
      const inset = 1.4;
      const off = 0.08;
      // Shrink toward face center
      const center = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
      const shrink = (v: THREE.Vector3, factor: number) =>
        v.clone().lerp(center, factor).addScaledVector(n, off);
      const A1 = shrink(a, 0); const B1 = shrink(b, 0);
      const C1 = shrink(c, 0); const D1 = shrink(d, 0);
      const k = inset / HALF; // fraction
      const A2 = shrink(a, k); const B2 = shrink(b, k);
      const C2 = shrink(c, k); const D2 = shrink(d, k);

      // 4 quads making a frame
      const frame = [
        [A1, B1, B2, A2],
        [B1, C1, C2, B2],
        [C1, D1, D2, C2],
        [D1, A1, A2, D2],
      ];
      for (const [P, Q, R, S] of frame) {
        accentPos.push(P!.x, P!.y, P!.z, Q!.x, Q!.y, Q!.z, R!.x, R!.y, R!.z, S!.x, S!.y, S!.z);
        for (let i = 0; i < 4; i++) accentNorm.push(n.x, n.y, n.z);
        accentIdx.push(ai, ai + 1, ai + 2, ai, ai + 2, ai + 3);
        ai += 4;
      }
    }

    // Decorative recessed panel in the center of a wall (slightly behind the wall plane,
    // a darker meshStandard, evokes Descent-style metal panels).
    function panel(
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      n: THREE.Vector3,
    ) {
      const inset = 3.2;
      const off = -0.18; // recessed
      const center = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
      const k = inset / HALF;
      const shrink = (v: THREE.Vector3) =>
        v.clone().lerp(center, k).addScaledVector(n, off);
      const A = shrink(a); const B = shrink(b); const C = shrink(c); const D = shrink(d);
      panelPos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, D.x, D.y, D.z);
      for (let i = 0; i < 4; i++) panelNorm.push(n.x, n.y, n.z);
      panelIdx.push(pi, pi + 1, pi + 2, pi, pi + 2, pi + 3);
      pi += 4;
    }

    // Junction palette
    const junctionColors = [
      new THREE.Color("#ff7a2e"),
      new THREE.Color("#ffaa44"),
      new THREE.Color("#ff5522"),
      new THREE.Color("#33ccff"),
      new THREE.Color("#88ddff"),
    ];
    let cellIdx = 0;
    for (const cell of level.cells.values()) {
      const ox = cell.x * CELL;
      const oy = cell.y * CELL;
      const oz = cell.z * CELL;
      const p = (sx: number, sy: number, sz: number) =>
        new THREE.Vector3(ox + sx * HALF, oy + sy * HALF, oz + sz * HALF);

      const cellTone = palette[(Math.abs(cell.x * 73 + cell.y * 31 + cell.z * 17)) % palette.length]!;

      // Place a junction light at any cell with 3+ openings — rooms feel atmospheric.
      const openCount =
        Number(cell.open.px) + Number(cell.open.nx) +
        Number(cell.open.py) + Number(cell.open.ny) +
        Number(cell.open.pz) + Number(cell.open.nz);
      if (openCount >= 3 || cellIdx % 4 === 0) {
        junctions.push({
          pos: new THREE.Vector3(ox, oy + HALF * 0.7, oz),
          color: junctionColors[(cell.x + cell.y + cell.z + 100) % junctionColors.length]!,
          intensity: openCount >= 4 ? 18 : 10,
        });
      }
      cellIdx++;

      const faces: Array<{
        open: boolean; n: THREE.Vector3;
        a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; d: THREE.Vector3;
      }> = [
        { open: cell.open.px, n: new THREE.Vector3(-1, 0, 0),
          a: p(1, -1, -1), b: p(1, -1, 1), c: p(1, 1, 1), d: p(1, 1, -1) },
        { open: cell.open.nx, n: new THREE.Vector3(1, 0, 0),
          a: p(-1, -1, 1), b: p(-1, -1, -1), c: p(-1, 1, -1), d: p(-1, 1, 1) },
        { open: cell.open.py, n: new THREE.Vector3(0, -1, 0),
          a: p(-1, 1, -1), b: p(1, 1, -1), c: p(1, 1, 1), d: p(-1, 1, 1) },
        { open: cell.open.ny, n: new THREE.Vector3(0, 1, 0),
          a: p(-1, -1, 1), b: p(1, -1, 1), c: p(1, -1, -1), d: p(-1, -1, -1) },
        { open: cell.open.pz, n: new THREE.Vector3(0, 0, -1),
          a: p(1, -1, 1), b: p(-1, -1, 1), c: p(-1, 1, 1), d: p(1, 1, 1) },
        { open: cell.open.nz, n: new THREE.Vector3(0, 0, 1),
          a: p(-1, -1, -1), b: p(1, -1, -1), c: p(1, 1, -1), d: p(-1, 1, -1) },
      ];

      for (const f of faces) {
        if (f.open) continue;
        quad(f.a, f.b, f.c, f.d, f.n, cellTone);
        accentFrame(f.a, f.b, f.c, f.d, f.n);
        // Random recessed panel
        const h = (cell.x * 131 + cell.y * 71 + cell.z * 53 + Math.round(f.n.x + f.n.y * 2 + f.n.z * 3)) >>> 0;
        if ((h % 3) === 0) {
          panel(f.a, f.b, f.c, f.d, f.n);
        }
      }
    }

    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    wallGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    wallGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    wallGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    wallGeo.setIndex(indices);
    wallGeo.computeBoundingSphere();

    const accentGeo = new THREE.BufferGeometry();
    accentGeo.setAttribute("position", new THREE.Float32BufferAttribute(accentPos, 3));
    accentGeo.setAttribute("normal", new THREE.Float32BufferAttribute(accentNorm, 3));
    accentGeo.setIndex(accentIdx);
    accentGeo.computeBoundingSphere();

    const panelGeo = new THREE.BufferGeometry();
    panelGeo.setAttribute("position", new THREE.Float32BufferAttribute(panelPos, 3));
    panelGeo.setAttribute("normal", new THREE.Float32BufferAttribute(panelNorm, 3));
    panelGeo.setIndex(panelIdx);
    panelGeo.computeBoundingSphere();

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));

    return { wallGeo, accentGeo, edgeGeo, panelGeo, junctions };
  }, [level]);

  return (
    <group>
      <mesh geometry={wallGeo}>
        <meshStandardMaterial
          vertexColors
          roughness={0.92}
          metalness={0.25}
          flatShading
        />
      </mesh>
      <mesh geometry={panelGeo}>
        <meshStandardMaterial
          color="#1a1410"
          roughness={0.45}
          metalness={0.85}
          flatShading
        />
      </mesh>
      <mesh geometry={accentGeo}>
        <meshStandardMaterial
          color="#ff8a3a"
          emissive="#ff5a1a"
          emissiveIntensity={2.2}
          roughness={0.4}
          metalness={0.6}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={edgeGeo}>
        <lineBasicMaterial color="#ff7a2e" transparent opacity={0.18} />
      </lineSegments>

      {/* Junction lights — atmospheric colored point lights at intersections */}
      {junctions.map((j, i) => (
        <group key={i} position={[j.pos.x, j.pos.y, j.pos.z]}>
          <pointLight
            color={j.color}
            intensity={j.intensity}
            distance={CELL * 1.6}
            decay={2}
          />
          <mesh>
            <sphereGeometry args={[0.35, 10, 10]} />
            <meshBasicMaterial color={j.color} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <Reactor pos={level.reactor} />
    </group>
  );
}

function Reactor({ pos }: { pos: THREE.Vector3 }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 3) * 0.08;
    if (coreRef.current) {
      coreRef.current.scale.setScalar(pulse);
      const m = coreRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 4 + Math.sin(t * 4) * 1.5;
    }
    if (shellRef.current) {
      shellRef.current.rotation.y = t * 0.3;
      shellRef.current.rotation.x = t * 0.15;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.6;
    }
    if (lightRef.current) {
      lightRef.current.intensity = 14 + Math.sin(t * 4) * 4;
    }
  });

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      {/* Glowing inner core */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.6, 24, 24]} />
        <meshStandardMaterial
          color="#ff5a55"
          emissive="#ff2244"
          emissiveIntensity={4}
          toneMapped={false}
        />
      </mesh>
      {/* Outer protective shell — wireframe icosahedron */}
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[3.2, 1]} />
        <meshStandardMaterial
          color="#ffaa66"
          emissive="#ff5522"
          emissiveIntensity={1.4}
          wireframe
          toneMapped={false}
        />
      </mesh>
      {/* Equatorial ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.6, 0.18, 12, 48]} />
        <meshStandardMaterial
          color="#ffcc88"
          emissive="#ff7733"
          emissiveIntensity={2.0}
          metalness={0.9}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={lightRef} color="#ff4422" intensity={14} distance={50} decay={2} />
    </group>
  );
}
