import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

export function voxelize(parts, resolution) {
  const bounds = new THREE.Box3();
  for (const part of parts) for (let i = 0; i < part.length; i += 3) bounds.expandByPoint(new THREE.Vector3(part[i], part[i + 1], part[i + 2]));
  const spacing = 1 / resolution;
  const size = bounds.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z].map(v => Math.max(1, Math.ceil(v / spacing)));
  const origin = [bounds.min.x, bounds.min.y, bounds.min.z];
  const [nx, ny, nz] = dims;
  const occupied = new Uint8Array(nx * ny * nz);
  let openEdges = 0;
  for (const part of parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part, 3));
    // Validate each closed shell separately, preserving gaps between components.
    const edgeCounts = new Map();
    const key = i => `${Math.round(part[i] * 1e6)},${Math.round(part[i + 1] * 1e6)},${Math.round(part[i + 2] * 1e6)}`;
    for (let i = 0; i < part.length; i += 9) {
      const keys = [key(i), key(i + 3), key(i + 6)];
      if (new Set(keys).size !== 3) continue;
      for (let j = 0; j < 3; j++) {
        const a = keys[j], b = keys[(j + 1) % 3];
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
      }
    }
    openEdges += [...edgeCounts.values()].filter(v => v !== 2).length;
    geometry.boundsTree = new MeshBVH(geometry);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.raycast = acceleratedRaycast;
    const ray = new THREE.Raycaster();
    // Deterministic tiny transverse offset avoids rays through shared vertices.
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      ray.set(new THREE.Vector3(origin[0] - spacing, origin[1] + (y + .500013) * spacing, origin[2] + (z + .500031) * spacing), new THREE.Vector3(1, 0, 0));
      const hits = ray.intersectObject(mesh).map(h => h.point.x).sort((a, b) => a - b);
      const crossings = hits.filter((v, i) => !i || Math.abs(v - hits[i - 1]) > 1e-7);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        for (let x = 0; x < nx; x++) {
          const cx = origin[0] + (x + .5) * spacing;
          if (cx >= crossings[k] && cx <= crossings[k + 1]) occupied[x + nx * (y + ny * z)] = 1;
        }
      }
    }
    geometry.dispose(); mesh.material.dispose();
  }
  if (openEdges) throw Error(`The mesh has ${openEdges} open or non-manifold edges. Export watertight solid parts (not an open surface) and try again.`);
  const lookup = new Int32Array(occupied.length).fill(-1), positions = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const key = x + nx * (y + ny * z);
    if (occupied[key]) { lookup[key] = positions.length / 3; positions.push(origin[0] + (x + .5) * spacing, origin[1] + (y + .5) * spacing, origin[2] + (z + .5) * spacing); }
  }
  if (!positions.length) throw Error('No volume cells found. Increase resolution or use a thicker closed solid.');
  const neighbors = [], exposed = new Uint8Array(positions.length / 3);
  const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = lookup[x + nx * (y + ny * z)]; if (i < 0) continue;
    for (const [a, b, c] of offsets) {
      const xx = x + a, yy = y + b, zz = z + c;
      const j = xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz ? -1 : lookup[xx + nx * (yy + ny * zz)];
      if (j < 0) exposed[i]++; else if (j > i) neighbors.push([i, j]);
    }
  }
  // Count thermal islands to make disconnected parts visible to the user.
  const parent = Int32Array.from({ length: exposed.length }, (_, i) => i);
  const root = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (const [i, j] of neighbors) parent[root(i)] = root(j);
  const components = new Set(Array.from(parent, (_, i) => root(i))).size;
  return { positions: Float32Array.from(positions), neighbors, exposed, lookup, dims, origin, spacing, components };
}
