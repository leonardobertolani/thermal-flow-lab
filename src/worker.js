import { ThermalSolver, gridNetwork } from './solver.js';
import { voxelize } from './voxelize.js';
let grid, solver, settings, running = false, speed = 10, last = performance.now();
function send() { if (solver) postMessage({ type: 'state', temperatures: Float32Array.from(solver.T), stats: solver.stats() }); }
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      running = false; settings = data.settings;
      grid = voxelize(data.parts, settings.resolution);
      solver = new ThermalSolver({ ...gridNetwork(grid, settings.material, settings.length, settings.h), initial: settings.initial, ambient: settings.ambient });
      postMessage({ type: 'ready', grid }); send();
    } else if (data.type === 'run') { running = data.value; last = performance.now(); }
    else if (data.type === 'speed') speed = data.value;
    else if (data.type === 'reset') { running = false; solver.reset(settings.initial); send(); }
    else if (data.type === 'clear') { solver.sources.clear(); send(); }
    else if (data.type === 'heat') {
      let closest = -1, best = Infinity;
      const selected = [];
      for (let i = 0; i < solver.T.length; i++) {
        const d = Math.hypot(grid.positions[3 * i] - data.point[0], grid.positions[3 * i + 1] - data.point[1], grid.positions[3 * i + 2] - data.point[2]);
        if (d < best) { best = d; closest = i; }
        if (d <= data.radius) selected.push(i);
      }
      if (!selected.length && closest >= 0) selected.push(closest);
      for (const i of selected) {
        solver.T[i] = data.temperature;
        if (data.mode === 'hold') solver.sources.set(i, data.temperature);
        else solver.sources.delete(i);
      }
      send();
    } else if (data.type === 'export') postMessage({ type: 'export', temperatures: Float64Array.from(solver.T), time: solver.time });
  } catch (error) { running = false; postMessage({ type: 'error', message: error.message }); }
};
setInterval(() => {
  const now = performance.now(), elapsed = Math.min((now - last) / 1000, .15); last = now;
  if (running && solver) { solver.advance(elapsed * speed); send(); }
}, 33);
