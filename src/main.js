import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sampleModel, importModel } from './models.js';

const $ = id => document.getElementById(id);
const presets = { aluminium: { k: 205, rho: 2700, c: 900 }, steel: { k: 50, rho: 7850, c: 490 }, copper: { k: 385, rho: 8960, c: 385 } };
let worker, grid, temperatures, parts, running = false, busy = false, ready = false, brushMode = 'pulse', cellMode = false, history = [], appliedSettings, noticeTimer, latestStats;
const viewport = $('viewport'), scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
catch { $('loading').innerHTML = '<strong>WebGL is unavailable</strong><small>Use a browser with hardware acceleration enabled.</small>'; throw Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .08; controls.minDistance = .3; controls.maxDistance = 6; controls.autoRotateSpeed = .8;
const model = new THREE.Group(), surface = new THREE.Group();
model.add(surface); scene.add(model);
let voxels, surfaceMaps = [];
scene.add(new THREE.HemisphereLight(0xffffff, 0x7894b0, 2.0));
const light = new THREE.DirectionalLight(0xffffff, 2.2); light.position.set(3, 5, 4); scene.add(light);
const ground = new THREE.GridHelper(3, 30, 0x435263, 0x293746); ground.position.y = -.64; ground.material.transparent = true; ground.material.opacity = .25; scene.add(ground);
function fit() { camera.position.set(1.3, .9, 1.65); controls.target.set(0, 0, 0); controls.update(); }
fit();
new ResizeObserver(() => { const w = viewport.clientWidth, h = viewport.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }).observe(viewport);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function notice(message, error = false, persistent = false) {
  clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').className = `visible${error ? ' error' : ''}`;
  if (!persistent) noticeTimer = setTimeout(() => { $('notice').className = ''; }, 6500);
}
function readNumber(id) {
  const input = $(id), value = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(value) || value < Number(input.min || -Infinity) || value > Number(input.max || Infinity)) throw Error(`Enter a valid ${input.labels?.[0]?.textContent.trim() || id} between ${input.min} and ${input.max}.`);
  return value;
}
function settings() { return { resolution: +$('resolution').value, length: readNumber('length'), material: { k: readNumber('k'), rho: readNumber('rho'), c: readNumber('c') }, h: readNumber('h'), initial: readNumber('initial'), ambient: readNumber('ambient') }; }
function setRunning(value) {
  running = value;
  $('play').innerHTML = value ? 'Ⅱ &nbsp; Pause simulation' : '▶ &nbsp; Run simulation';
  $('status').textContent = value ? 'Simulating' : 'Paused'; $('status').classList.toggle('running', value);
  worker?.postMessage({ type: 'run', value });
}
function lock(value) {
  busy = value; $('loading').hidden = !value;
  $('play').disabled = value || !ready;
  $('reset').disabled = value || !ready; $('clear').disabled = value || !ready; $('export').disabled = value || !ready;
}
function disposeModels() {
  while (surface.children.length) { const mesh = surface.children[0]; mesh.geometry.dispose(); mesh.material.dispose(); surface.remove(mesh); }
  if (voxels) { voxels.geometry.dispose(); voxels.material.dispose(); voxels.dispose(); model.remove(voxels); voxels = null; }
}
function nearestCell(x, y, z) {
  const { dims: [nx, ny, nz], lookup, origin, spacing } = grid;
  const cx = Math.floor((x - origin[0]) / spacing), cy = Math.floor((y - origin[1]) / spacing), cz = Math.floor((z - origin[2]) / spacing);
  let best = Infinity, found = -1;
  for (let radius = 1; radius <= 4; radius++) {
    for (let zz = cz - radius; zz <= cz + radius; zz++) for (let yy = cy - radius; yy <= cy + radius; yy++) for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
      const id = lookup[xx + nx * (yy + ny * zz)]; if (id < 0) continue;
      const d = (grid.positions[id * 3] - x) ** 2 + (grid.positions[id * 3 + 1] - y) ** 2 + (grid.positions[id * 3 + 2] - z) ** 2;
      if (d < best) { best = d; found = id; }
    }
    if (found >= 0) return found;
  }
  return -1;
}
function displayModel() {
  disposeModels(); surfaceMaps = [];
  // Subdivide long render triangles to show a meaningful temperature field on
  // even a low-poly imported box. This changes rendering only, not the solver.
  let triangleBudget = 220000, unmapped = 0;
  for (const part of parts) {
    const output = [], target = grid.spacing * 1.8;
    function emit(a, b, c, depth = 0) {
      const ab = a.distanceToSquared(b), bc = b.distanceToSquared(c), ca = c.distanceToSquared(a);
      if (Math.max(ab, bc, ca) > target * target && depth < 8 && triangleBudget > 0) {
        triangleBudget--;
        if (ab >= bc && ab >= ca) { const m = a.clone().add(b).multiplyScalar(.5); emit(a,m,c,depth+1); emit(m,b,c,depth+1); }
        else if (bc >= ca) { const m = b.clone().add(c).multiplyScalar(.5); emit(a,b,m,depth+1); emit(a,m,c,depth+1); }
        else { const m = c.clone().add(a).multiplyScalar(.5); emit(a,b,m,depth+1); emit(m,b,c,depth+1); }
      } else output.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    }
    for (let i = 0; i < part.length; i += 9) emit(new THREE.Vector3().fromArray(part,i), new THREE.Vector3().fromArray(part,i+3), new THREE.Vector3().fromArray(part,i+6));
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(output,3)); geometry.computeVertexNormals();
    const maps = new Int32Array(output.length/3);
    for (let i=0;i<maps.length;i++) { maps[i]=nearestCell(output[3*i],output[3*i+1],output[3*i+2]); if (maps[i]<0) unmapped++; }
    surfaceMaps.push(maps); geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(output.length),3));
    surface.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.7,metalness:.12})));
  }
  voxels=new THREE.InstancedMesh(new THREE.BoxGeometry(grid.spacing*.97,grid.spacing*.97,grid.spacing*.97),new THREE.MeshStandardMaterial({roughness:.7,metalness:.12}),grid.exposed.length);
  const matrix=new THREE.Matrix4();
  for(let i=0;i<grid.exposed.length;i++) { matrix.makeTranslation(grid.positions[3*i],grid.positions[3*i+1],grid.positions[3*i+2]); voxels.setMatrixAt(i,matrix); voxels.setColorAt(i,new THREE.Color('#2457ad')); }
  voxels.instanceMatrix.needsUpdate=true; voxels.visible=cellMode; surface.visible=!cellMode; model.add(voxels);
  if(unmapped) notice('Some surface regions are thinner than this grid can resolve. Inspect volume cells or increase resolution.',true,true);
}
const stops=['#2457ad','#24bdc4','#b7d9ac','#f6b35b','#e74d39'].map(c=>new THREE.Color(c));
const color = new THREE.Color(); let scaleMin=20,scaleMax=180;
function tempColor(t) { const f=THREE.MathUtils.clamp((t-scaleMin)/(scaleMax-scaleMin),0,1)*4,i=Math.min(3,Math.floor(f)); return color.copy(stops[i]).lerp(stops[i+1],f-i); }
function recolor() {
  if(!temperatures || !voxels) return;
  // Scale stays fixed for a run, but expands if a new brush temperature exceeds it.
  $('scale-min').textContent=`${Math.round(scaleMin)}°`; $('scale-mid').textContent=`${Math.round((scaleMin+scaleMax)/2)}°`; $('scale-max').textContent=`${Math.round(scaleMax)}°`;
  for(let i=0;i<temperatures.length;i++) voxels.setColorAt(i,tempColor(temperatures[i]));
  voxels.instanceColor.needsUpdate=true;
  surface.children.forEach((mesh,j)=>{const attr=mesh.geometry.getAttribute('color'), map=surfaceMaps[j];for(let i=0;i<map.length;i++){if(map[i]<0)color.set('#68727d');else tempColor(temperatures[map[i]]);attr.setXYZ(i,color.r,color.g,color.b);}attr.needsUpdate=true;});
}
function plot(stats) {
  const last=history.at(-1); if(last?.time===stats.time)history[history.length-1]=stats;else history.push(stats);
  if(history.length>250)history.shift();
  const start=history[0].time,end=Math.max(start+.001,stats.time);
  const x = t => 54 + (t-start)/(end-start)*530;
  const y = t => 204 - (t-scaleMin)/(scaleMax-scaleMin)*180;
  const ticks = [0,.25,.5,.75,1].map(f => {
    const t=scaleMin+(scaleMax-scaleMin)*f, yy=y(t);
    return `<line x1="54" y1="${yy}" x2="584" y2="${yy}" stroke="#344453" stroke-dasharray="3 5"/><text x="44" y="${yy+4}" text-anchor="end">${t.toFixed(0)}°</text>`;
  }).join('');
  const lines=[['min','#4ca8e6'],['mean','#b8d7b0'],['max','#eea15d']].map(([field,c])=>`<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" points="${history.map(s=>`${x(s.time)},${y(s[field])}`).join(' ')}"/>`).join('');
  const dots=history.length===1?['min','mean','max'].map((field,i)=>`<circle cx="54" cy="${y(stats[field])}" r="3" fill="${['#4ca8e6','#b8d7b0','#eea15d'][i]}"/>`).join(''):'';
  $('chart').innerHTML=`${ticks}${lines}${dots}<text x="54" y="230">${start.toFixed(1)} s</text><text x="584" y="230" text-anchor="end">${stats.time.toFixed(1)} s</text>`;
}
function onState(data) {
  temperatures=data.temperatures;latestStats=data.stats;recolor();
  for(const key of ['min','mean','max'])$(key).innerHTML=`${data.stats[key].toFixed(1)}<small> °C</small>`;
  $('time').innerHTML=`${data.stats.time.toFixed(2)} <small>s</small>`;$('info-time').textContent=`${data.stats.time.toFixed(2)} s`;plot(data.stats);
  const dx=grid.spacing*appliedSettings.length;
  $('network').textContent=`${temperatures.length.toLocaleString()} cells · ${(dx*1000).toFixed(1)} mm · ${grid.components} thermal ${grid.components===1?'island':'islands'} · ${data.stats.sources} held cells`;
}
async function rebuild(nextParts=parts) {
  let config; try {config=settings();}catch(error){lock(false);notice(error.message,true);return;}
  worker?.terminate(); ready=false; setRunning(false); lock(true);$('status').textContent='Building';$('notice').className='';parts=nextParts;appliedSettings=config;history=[];temperatures=null;
  scaleMin=Math.min(config.initial,config.ambient);scaleMax=Math.max(config.initial+1,config.ambient,+$('heat').value||180);
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onerror=event=>{ready=false;lock(false);$('status').textContent='Error';notice(event.message||'Simulation worker failed.',true,true);};
  const activeWorker=worker;
  worker.onmessage=({data})=>{
    if(worker!==activeWorker)return;
    if(data.type==='ready'){
      grid=data.grid;
      try{displayModel();ready=true;lock(false);$('status').textContent='Ready';$('dirty').hidden=true; if(grid.components>1)notice(`${grid.components} separate thermal islands. Heat crosses only occupied neighboring cells.`,false,true);}catch(error){ready=false;lock(false);notice(error.message,true,true);}
    }else if(data.type==='state'&&ready)onState(data);
    else if(data.type==='error'){ready=false;lock(false);$('status').textContent='Error';notice(data.message,true,true);}
    else if(data.type==='export')downloadCSV(data);
  };
  worker.postMessage({type:'init',parts,settings:config}); worker.postMessage({type:'speed',value:+$('speed').value});
}
function heatAt(point) {
  if(busy||!ready)return;
  try{const temperature=readNumber('heat');scaleMin=Math.min(scaleMin,temperature);scaleMax=Math.max(scaleMax,temperature);worker.postMessage({type:'heat',point:point.toArray(),radius:+$('radius').value/100,temperature,mode:brushMode});notice(brushMode==='pulse'?'Heat pulse applied. Press Run to watch it spread.':'Held heater added. It stays at the selected temperature.');}catch(error){notice(error.message,true);}
}
let down;
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0)down={x:e.clientX,y:e.clientY,time:performance.now()};});
renderer.domElement.addEventListener('pointerup',e=>{
  if(!down||e.button!==0)return;const click=Math.hypot(e.clientX-down.x,e.clientY-down.y)<5&&performance.now()-down.time<650;down=null;if(!click||busy||!ready)return;
  const rect=renderer.domElement.getBoundingClientRect(), pointer=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
  const hits=cellMode?ray.intersectObject(voxels):ray.intersectObjects(surface.children);if(hits.length)heatAt(hits[0].point);
});
renderer.domElement.addEventListener('pointercancel',()=>{down=null;});
$('play').onclick=()=>{if(ready&&!busy)setRunning(!running);};
$('reset').onclick=()=>{setRunning(false);history=[];worker.postMessage({type:'reset'});};
$('clear').onclick=()=>{worker.postMessage({type:'clear'});notice('Held heaters released. Existing heat continues to diffuse.');};
$('speed').onchange=()=>worker?.postMessage({type:'speed',value:+$('speed').value});
$('home').onclick=fit;
$('cells').onclick=()=>{cellMode=!cellMode;$('cells').setAttribute('aria-pressed',cellMode);if(voxels)voxels.visible=cellMode;surface.visible=!cellMode;};
$('rotate').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('rotate').setAttribute('aria-pressed',controls.autoRotate);};
$('radius').oninput=()=>$('radius-label').textContent=`${$('radius').value}% of length`;
for(const mode of ['pulse','hold'])$(mode).onclick=()=>{brushMode=mode;for(const m of ['pulse','hold']){$(m).classList.toggle('active',m===mode);$(m).setAttribute('aria-pressed',m===mode);}$('brush-hint').textContent=mode==='pulse'?'Click the solid to set a warm region. It then evolves freely.':'Click to hold a region at this temperature using an ideal heater.';};
$('material').onchange=()=>{const material=presets[$('material').value];if(material)for(const key of ['k','rho','c'])$(key).value=material[key];$('dirty').hidden=false;};
for(const id of ['k','rho','c','initial','ambient','h','length','resolution'])$(id).addEventListener('input',()=>{$('dirty').hidden=false;if(['k','rho','c'].includes(id))$('material').value='custom';});
$('rebuild').onclick=()=>{if(!busy)rebuild();};
for(const button of document.querySelectorAll('[data-sample]'))button.onclick=()=>{
  if(busy)return;try{settings();}catch(error){notice(error.message,true);return;}const name=button.dataset.sample;
  document.querySelectorAll('[data-sample]').forEach(b=>b.classList.toggle('active',b===button));$('model-name').textContent={pipe:'Hollow pipe',piston:'Piston & cutaway cylinder',block:'Solid block',flange:'Flanged pipe',heatsink:'Finned heat sink',shaft:'Stepped shaft'}[name];fit();rebuild(sampleModel(name));
};
$('upload').onchange=async e=>{
  const file=e.target.files[0];if(!file||busy)return;
  try{settings();}catch(error){notice(error.message,true);$('upload').value='';return;}
  setRunning(false);lock(true);
  try{const imported=await importModel(file);document.querySelectorAll('[data-sample]').forEach(b=>b.classList.remove('active'));$('model-name').textContent=file.name;fit();await rebuild(imported);}catch(error){lock(false);notice(error.message,true,true);}finally{$('upload').value='';}
};
function bindDialog(trigger, dialogId, close) {
  const dialog=$(dialogId);
  $(trigger).onclick=()=>dialog.showModal();
  $(close).onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{
    if(e.target!==dialog)return;
    const r=dialog.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();
  });
}
bindDialog('about','math-dialog','close-about');
bindDialog('information','info-dialog','close-information');
$('export').onclick=()=>worker.postMessage({type:'export'});
function downloadCSV(data) {
  const s=appliedSettings, rows=[`# Thermal Flow Lab; time_s=${data.time}; k_W_mK=${s.material.k}; rho_kg_m3=${s.material.rho}; c_J_kgK=${s.material.c}; dx_m=${grid.spacing*s.length}; ambient_C=${s.ambient}; h_W_m2K=${s.h}`,'cell,x_m,y_m,z_m,temperature_C'];
  for(let i=0;i<data.temperatures.length;i++)rows.push(`${i},${grid.positions[3*i]*s.length},${grid.positions[3*i+1]*s.length},${grid.positions[3*i+2]*s.length},${data.temperatures[i]}`);
  const url=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download=`thermal-flow-${data.time.toFixed(2)}s.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
rebuild(sampleModel('pipe'));
