import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CELL, HALF, type Cell, type Level, type Prop, type PropKind } from "./level";

type Props = { level: Level };

type Junction = { pos: THREE.Vector3; color: THREE.Color; intensity: number };

const JUNCTION_SPHERE_GEO = new THREE.SphereGeometry(0.35, 10, 10);

// ---------- Procedural sci-fi industrial wall textures ----------
// Original art in the genre of dark plated mine/station corridors:
// big riveted panels, hex vent grilles, conduit runs, warning chevrons.
// Three variants (steel/tan/warning) are selected per region kind.

type TexOpts = {
  baseA: string;      // light corner of base gradient
  baseB: string;      // dark corner of base gradient
  grooveDark: string; // panel groove color
  bevel: string;      // bright bevel highlight
  rivet: string;      // rivet bolt center
  rivetRim: string;   // rivet bolt edge
  conduit: string;    // recessed conduit line color
  hazardA: string;    // hazard stripe color A
  hazardB: string;    // hazard stripe color B (usually dark)
  ventDark: string;   // hex vent interior
};

function makeWallTextures(opts: TexOpts) {
  const SIZE = 512;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    return c;
  };

  // ---- DIFFUSE ----
  const diff = mk();
  const dctx = diff.getContext("2d")!;
  const grad = dctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, opts.baseA);
  grad.addColorStop(1, opts.baseB);
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, SIZE, SIZE);
  // Noise
  const img = dctx.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 45;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n * 0.9));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n * 0.85));
  }
  dctx.putImageData(img, 0, 0);

  // Diagonal "armor cut" lines in two quadrants for visual interest
  dctx.save();
  dctx.strokeStyle = opts.grooveDark;
  dctx.lineWidth = 3;
  dctx.globalAlpha = 0.6;
  for (let i = -SIZE; i < SIZE; i += 36) {
    dctx.beginPath();
    dctx.moveTo(i, 0); dctx.lineTo(i + SIZE / 4, SIZE / 4);
    dctx.stroke();
  }
  dctx.restore();

  // Outer + cross panel grooves (thick dark recesses)
  dctx.strokeStyle = opts.grooveDark;
  dctx.lineWidth = 10;
  dctx.strokeRect(5, 5, SIZE - 10, SIZE - 10);
  dctx.beginPath();
  dctx.moveTo(SIZE / 2, 0); dctx.lineTo(SIZE / 2, SIZE);
  dctx.moveTo(0, SIZE / 2); dctx.lineTo(SIZE, SIZE / 2);
  dctx.stroke();

  // Bright bevel highlight just inside grooves
  dctx.strokeStyle = opts.bevel;
  dctx.lineWidth = 3;
  dctx.strokeRect(14, 14, SIZE - 28, SIZE - 28);
  dctx.beginPath();
  dctx.moveTo(SIZE / 2 + 7, 8); dctx.lineTo(SIZE / 2 + 7, SIZE - 8);
  dctx.moveTo(8, SIZE / 2 + 7); dctx.lineTo(SIZE - 8, SIZE / 2 + 7);
  dctx.stroke();

  // Conduit runs (horizontal pipe shadows in one quadrant)
  dctx.save();
  dctx.translate(0, (3 * SIZE) / 4 - 30);
  for (let i = 0; i < 3; i++) {
    const y = i * 10;
    dctx.fillStyle = opts.conduit;
    dctx.fillRect(SIZE / 2 + 20, y, SIZE / 2 - 30, 4);
    dctx.fillStyle = opts.bevel;
    dctx.globalAlpha = 0.5;
    dctx.fillRect(SIZE / 2 + 20, y + 4, SIZE / 2 - 30, 1);
    dctx.globalAlpha = 1;
  }
  dctx.restore();

  // Rivets — big, dark recess ring + bright bolt
  const rivetR = 11;
  const rivets: Array<[number, number]> = [
    [28, 28], [SIZE - 28, 28], [28, SIZE - 28], [SIZE - 28, SIZE - 28],
    [SIZE / 2, 28], [SIZE / 2, SIZE - 28], [28, SIZE / 2], [SIZE - 28, SIZE / 2],
    [SIZE / 4, SIZE / 4], [(3 * SIZE) / 4, SIZE / 4],
    [SIZE / 4, (3 * SIZE) / 4],
  ];
  for (const [x, y] of rivets) {
    dctx.fillStyle = "rgba(0,0,0,0.75)";
    dctx.beginPath();
    dctx.arc(x, y, rivetR + 2, 0, Math.PI * 2);
    dctx.fill();
    const rg = dctx.createRadialGradient(x - 3, y - 3, 0, x, y, rivetR);
    rg.addColorStop(0, opts.rivet);
    rg.addColorStop(0.6, opts.rivetRim);
    rg.addColorStop(1, opts.grooveDark);
    dctx.fillStyle = rg;
    dctx.beginPath();
    dctx.arc(x, y, rivetR, 0, Math.PI * 2);
    dctx.fill();
  }

  // Hexagonal vent grille in upper-right quadrant
  const ventCx = (3 * SIZE) / 4;
  const ventCy = SIZE / 4;
  const ventR = 70;
  // Dark recessed plate behind grille
  dctx.fillStyle = opts.grooveDark;
  dctx.beginPath();
  dctx.arc(ventCx, ventCy, ventR + 8, 0, Math.PI * 2);
  dctx.fill();
  dctx.fillStyle = opts.ventDark;
  dctx.beginPath();
  dctx.arc(ventCx, ventCy, ventR, 0, Math.PI * 2);
  dctx.fill();
  // Hexagonal grille bars (honeycomb)
  const hexR = 11;
  const hexH = Math.sqrt(3) * hexR;
  for (let row = -5; row <= 5; row++) {
    for (let col = -5; col <= 5; col++) {
      const cx = ventCx + col * hexR * 1.5;
      const cy = ventCy + row * hexH + (col % 2 === 0 ? 0 : hexH / 2);
      const dx = cx - ventCx, dy = cy - ventCy;
      if (dx * dx + dy * dy > ventR * ventR) continue;
      dctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const px = cx + Math.cos(a) * (hexR - 1.5);
        const py = cy + Math.sin(a) * (hexR - 1.5);
        if (k === 0) dctx.moveTo(px, py);
        else dctx.lineTo(px, py);
      }
      dctx.closePath();
      dctx.strokeStyle = opts.bevel;
      dctx.lineWidth = 1.5;
      dctx.stroke();
    }
  }
  // Vent rim ring
  dctx.strokeStyle = opts.bevel;
  dctx.lineWidth = 3;
  dctx.beginPath();
  dctx.arc(ventCx, ventCy, ventR, 0, Math.PI * 2);
  dctx.stroke();

  // Hazard chevron stripe along the center vertical, between hub and reactor cells
  const stripeW = 28;
  dctx.save();
  dctx.translate(SIZE / 2 - stripeW / 2, 0);
  for (let y = 0; y < SIZE; y += 20) {
    dctx.fillStyle = (y / 20) % 2 === 0 ? opts.hazardA : opts.hazardB;
    dctx.fillRect(0, y, stripeW, 20);
  }
  dctx.restore();

  // ---- NORMAL MAP ----
  const norm = mk();
  const nctx = norm.getContext("2d")!;
  nctx.fillStyle = "rgb(128,128,255)";
  nctx.fillRect(0, 0, SIZE, SIZE);
  // Panel groove bevels (encoded as -X/+X on the cross)
  nctx.lineWidth = 4;
  nctx.strokeStyle = "rgb(70,128,255)";
  nctx.beginPath(); nctx.moveTo(SIZE / 2 - 2, 0); nctx.lineTo(SIZE / 2 - 2, SIZE); nctx.stroke();
  nctx.strokeStyle = "rgb(186,128,255)";
  nctx.beginPath(); nctx.moveTo(SIZE / 2 + 2, 0); nctx.lineTo(SIZE / 2 + 2, SIZE); nctx.stroke();
  nctx.strokeStyle = "rgb(128,70,255)";
  nctx.beginPath(); nctx.moveTo(0, SIZE / 2 - 2); nctx.lineTo(SIZE, SIZE / 2 - 2); nctx.stroke();
  nctx.strokeStyle = "rgb(128,186,255)";
  nctx.beginPath(); nctx.moveTo(0, SIZE / 2 + 2); nctx.lineTo(SIZE, SIZE / 2 + 2); nctx.stroke();
  // Outer frame bevel
  nctx.lineWidth = 4;
  nctx.strokeStyle = "rgb(160,160,255)";
  nctx.strokeRect(8, 8, SIZE - 16, SIZE - 16);
  // Rivet bumps
  for (const [x, y] of rivets) {
    const rg = nctx.createRadialGradient(x - 3, y - 3, 0, x, y, rivetR);
    rg.addColorStop(0, "rgb(200,200,255)");
    rg.addColorStop(1, "rgb(128,128,255)");
    nctx.fillStyle = rg;
    nctx.beginPath();
    nctx.arc(x, y, rivetR, 0, Math.PI * 2);
    nctx.fill();
  }
  // Vent recess (dent inward)
  const vg = nctx.createRadialGradient(ventCx, ventCy, ventR * 0.5, ventCx, ventCy, ventR);
  vg.addColorStop(0, "rgb(128,128,200)");
  vg.addColorStop(1, "rgb(128,128,255)");
  nctx.fillStyle = vg;
  nctx.beginPath();
  nctx.arc(ventCx, ventCy, ventR, 0, Math.PI * 2);
  nctx.fill();

  // ---- ROUGHNESS ----
  const rough = mk();
  const rctx = rough.getContext("2d")!;
  rctx.fillStyle = "rgb(200,200,200)";
  rctx.fillRect(0, 0, SIZE, SIZE);
  rctx.fillStyle = "rgb(80,80,80)";
  rctx.fillRect(SIZE / 2 - stripeW / 2, 0, stripeW, SIZE);
  rctx.fillStyle = "rgb(40,40,40)";
  rctx.beginPath();
  rctx.arc(ventCx, ventCy, ventR, 0, Math.PI * 2);
  rctx.fill();
  for (const [x, y] of rivets) {
    rctx.fillStyle = "rgb(50,50,50)";
    rctx.beginPath();
    rctx.arc(x, y, 6, 0, Math.PI * 2);
    rctx.fill();
  }

  const mkTex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    map: mkTex(diff, true),
    normalMap: mkTex(norm, false),
    roughnessMap: mkTex(rough, false),
  };
}

