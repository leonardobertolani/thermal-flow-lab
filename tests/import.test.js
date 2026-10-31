import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { importModel } from '../src/models.js';
import { voxelize } from '../src/voxelize.js';
const check=parts=>{const g=voxelize(parts,12);assert.equal(g.exposed.length,1728);assert.equal(g.components,1);};
test('OBJ file imports, normalizes units, and produces a solid cube',async()=>{const obj=await readFile(new URL('../public/examples/cube.obj',import.meta.url));check(await importModel(new File([obj],'cube.obj')));});
test('both ASCII and binary STL files produce the same volume',async()=>{
  const exporter=new STLExporter(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));
  for(const binary of [false,true])check(await importModel(new File([exporter.parse(mesh,{binary})],'cube.stl')));
});
function gltfFixture(){
 const geo=new THREE.BoxGeometry(2,2,2).toNonIndexed(),positions=geo.attributes.position.array;
 const bytes=Buffer.from(positions.buffer);
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:bytes.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bytes.length,target:34962}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]}]};
 return {json,bytes};
}
test('embedded glTF imports without external resources',async()=>{const {json,bytes}=gltfFixture();json.buffers[0].uri=`data:application/octet-stream;base64,${bytes.toString('base64')}`;globalThis.ProgressEvent ??= class ProgressEvent {constructor(type,properties){this.type=type;Object.assign(this,properties);}};check(await importModel(new File([JSON.stringify(json)],'cube.gltf')));});
test('self-contained GLB imports its binary geometry',async()=>{
 const {json,bytes}=gltfFixture(),jsonText=JSON.stringify(json),padding=(4-jsonText.length%4)%4,jsonBytes=Buffer.from(jsonText+' '.repeat(padding));
 const glb=Buffer.alloc(12+8+jsonBytes.length+8+bytes.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(jsonBytes.length,12);glb.writeUInt32LE(0x4e4f534a,16);jsonBytes.copy(glb,20);const offset=20+jsonBytes.length;glb.writeUInt32LE(bytes.length,offset);glb.writeUInt32LE(0x004e4942,offset+4);bytes.copy(glb,offset+8);
 check(await importModel(new File([glb],'cube.glb')));
});
test('external glTF resources are rejected, and oversize files receive a clear error',async()=>{
 const {json}=gltfFixture();json.buffers[0].uri='https://example.com/unrequested.bin';await assert.rejects(importModel(new File([JSON.stringify(json)],'cube.gltf')),/External resources/);
 await assert.rejects(importModel(new File([new Uint8Array(16*1024*1024)],'huge.stl')),/smaller than 15 MB/);
});
