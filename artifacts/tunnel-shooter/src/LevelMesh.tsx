import { useMemo } from "react";
import * as THREE from "three";
import { CELL, HALF, type Level } from "./level";

type Props = { level: Level };

export function LevelMesh({ level }: Props) {
  const { wallGeo, edgeGeo, reactorPos } = useMemo(() => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const edgePositions: number[] = [];

    let vi = 0;
    function quad(
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      n: THREE.Vector3,
    ) {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
      for (let i = 0; i < 4; i++) normals.push(n.x, n.y, n.z);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      // edge lines for grid look
      edgePositions.push(
        a.x, a.y, a.z, b.x, b.y, b.z,
        b.x, b.y, b.z, c.x, c.y, c.z,
        c.x, c.y, c.z, d.x, d.y, d.z,
        d.x, d.y, d.z, a.x, a.y, a.z,
      );
      vi += 4;
    }

    for (const cell of level.cells.values()) {
      const ox = cell.x * CELL;
      const oy = cell.y * CELL;
      const oz = cell.z * CELL;
      // 8 corners
      const p = (sx: number, sy: number, sz: number) =>
        new THREE.Vector3(ox + sx * HALF, oy + sy * HALF, oz + sz * HALF);

      // +X face (open ? skip)
      if (!cell.open.px) {
        quad(p(1, -1, -1), p(1, -1, 1), p(1, 1, 1), p(1, 1, -1), new THREE.Vector3(-1, 0, 0));
      }
      if (!cell.open.nx) {
        quad(p(-1, -1, 1), p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), new THREE.Vector3(1, 0, 0));
      }
      if (!cell.open.py) {
        quad(p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1), new THREE.Vector3(0, -1, 0));
      }
      if (!cell.open.ny) {
        quad(p(-1, -1, 1), p(1, -1, 1), p(1, -1, -1), p(-1, -1, -1), new THREE.Vector3(0, 1, 0));
      }
      if (!cell.open.pz) {
        quad(p(1, -1, 1), p(-1, -1, 1), p(-1, 1, 1), p(1, 1, 1), new THREE.Vector3(0, 0, -1));
      }
      if (!cell.open.nz) {
        quad(p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), new THREE.Vector3(0, 0, 1));
      }
    }

    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    wallGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    wallGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    wallGeo.setIndex(indices);
    wallGeo.computeBoundingSphere();

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));

    return { wallGeo, edgeGeo, reactorPos: level.reactor };
  }, [level]);

  return (
    <group>
      <mesh geometry={wallGeo} castShadow={false} receiveShadow={false}>
        <meshStandardMaterial
          color="#3a2418"
          roughness={0.95}
          metalness={0.15}
          flatShading
        />
      </mesh>
      <lineSegments geometry={edgeGeo}>
        <lineBasicMaterial color="#ff7a2e" transparent opacity={0.35} />
      </lineSegments>
      {/* Reactor */}
      <group position={[reactorPos.x, reactorPos.y, reactorPos.z]}>
        <mesh>
          <icosahedronGeometry args={[3, 1]} />
          <meshStandardMaterial
            color="#ff2a55"
            emissive="#ff2a55"
            emissiveIntensity={2.4}
            roughness={0.3}
          />
        </mesh>
        <pointLight color="#ff2a55" intensity={6} distance={40} decay={2} />
      </group>
    </group>
  );
}