const STEEL_OPTS: TexOpts = {
  baseA: "#7a8a96", baseB: "#3a4652",
  grooveDark: "#08101a", bevel: "rgba(200,230,255,0.85)",
  rivet: "#e0eaf0", rivetRim: "#5a6a7a",
  conduit: "#0a1018",
  hazardA: "#3a8acc", hazardB: "#0a1018",
  ventDark: "#0a1218",
};
const TAN_OPTS: TexOpts = {
  baseA: "#c69970", baseB: "#7a4f2c",
  grooveDark: "#1a0d05", bevel: "rgba(255,220,170,0.85)",
  rivet: "#fff0d8", rivetRim: "#a06030",
  conduit: "#1a0d05",
  hazardA: "#ffcc55", hazardB: "#100804",
  ventDark: "#150905",
};
const WARNING_OPTS: TexOpts = {
  baseA: "#8a3a2a", baseB: "#3a0a08",
  grooveDark: "#10000a", bevel: "rgba(255,200,180,0.85)",
  rivet: "#ffe0c0", rivetRim: "#702010",
  conduit: "#1a0508",
  hazardA: "#ff5522", hazardB: "#1a0408",
  ventDark: "#180408",
};

const _texCache = new Map<string, ReturnType<typeof makeWallTextures>>();
function getTexFor(kind: Cell["kind"]) {
  const key =
    kind === "reactor" ? "warning" :
    kind === "hub" ? "tan" :
    "steel";
  let t = _texCache.get(key);
  if (!t) {
    const opts =
      key === "warning" ? WARNING_OPTS :
      key === "tan" ? TAN_OPTS :
      STEEL_OPTS;
    t = makeWallTextures(opts);
    _texCache.set(key, t);
  }
  return t;
}

