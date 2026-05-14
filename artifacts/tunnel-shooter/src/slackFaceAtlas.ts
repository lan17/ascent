import * as THREE from "three";

const ATLAS_GRID = 4;
const ATLAS_CELL = 256;
const ATLAS_SIZE = ATLAS_GRID * ATLAS_CELL;
export const FACE_COUNT = ATLAS_GRID * ATLAS_GRID;

export type FaceAtlas = {
  texture: THREE.CanvasTexture;
  cells: number;
  uvFor: (cellIdx: number) => { u0: number; v0: number; u1: number; v1: number };
};

let atlasPromise: Promise<FaceAtlas | null> | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img load failed: " + url));
    img.src = url;
  });
}

async function build(): Promise<FaceAtlas | null> {
  let urls: string[];
  try {
    const res = await fetch("/api/slack/faces");
    if (!res.ok) return null;
    const body = (await res.json()) as { faces?: Array<{ image: string }> };
    urls = (body.faces ?? []).map((f) => f.image);
  } catch {
    return null;
  }
  if (urls.length === 0) return null;

  // Pad / repeat to fill all cells so every wall tile gets a face.
  while (urls.length < FACE_COUNT) urls.push(urls[urls.length % urls.length]!);
  urls.length = FACE_COUNT;

  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  const imgs = await Promise.all(
    urls.map((u) => loadImage(u).catch(() => null)),
  );
  let placed = 0;
  for (let i = 0; i < FACE_COUNT; i++) {
    const img = imgs[i];
    const col = i % ATLAS_GRID;
    const row = Math.floor(i / ATLAS_GRID);
    const x = col * ATLAS_CELL;
    const y = row * ATLAS_CELL;
    if (img) {
      ctx.drawImage(img, x, y, ATLAS_CELL, ATLAS_CELL);
      placed++;
    } else {
      ctx.fillStyle = "#222";
      ctx.fillRect(x, y, ATLAS_CELL, ATLAS_CELL);
    }
  }
  if (placed === 0) return null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return {
    texture,
    cells: FACE_COUNT,
    uvFor(cellIdx: number) {
      const c = ((cellIdx % FACE_COUNT) + FACE_COUNT) % FACE_COUNT;
      const col = c % ATLAS_GRID;
      const row = Math.floor(c / ATLAS_GRID);
      const u0 = col / ATLAS_GRID;
      const u1 = (col + 1) / ATLAS_GRID;
      // Canvas Y is top-down; UV Y is bottom-up. Flip so faces render upright.
      const v1 = 1 - row / ATLAS_GRID;
      const v0 = 1 - (row + 1) / ATLAS_GRID;
      return { u0, v0, u1, v1 };
    },
  };
}

export function getSlackFaceAtlas(): Promise<FaceAtlas | null> {
  if (!atlasPromise) atlasPromise = build();
  return atlasPromise;
}
