import test from 'node:test';
import assert from 'node:assert/strict';
import { ThermalSolver, gridNetwork } from '../src/solver.js';
import { voxelize } from '../src/voxelize.js';
import { sampleModel } from '../src/models.js';
import * as THREE from 'three';
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

function multiply(matrix, vector) {
  const out=new Float64Array(matrix.size);
  for(let row=0;row<matrix.size;row++) for(let p=matrix.rowOffsets[row];p<matrix.rowOffsets[row+1];p++) out[row]+=matrix.values[p]*vector[matrix.columnIndices[p]];
  return out;
}

test('precomputed sparse Gamma equals a dense matrix-vector update with unequal capacities',()=>{
  const capacity=[2,5,9],edges=[[0,1,.7],[1,2,1.2],[0,2,.1]],T=[180,10,45];
  const s=new ThermalSolver({capacity,edges});s.T.set(T);
  const gamma=s.gamma,expected=multiply(gamma,[...T,s.ambient]);
  s.step(s.dtMax);
  assert.equal(s.gamma,gamma);
  expected.slice(0,T.length).forEach((t,i)=>close(s.T[i],t));
});

test('Gamma augments the temperature vector with a fixed ambient node',()=>{
  const s=new ThermalSolver({capacity:[10,4],edges:[[0,1,3]],boundary:[2,1],ambient:15});
  const gamma=s.gamma;
  const dense=Array.from({length:gamma.size},()=>Array(gamma.size).fill(0));
  for(let i=0;i<gamma.size;i++) for(let p=gamma.rowOffsets[i];p<gamma.rowOffsets[i+1];p++) dense[i][gamma.columnIndices[p]]+=gamma.values[p];
  close(dense[0][0],1-s.dtMax*5/10);close(dense[0][1],s.dtMax*3/10);close(dense[0][2],s.dtMax*2/10);
  close(dense[1][0],s.dtMax*3/4);close(dense[1][1],1-s.dtMax*4/4);close(dense[1][2],s.dtMax/4);
  assert.deepEqual(dense[2],[0,0,1]);
  for(const row of dense)close(row.reduce((a,b)=>a+b,0),1);
});
test('isolated unequal-capacity pair conserves energy and converges to weighted equilibrium',()=>{
  const s=new ThermalSolver({capacity:[2,7],edges:[[0,1,1]]});s.T.set([100,10]);
  const before=s.stats().energy;s.advance(100,10000);
  close(s.stats().energy,before,1e-8);close(s.T[0],270/9,1e-7);close(s.T[1],270/9,1e-7);
});
test('single body follows analytical Newton cooling within Euler truncation error',()=>{
  const s=new ThermalSolver({capacity:[10],edges:[],boundary:[2],ambient:20,initial:100});
  for(let i=0;i<10000;i++)s.step(.001);
  close(s.T[0],20+80*Math.exp(-2),.003);
});
test('stable step retains the temperature bounds over a nonuniform graph',()=>{
  const s=new ThermalSolver({capacity:[.01,1,10],edges:[[0,1,9],[1,2,40]],boundary:[1,2,3],ambient:5});s.T.set([200,10,40]);
  for(let i=0;i<1000;i++){s.step(s.dtMax);for(const t of s.T)assert.ok(t>=5&&t<=200);}
  assert.throws(()=>s.step(s.dtMax*2),/Unsafe/);
});
test('held source is exact and release returns the network to free diffusion',()=>{
  const s=new ThermalSolver({capacity:[1,1],edges:[[0,1,1]],initial:20});s.sources.set(0,180);s.step(.1);
  close(s.T[0],180);close(s.T[1],36);s.sources.clear();const e=s.stats().energy;s.step(.1);assert.ok(s.T[0]<180);close(s.stats().energy,e);
});
test('step budget caps work without lying about simulated time',()=>{
  const s=new ThermalSolver({capacity:[1,1],edges:[[0,1,10]]});const actual=s.advance(1000,10);close(actual,s.time);assert.ok(actual<1000);assert.ok(actual>0);
});
test('disconnected objects do not exchange heat',()=>{
  const s=new ThermalSolver({capacity:[1,1,1],edges:[[0,1,1]],initial:20});s.T[0]=180;s.advance(10,1000);close(s.T[2],20);
});
test('each built-in model produces a closed, occupied volume with reciprocal edges',()=>{
  for(const name of ['pipe','piston','block','flange','heatsink','shaft']){
    const g=voxelize(sampleModel(name),24);assert.ok(g.positions.length>0);assert.ok(g.neighbors.length>0);
    const degree=new Uint8Array(g.exposed.length);for(const[i,j]of g.neighbors){degree[i]++;degree[j]++;}
    for(let i=0;i<degree.length;i++)assert.equal(degree[i]+g.exposed[i],6);
    if(name!=='piston')assert.equal(g.components,1);
    if(name==='piston')assert.ok(g.components>=2);
    const s=new ThermalSolver({...gridNetwork(g,{k:205,rho:2700,c:900},.24,0),initial:20});s.T[0]=180;const before=s.stats().energy;s.advance(1,500);close(s.stats().energy,before,1e-6);
  }
});
test('closed cube voxelization has the expected volume and boundary area',()=>{
  const geo=new THREE.BoxGeometry(1,1,1).toNonIndexed();const g=voxelize([geo.attributes.position.array],12);assert.equal(g.exposed.length,12**3);assert.equal(g.exposed.reduce((a,b)=>a+b,0),6*12**2);
});
test('open surfaces are rejected instead of inventing a solid interior',()=>{
  const geo=new THREE.PlaneGeometry(1,1).toNonIndexed();assert.throws(()=>voxelize([geo.attributes.position.array],12),/open or non-manifold/);
});

test('new engineering samples stay connected at every offered resolution',()=>{
  for(const name of ['flange','heatsink','shaft']) for(const resolution of [24,36,48]) {
    const g=voxelize(sampleModel(name),resolution);
    assert.equal(g.components,1,`${name} at ${resolution} cells must be one conducting solid`);
    assert.ok(g.exposed.length>100);
  }
});
