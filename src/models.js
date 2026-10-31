import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function pipe(outer, inner, height) {
  const points = [[inner, -height / 2], [outer, -height / 2], [outer, height / 2], [inner, height / 2], [inner, -height / 2]].map(([x,y]) => new THREE.Vector2(x,y));
  return new THREE.LatheGeometry(points, 64);
}
export function sampleModel(name) {
  const group = new THREE.Group();
  const add = (geometry, y = 0) => { const mesh = new THREE.Mesh(geometry); mesh.position.y = y; group.add(mesh); };
  if (name === 'pipe') add(pipe(.29, .18, 1));
  else if (name === 'piston') {
    // Closed cutaway sleeve: a 270 degree annular extrusion with closed radial ends.
    const shape = new THREE.Shape(), start = Math.PI / 4, end = Math.PI * 1.75;
    shape.absarc(0, 0, .34, start, end, false);
    shape.lineTo(.26 * Math.cos(end), .26 * Math.sin(end));
    shape.absarc(0, 0, .26, end, start, true); shape.closePath();
    const sleeve = new THREE.ExtrudeGeometry(shape, { depth: .8, bevelEnabled: false, curveSegments: 40 });
    sleeve.translate(0, 0, -.4); sleeve.rotateX(Math.PI / 2); add(sleeve);
    add(new THREE.CylinderGeometry(.18, .18, .16, 64), -.1);
    add(new THREE.CylinderGeometry(.07, .07, .6, 40), -.4);
  } else if (name === 'flange') {
    // One closed revolved profile: the bore continues through both flanges.
    const profile = [[.16,-.5],[.43,-.5],[.43,-.36],[.25,-.36],
      [.25,.36],[.43,.36],[.43,.5],[.16,.5],[.16,-.5]];
    add(new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)),64));
  } else if (name === 'heatsink') {
    // A single extruded comb, with resolved fin thicknesses and gaps even at 24 cells.
    const comb = new THREE.Shape();
    comb.moveTo(-.5,0); comb.lineTo(.5,0); comb.lineTo(.5,.12);
    for (const x of [.4,.2,0,-.2,-.4]) {
      comb.lineTo(x+.04,.12); comb.lineTo(x+.04,.5);
      comb.lineTo(x-.04,.5); comb.lineTo(x-.04,.12);
    }
    comb.lineTo(-.5,.12); comb.closePath();
    const fins = new THREE.ExtrudeGeometry(comb,{depth:.8,bevelEnabled:false});
    fins.translate(0,0,-.4); add(fins);
  } else if (name === 'shaft') {
    const profile = [[0,-.5],[.12,-.5],[.12,-.27],[.23,-.27],
      [.23,-.12],[.17,-.12],[.17,.22],[.10,.22],[.10,.5],[0,.5]];
    add(new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)),64));
  } else add(new THREE.BoxGeometry(.75, .45, 1, 16, 12, 24));
  return normalize(group);
}
export function normalize(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (!(extent > 0) || !Number.isFinite(extent)) throw Error('The model has no usable dimensions.');
  const parts = [];
  group.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.isSkinnedMesh || obj.isInstancedMesh) throw Error('Export a static, non-instanced mesh before importing.');
    let geometry = obj.geometry.clone();
    geometry.applyMatrix4(obj.matrixWorld);
    if (geometry.index) { const expanded = geometry.toNonIndexed(); geometry.dispose(); geometry = expanded; }
    const source = geometry.getAttribute('position'), values = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) {
      values[3 * i] = (source.getX(i) - center.x) / extent;
      values[3 * i + 1] = (source.getY(i) - center.y) / extent;
      values[3 * i + 2] = (source.getZ(i) - center.z) / extent;
    }
    if (values.some(v => !Number.isFinite(v))) throw Error('The model contains invalid vertex coordinates.');
    if (values.length) parts.push(values);
    geometry.dispose();
  });
  group.traverse(obj => { if (obj.isMesh) { obj.geometry.dispose(); const materials = Array.isArray(obj.material) ? obj.material : [obj.material]; materials.forEach(m => m?.dispose()); } });
  if (!parts.length) throw Error('No triangle meshes found.');
  if (parts.reduce((n, p) => n + p.length / 9, 0) > 150000) throw Error('Please simplify the model to fewer than 150,000 triangles.');
  return parts;
}
export async function importModel(file) {
  if (file.size > 15 * 1024 * 1024) throw Error('Please use a model smaller than 15 MB.');
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'stl') return normalize(new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer())));
  if (ext === 'obj') return normalize(new OBJLoader().parse(await file.text()));
  if (ext === 'glb' || ext === 'gltf') {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => { if (!url.startsWith('data:') && !url.startsWith('blob:')) throw Error('External resources are not loaded. Export a self-contained GLB or embedded glTF.'); return url; });
    const loader = new GLTFLoader(manager);
    const result = await loader.parseAsync(ext === 'glb' ? await file.arrayBuffer() : await file.text(), '');
    return normalize(result.scene);
  }
  throw Error('Supported model formats: STL, OBJ, GLB and embedded glTF.');
}