// Tint palettes (vertex colors) per region kind. Keep light so they don't darken the texture.
const KIND_PALETTE: Record<string, THREE.Color[]> = {
  steel: [
    new THREE.Color("#d8e0e8"), new THREE.Color("#c0c8d0"),
    new THREE.Color("#b0b8c0"), new THREE.Color("#a8b0b8"),
  ],
  tan: [
    new THREE.Color("#e0c0a0"), new THREE.Color("#d0a888"),
    new THREE.Color("#b89878"), new THREE.Color("#c0a890"),
  ],
  warning: [
    new THREE.Color("#e8a090"), new THREE.Color("#d08070"),
    new THREE.Color("#c07060"), new THREE.Color("#a86050"),
  ],
};
function kindKey(k: Cell["kind"]): "steel" | "tan" | "warning" {
  return k === "reactor" ? "warning" : k === "hub" ? "tan" : "steel";
}

// Accent rim color per kind (the glowing inset frame around walls).
const KIND_ACCENT: Record<string, { color: string; emissive: string }> = {
  steel:   { color: "#5ad1ff", emissive: "#1a90ff" },
  tan:     { color: "#ff8a3a", emissive: "#ff5a1a" },
  warning: { color: "#ff3344", emissive: "#ff1122" },
};

export function LevelMesh({ level }: Props) {
  // Build one set of geometry/texture per region kind so each can use its own texture.
  const built = useMemo(() => {
    type PerKind = {
      tex: ReturnType<typeof makeWallTextures>;
      wallGeo: THREE.BufferGeometry;
      accentGeo: THREE.BufferGeometry;
      panelGeo: THREE.BufferGeometry;
      accent: { color: string; emissive: string };
    };
    const kinds: Array<"steel" | "tan" | "warning"> = ["steel", "tan", "warning"];
    const buffers: Record<string, {
      pos: number[]; nrm: number[]; uv: number[]; col: number[]; idx: number[];
      ap: number[]; an: number[]; ai: number[];
      pp: number[]; pn: number[]; pi: number[];
      vi: number; aiIdx: number; piIdx: number;
    }> = {};
    for (const k of kinds) {
      buffers[k] = {
        pos: [], nrm: [], uv: [], col: [], idx: [],
        ap: [], an: [], ai: [],
        pp: [], pn: [], pi: [],
        vi: 0, aiIdx: 0, piIdx: 0,
      };
    }
    const edgePositions: number[] = [];
    const junctions: Junction[] = [];

    const junctionColors = [
      new THREE.Color("#ff7a2e"), new THREE.Color("#ffaa44"),
      new THREE.Color("#33ccff"), new THREE.Color("#88ddff"),
      new THREE.Color("#aaff66"), new THREE.Color("#ff5522"),
    ];

    let cellIdx = 0;
    for (const cell of level.cells.values()) {
      const ox = cell.x * CELL;
      const oy = cell.y * CELL;
      const oz = cell.z * CELL;
      const p = (sx: number, sy: number, sz: number) =>
        new THREE.Vector3(ox + sx * HALF, oy + sy * HALF, oz + sz * HALF);

      const kk = kindKey(cell.kind);
      const palette = KIND_PALETTE[kk]!;
      const cellTone = palette[(Math.abs(cell.x * 73 + cell.y * 31 + cell.z * 17)) % palette.length]!;
      const buf = buffers[kk]!;

      const openCount =
        Number(cell.open.px) + Number(cell.open.nx) +
        Number(cell.open.py) + Number(cell.open.ny) +
        Number(cell.open.pz) + Number(cell.open.nz);
      if (openCount >= 3 || cellIdx % 4 === 0) {
        const baseColor = cell.kind === "reactor"
          ? new THREE.Color("#ff4422")
          : junctionColors[(cell.x + cell.y + cell.z + 100) % junctionColors.length]!;
        junctions.push({
          pos: new THREE.Vector3(ox, oy + HALF * 0.7, oz),
          color: baseColor,
          intensity: openCount >= 4 ? 22 : 12,
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
        // Quad
        buf.pos.push(f.a.x, f.a.y, f.a.z, f.b.x, f.b.y, f.b.z, f.c.x, f.c.y, f.c.z, f.d.x, f.d.y, f.d.z);
        for (let i = 0; i < 4; i++) {
          buf.nrm.push(f.n.x, f.n.y, f.n.z);
          buf.col.push(cellTone.r, cellTone.g, cellTone.b);
        }
        buf.uv.push(0, 0, 2, 0, 2, 2, 0, 2);
        buf.idx.push(buf.vi, buf.vi + 1, buf.vi + 2, buf.vi, buf.vi + 2, buf.vi + 3);
        edgePositions.push(
          f.a.x, f.a.y, f.a.z, f.b.x, f.b.y, f.b.z,
          f.b.x, f.b.y, f.b.z, f.c.x, f.c.y, f.c.z,
          f.c.x, f.c.y, f.c.z, f.d.x, f.d.y, f.d.z,
          f.d.x, f.d.y, f.d.z, f.a.x, f.a.y, f.a.z,
        );
        buf.vi += 4;

        // Accent frame: 4 quads as a thin inset border, pushed slightly off the wall
        const inset = 1.4;
        const off = 0.08;
        const center = f.a.clone().add(f.b).add(f.c).add(f.d).multiplyScalar(0.25);
        const shrink = (v: THREE.Vector3, factor: number) =>
          v.clone().lerp(center, factor).addScaledVector(f.n, off);
        const A1 = shrink(f.a, 0), B1 = shrink(f.b, 0), C1 = shrink(f.c, 0), D1 = shrink(f.d, 0);
        const k = inset / HALF;
        const A2 = shrink(f.a, k), B2 = shrink(f.b, k), C2 = shrink(f.c, k), D2 = shrink(f.d, k);
        const frameQuads = [
          [A1, B1, B2, A2], [B1, C1, C2, B2],
          [C1, D1, D2, C2], [D1, A1, A2, D2],
        ];
        for (const fq of frameQuads) {
          const [P, Q, R, S] = fq;
          buf.ap.push(P!.x, P!.y, P!.z, Q!.x, Q!.y, Q!.z, R!.x, R!.y, R!.z, S!.x, S!.y, S!.z);
          for (let i = 0; i < 4; i++) buf.an.push(f.n.x, f.n.y, f.n.z);
          buf.ai.push(buf.aiIdx, buf.aiIdx + 1, buf.aiIdx + 2, buf.aiIdx, buf.aiIdx + 2, buf.aiIdx + 3);
          buf.aiIdx += 4;
        }

        // Recessed panel — sparse
        const h = (cell.x * 131 + cell.y * 71 + cell.z * 53 + Math.round(f.n.x + f.n.y * 2 + f.n.z * 3)) >>> 0;
        if ((h % 3) === 0) {
          const pInset = 3.2;
          const pOff = -0.18;
          const pk = pInset / HALF;
          const ps = (v: THREE.Vector3) => v.clone().lerp(center, pk).addScaledVector(f.n, pOff);
          const PA = ps(f.a), PB = ps(f.b), PC = ps(f.c), PD = ps(f.d);
          buf.pp.push(PA.x, PA.y, PA.z, PB.x, PB.y, PB.z, PC.x, PC.y, PC.z, PD.x, PD.y, PD.z);
          for (let i = 0; i < 4; i++) buf.pn.push(f.n.x, f.n.y, f.n.z);
          buf.pi.push(buf.piIdx, buf.piIdx + 1, buf.piIdx + 2, buf.piIdx, buf.piIdx + 2, buf.piIdx + 3);
          buf.piIdx += 4;
        }
      }
    }

    const perKind: Record<string, PerKind> = {};
    for (const k of kinds) {
      const b = buffers[k]!;
      const wallGeo = new THREE.BufferGeometry();
      wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      wallGeo.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
      wallGeo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      wallGeo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      wallGeo.setIndex(b.idx);
      wallGeo.computeBoundingSphere();

      const accentGeo = new THREE.BufferGeometry();
      accentGeo.setAttribute("position", new THREE.Float32BufferAttribute(b.ap, 3));
      accentGeo.setAttribute("normal", new THREE.Float32BufferAttribute(b.an, 3));
      accentGeo.setIndex(b.ai);
      accentGeo.computeBoundingSphere();

      const panelGeo = new THREE.BufferGeometry();
      panelGeo.setAttribute("position", new THREE.Float32BufferAttribute(b.pp, 3));
      panelGeo.setAttribute("normal", new THREE.Float32BufferAttribute(b.pn, 3));
      panelGeo.setIndex(b.pi);
      panelGeo.computeBoundingSphere();

      perKind[k] = {
        tex: getTexFor(k === "warning" ? "reactor" : k === "tan" ? "hub" : "corridor"),
        wallGeo, accentGeo, panelGeo,
        accent: KIND_ACCENT[k]!,
      };
    }

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));

    return { perKind, edgeGeo, junctions };
  }, [level]);

  const kinds: Array<"steel" | "tan" | "warning"> = ["steel", "tan", "warning"];

  return (
    <group>
      {kinds.map((k) => {
        const pk = built.perKind[k]!;
        return (
          <group key={k}>
            <mesh geometry={pk.wallGeo} matrixAutoUpdate={false}>
              <meshStandardMaterial
                vertexColors
                map={pk.tex.map}
                normalMap={pk.tex.normalMap}
                roughnessMap={pk.tex.roughnessMap}
                normalScale={new THREE.Vector2(1.6, 1.6)}
                roughness={0.7}
                metalness={0.1}
                emissive={k === "warning" ? "#3a0808" : k === "steel" ? "#08101a" : "#1a0d05"}
                emissiveIntensity={k === "warning" ? 0.9 : 0.55}
                emissiveMap={pk.tex.map}
              />
            </mesh>
            <mesh geometry={pk.panelGeo} matrixAutoUpdate={false}>
              <meshStandardMaterial
                color={k === "warning" ? "#1a0808" : k === "steel" ? "#0d1218" : "#1a1410"}
                roughness={0.4}
                metalness={0.85}
                flatShading
              />
            </mesh>
            <mesh geometry={pk.accentGeo} matrixAutoUpdate={false}>
              <meshStandardMaterial
                color={pk.accent.color}
                emissive={pk.accent.emissive}
                emissiveIntensity={k === "warning" ? 3.0 : 2.2}
                roughness={0.4}
                metalness={0.6}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}

      <lineSegments geometry={built.edgeGeo} matrixAutoUpdate={false}>
        <lineBasicMaterial color="#ffaa55" transparent opacity={0.45} toneMapped={false} />
      </lineSegments>

      {built.junctions.map((j, i) => (
        <group
          key={i}
          position={[j.pos.x, j.pos.y, j.pos.z]}
          ref={(g) => { if (g) { g.updateMatrix(); g.matrixAutoUpdate = false; } }}
        >
          <mesh geometry={JUNCTION_SPHERE_GEO}>
            <meshBasicMaterial color={j.color} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <PropField props={level.props} />

      <Reactor pos={level.reactor} />
    </group>
  );
}

// ---------- Interior props ----------
// Each room cell may contain a handful of props placed against walls. Geometries
// and materials are shared across all instances of a given kind+biome to keep
// draw setup cheap.

const PROP_BIOME_COLORS: Record<"steel" | "tan" | "warning", {
  body: string; trim: string; emissive: string; accent: string;
}> = {
  steel:   { body: "#5d6772", trim: "#9aaab8", emissive: "#1a90ff", accent: "#5ad1ff" },
  tan:     { body: "#8a6a4a", trim: "#c69970", emissive: "#ff5a1a", accent: "#ff8a3a" },
  warning: { body: "#5a2a22", trim: "#a04438", emissive: "#ff2a1a", accent: "#ff5544" },
};

const _PROP_BODY_MATS = new Map<string, THREE.MeshStandardMaterial>();
function bodyMat(biome: "steel" | "tan" | "warning") {
  const k = `b:${biome}`;
  let m = _PROP_BODY_MATS.get(k);
  if (!m) {
    const c = PROP_BIOME_COLORS[biome];
    m = new THREE.MeshStandardMaterial({
      color: c.body, metalness: 0.6, roughness: 0.55, flatShading: true,
    });
    _PROP_BODY_MATS.set(k, m);
  }
  return m;
}
const _PROP_TRIM_MATS = new Map<string, THREE.MeshStandardMaterial>();
function trimMat(biome: "steel" | "tan" | "warning") {
  const k = `t:${biome}`;
  let m = _PROP_TRIM_MATS.get(k);
  if (!m) {
    const c = PROP_BIOME_COLORS[biome];
    m = new THREE.MeshStandardMaterial({
      color: c.trim, metalness: 0.85, roughness: 0.35, flatShading: true,
    });
    _PROP_TRIM_MATS.set(k, m);
  }
  return m;
}
const _PROP_GLOW_MATS = new Map<string, THREE.MeshStandardMaterial>();
function glowMat(biome: "steel" | "tan" | "warning") {
  const k = `g:${biome}`;
  let m = _PROP_GLOW_MATS.get(k);
  if (!m) {
    const c = PROP_BIOME_COLORS[biome];
    m = new THREE.MeshStandardMaterial({
      color: c.accent, emissive: c.emissive, emissiveIntensity: 2.4,
      metalness: 0.4, roughness: 0.3, toneMapped: false,
    });
    _PROP_GLOW_MATS.set(k, m);
  }
  return m;
}
const HAZARD_MAT = new THREE.MeshStandardMaterial({
  color: "#ffcc22", emissive: "#ffaa11", emissiveIntensity: 1.2,
  metalness: 0.3, roughness: 0.5, toneMapped: false,
});

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL_8 = new THREE.CylinderGeometry(1, 1, 1, 10);
const CYL_TAPER = new THREE.CylinderGeometry(0.85, 1, 1, 10);
const TORUS = new THREE.TorusGeometry(1, 0.06, 6, 16);

function PropField({ props }: { props: Prop[] }) {
  return (
    <group>
      {props.map((p, i) => (
        <PropMesh key={i} p={p} />
      ))}
    </group>
  );
}

function PropMesh({ p }: { p: Prop }) {
  const body = bodyMat(p.biome);
  const trim = trimMat(p.biome);
  const glow = glowMat(p.biome);
  const hx = p.half[0], hy = p.half[1], hz = p.half[2];
  const setMatrixOnce = (g: THREE.Group | null) => {
    if (g) { g.updateMatrix(); g.matrixAutoUpdate = false; }
  };
  switch (p.kind as PropKind) {
    case "column": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={CYL_8} material={body} scale={[hx, hy * 2, hz]} />
          <mesh geometry={CYL_8} material={trim} scale={[hx * 0.55, hy * 0.04, hz * 0.55]} position={[0, hy - 0.4, 0]} />
          <mesh geometry={CYL_8} material={trim} scale={[hx * 0.55, hy * 0.04, hz * 0.55]} position={[0, -hy + 0.4, 0]} />
          <mesh geometry={CYL_8} material={glow} scale={[hx * 0.35, hy * 0.05, hz * 0.35]} position={[0, hy - 1.4, 0]} />
        </group>
      );
    }
    case "warning_column": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={CYL_8} material={body} scale={[hx, hy * 2, hz]} />
          {/* hazard stripes */}
          <mesh geometry={CYL_8} material={HAZARD_MAT} scale={[hx * 1.04, 0.3, hz * 1.04]} position={[0, hy - 2.2, 0]} />
          <mesh geometry={CYL_8} material={HAZARD_MAT} scale={[hx * 1.04, 0.3, hz * 1.04]} position={[0, hy - 4.6, 0]} />
          <mesh geometry={CYL_8} material={glow} scale={[hx * 0.4, 0.2, hz * 0.4]} position={[0, hy - 0.6, 0]} />
        </group>
      );
    }
    case "server_rack": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={BOX} material={body} scale={[hx * 2, hy * 2, hz * 2]} />
          <mesh geometry={BOX} material={trim} scale={[hx * 0.4, hy * 0.15, hz * 2.05]} position={[hx * 0.55, hy - 0.5, 0]} />
          {/* glowing screen strip */}
          <mesh geometry={BOX} material={glow} scale={[hx * 1.6, 0.25, 0.05]} position={[0, hy * 0.55, hz + 0.02]} />
          <mesh geometry={BOX} material={glow} scale={[hx * 1.6, 0.25, 0.05]} position={[0, 0, hz + 0.02]} />
          <mesh geometry={BOX} material={glow} scale={[hx * 1.6, 0.25, 0.05]} position={[0, -hy * 0.55, hz + 0.02]} />
        </group>
      );
    }
    case "generator": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={BOX} material={body} scale={[hx * 2, hy * 2 * 0.85, hz * 2]} position={[0, -hy * 0.075, 0]} />
          {/* coil cylinder on top */}
          <mesh geometry={CYL_8} material={trim} scale={[hx * 0.7, hy * 0.4, hz * 0.7]} position={[0, hy * 0.8, 0]} />
          <mesh geometry={TORUS} material={glow} scale={[hx * 0.7, hy * 0.7, hx * 0.7]} rotation={[Math.PI / 2, 0, 0]} position={[0, hy * 0.85, 0]} />
          <mesh geometry={BOX} material={glow} scale={[hx * 0.8, 0.12, 0.04]} position={[0, -hy * 0.2, hz + 0.02]} />
        </group>
      );
    }
    case "coolant_tank": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={CYL_TAPER} material={body} scale={[hx, hy * 2 * 0.85, hz]} position={[0, -hy * 0.075, 0]} />
          <mesh geometry={CYL_8} material={trim} scale={[hx * 0.95, 0.4, hz * 0.95]} position={[0, hy * 0.8, 0]} />
          <mesh geometry={TORUS} material={glow} scale={[hx * 0.95, hy * 0.95, hx * 0.95]} rotation={[Math.PI / 2, 0, 0]} position={[0, hy * 0.4, 0]} />
          <mesh geometry={TORUS} material={glow} scale={[hx * 0.95, hy * 0.95, hx * 0.95]} rotation={[Math.PI / 2, 0, 0]} position={[0, -hy * 0.3, 0]} />
        </group>
      );
    }
    case "console": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={BOX} material={body} scale={[hx * 2, hy * 2 * 0.6, hz * 2]} position={[0, -hy * 0.2, 0]} />
          {/* angled screen */}
          <mesh geometry={BOX} material={trim} scale={[hx * 1.8, hy * 1.0, 0.3]} position={[0, hy * 0.3, -hz * 0.4]} rotation={[-0.3, 0, 0]} />
          <mesh geometry={BOX} material={glow} scale={[hx * 1.5, hy * 0.7, 0.05]} position={[0, hy * 0.35, -hz * 0.4 + 0.18]} rotation={[-0.3, 0, 0]} />
        </group>
      );
    }
    case "crate": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={BOX} material={body} scale={[hx * 2, hy * 2, hz * 2]} />
          {/* corner braces */}
          <mesh geometry={BOX} material={trim} scale={[0.2, hy * 2.05, 0.2]} position={[ hx - 0.1, 0,  hz - 0.1]} />
          <mesh geometry={BOX} material={trim} scale={[0.2, hy * 2.05, 0.2]} position={[-hx + 0.1, 0,  hz - 0.1]} />
          <mesh geometry={BOX} material={trim} scale={[0.2, hy * 2.05, 0.2]} position={[ hx - 0.1, 0, -hz + 0.1]} />
          <mesh geometry={BOX} material={trim} scale={[0.2, hy * 2.05, 0.2]} position={[-hx + 0.1, 0, -hz + 0.1]} />
          <mesh geometry={BOX} material={glow} scale={[hx * 0.6, 0.06, 0.04]} position={[0, hy * 0.1, hz + 0.01]} />
        </group>
      );
    }
    case "barrel": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={CYL_8} material={body} scale={[hx, hy * 2, hz]} />
          <mesh geometry={CYL_8} material={trim} scale={[hx * 1.04, 0.18, hz * 1.04]} position={[0, hy * 0.4, 0]} />
          <mesh geometry={CYL_8} material={trim} scale={[hx * 1.04, 0.18, hz * 1.04]} position={[0, -hy * 0.4, 0]} />
          <mesh geometry={CYL_8} material={glow} scale={[hx * 0.35, 0.08, hz * 0.35]} position={[0, hy + 0.05, 0]} />
        </group>
      );
    }
    case "pipes": {
      // 3 stacked horizontal pipes running along X
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={CYL_8} material={trim} scale={[0.5, hx * 2, 0.5]} position={[0, -hy * 0.4, 0]} rotation={[0, 0, Math.PI / 2]} />
          <mesh geometry={CYL_8} material={trim} scale={[0.45, hx * 2, 0.45]} position={[0, 0.0, hz * 0.3]} rotation={[0, 0, Math.PI / 2]} />
          <mesh geometry={CYL_8} material={body} scale={[0.55, hx * 2, 0.55]} position={[0, hy * 0.4, -hz * 0.2]} rotation={[0, 0, Math.PI / 2]} />
          {/* glow valve */}
          <mesh geometry={CYL_8} material={glow} scale={[0.18, 0.6, 0.18]} position={[hx * 0.3, hy * 0.4 + 0.5, -hz * 0.2]} />
        </group>
      );
    }
    case "tank": {
      return (
        <group position={p.pos} rotation={[0, p.rotY, 0]} ref={setMatrixOnce}>
          <mesh geometry={CYL_TAPER} material={body} scale={[hx, hy * 2, hz]} />
          <mesh geometry={TORUS} material={trim} scale={[hx * 0.9, hx * 0.9, hx * 0.9]} rotation={[Math.PI / 2, 0, 0]} position={[0, hy * 0.6, 0]} />
          <mesh geometry={TORUS} material={glow} scale={[hx * 0.9, hx * 0.9, hx * 0.9]} rotation={[Math.PI / 2, 0, 0]} position={[0, -hy * 0.2, 0]} />
        </group>
      );
    }
  }
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
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.6, 24, 24]} />
        <meshStandardMaterial
          color="#ff5a55" emissive="#ff2244" emissiveIntensity={4} toneMapped={false}
        />
      </mesh>
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[3.2, 1]} />
        <meshStandardMaterial
          color="#ffaa66" emissive="#ff5522" emissiveIntensity={1.4} wireframe toneMapped={false}
        />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.6, 0.18, 12, 48]} />
        <meshStandardMaterial
          color="#ffcc88" emissive="#ff7733" emissiveIntensity={2.0}
          metalness={0.9} roughness={0.2} toneMapped={false}
        />
      </mesh>
      <pointLight ref={lightRef} color="#ff4422" intensity={14} distance={50} decay={2} />
    </group>
  );
}
