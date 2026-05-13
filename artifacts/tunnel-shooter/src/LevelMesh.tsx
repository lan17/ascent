import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL, HALF, type Level } from "./level";

type Props = { level: Level };

type Junction = { pos: THREE.Vector3; color: THREE.Color; intensity: number };

// Procedural metal-panel wall texture (diffuse + normal). Runs once per page.
function makeWallTextures(): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const SIZE = 256;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    return c;
  };

  // ---- DIFFUSE ----
  const diff = mk();
  const dctx = diff.getContext("2d")!;
  // Base
  const grad = dctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, "#6b4226");
  grad.addColorStop(1, "#3a2010");
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, SIZE, SIZE);
  // Noise
  const img = dctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 40;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n * 0.8));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n * 0.6));
  }
  dctx.putImageData(img, 0, 0);
  // Panel divisions (cross + sub panels)
  dctx.strokeStyle = "rgba(8,4,2,0.85)";
  dctx.lineWidth = 4;
  dctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
  dctx.beginPath();
  dctx.moveTo(SIZE / 2, 0); dctx.lineTo(SIZE / 2, SIZE);
  dctx.moveTo(0, SIZE / 2); dctx.lineTo(SIZE, SIZE / 2);
  dctx.stroke();
  // Highlight edges (bevel)
  dctx.strokeStyle = "rgba(255,170,100,0.35)";
  dctx.lineWidth = 1.5;
  dctx.strokeRect(6, 6, SIZE - 12, SIZE - 12);
  dctx.beginPath();
  dctx.moveTo(SIZE / 2 + 2, 4); dctx.lineTo(SIZE / 2 + 2, SIZE - 4);
  dctx.moveTo(4, SIZE / 2 + 2); dctx.lineTo(SIZE - 4, SIZE / 2 + 2);
  dctx.stroke();
  // Rivets at panel corners + quadrant centers
  const rivets: Array<[number, number]> = [
    [16, 16], [SIZE - 16, 16], [16, SIZE - 16], [SIZE - 16, SIZE - 16],
    [SIZE / 2, 16], [SIZE / 2, SIZE - 16], [16, SIZE / 2], [SIZE - 16, SIZE / 2],
    [SIZE / 4, SIZE / 4], [(3 * SIZE) / 4, SIZE / 4],
    [SIZE / 4, (3 * SIZE) / 4], [(3 * SIZE) / 4, (3 * SIZE) / 4],
  ];
  for (const [x, y] of rivets) {
    const rg = dctx.createRadialGradient(x - 1, y - 1, 0, x, y, 5);
    rg.addColorStop(0, "#ffd09a");
    rg.addColorStop(0.6, "#7a4a26");
    rg.addColorStop(1, "rgba(0,0,0,0.6)");
    dctx.fillStyle = rg;
    dctx.beginPath();
    dctx.arc(x, y, 5, 0, Math.PI * 2);
    dctx.fill();
  }
  // Hazard stripe along one panel edge (orange/black)
  const stripeW = 14;
  dctx.save();
  dctx.translate(SIZE / 2 - stripeW / 2, 0);
  for (let y = 0; y < SIZE; y += 12) {
    dctx.fillStyle = (y / 12) % 2 === 0 ? "#ffb04a" : "#1a0e06";
    dctx.fillRect(0, y, stripeW, 12);
  }
  dctx.restore();

  // ---- NORMAL MAP (fake — from grayscale of diffuse using sobel) ----
  const norm = mk();
  const nctx = norm.getContext("2d")!;
  // Start with mid normal (128,128,255)
  nctx.fillStyle = "rgb(128,128,255)";
  nctx.fillRect(0, 0, SIZE, SIZE);
  // Draw panel grooves as darker indentations into normals: encode by drawing offset highlights/shadows.
  // Bevel along panel cross
  nctx.lineWidth = 2;
  nctx.strokeStyle = "rgb(80,128,255)"; // -X
  nctx.beginPath();
  nctx.moveTo(SIZE / 2 - 1, 0); nctx.lineTo(SIZE / 2 - 1, SIZE);
  nctx.stroke();
  nctx.strokeStyle = "rgb(176,128,255)"; // +X
  nctx.beginPath();
  nctx.moveTo(SIZE / 2 + 1, 0); nctx.lineTo(SIZE / 2 + 1, SIZE);
  nctx.stroke();
  nctx.strokeStyle = "rgb(128,80,255)"; // -Y
  nctx.beginPath();
  nctx.moveTo(0, SIZE / 2 - 1); nctx.lineTo(SIZE, SIZE / 2 - 1);
  nctx.stroke();
  nctx.strokeStyle = "rgb(128,176,255)"; // +Y
  nctx.beginPath();
  nctx.moveTo(0, SIZE / 2 + 1); nctx.lineTo(SIZE, SIZE / 2 + 1);
  nctx.stroke();
  // Outer frame bevel
  nctx.lineWidth = 3;
  nctx.strokeStyle = "rgb(160,160,255)";
  nctx.strokeRect(4, 4, SIZE - 8, SIZE - 8);
  // Rivet bumps
  for (const [x, y] of rivets) {
    const rg = nctx.createRadialGradient(x - 1.5, y - 1.5, 0, x, y, 5);
    rg.addColorStop(0, "rgb(190,190,255)");
    rg.addColorStop(1, "rgb(128,128,255)");
    nctx.fillStyle = rg;
    nctx.beginPath();
    nctx.arc(x, y, 5, 0, Math.PI * 2);
    nctx.fill();
  }

  // ---- ROUGHNESS (panels rougher, rivets/hazard shinier) ----
  const rough = mk();
  const rctx = rough.getContext("2d")!;
  rctx.fillStyle = "rgb(200,200,200)"; // rough by default
  rctx.fillRect(0, 0, SIZE, SIZE);
  rctx.fillStyle = "rgb(80,80,80)";
  rctx.fillRect(SIZE / 2 - stripeW / 2, 0, stripeW, SIZE);
  for (const [x, y] of rivets) {
    rctx.fillStyle = "rgb(60,60,60)";
    rctx.beginPath();
    rctx.arc(x, y, 4, 0, Math.PI * 2);
    rctx.fill();
  }

  const mkTex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    map: mkTex(diff, true),
    normalMap: mkTex(norm, false),
    roughnessMap: mkTex(rough, false),
  };
}

let _wallTextures: ReturnType<typeof makeWallTextures> | null = null;
function getWallTextures() {
  if (!_wallTextures) _wallTextures = makeWallTextures();
  return _wallTextures;
}

export function LevelMesh({ level }: Props) {
  const wallTex = useMemo(() => getWallTextures(), []);
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
      uvs.push(0, 0, 4, 0, 4, 4, 0, 4);
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
          map={wallTex.map}
          normalMap={wallTex.normalMap}
          roughnessMap={wallTex.roughnessMap}
          normalScale={new THREE.Vector2(1.2, 1.2)}
          roughness={1.0}
          metalness={0.55}
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
        <lineBasicMaterial color="#ffaa55" transparent opacity={0.55} toneMapped={false} />
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
