// Sparse matrix-vector evaluation of the precomputed Forward Euler operator Γ.
// Conductance G = 1/R; heat capacity C = m*c. The final matrix row/column is
// a fixed ambient-temperature node, which keeps convection in the same ΓT step.
export class ThermalSolver {
  constructor({ capacity, edges, boundary, initial = 20, ambient = 20 }) {
    this.capacity = Float64Array.from(capacity);
    if (!this.capacity.length || this.capacity.some(v => !(v > 0) || !Number.isFinite(v))) throw Error('Heat capacities must be positive and finite.');
    this.edges = edges;
    this.boundary = Float64Array.from(boundary ?? capacity.map(() => 0));
    this.ambient = ambient;
    this.sources = new Map();
    this.time = 0;

    const rowConductance = this.boundary.slice();
    for (const [i, j, g] of edges) { rowConductance[i] += g; rowConductance[j] += g; }
    let maxRate = 0;
    for (let i = 0; i < rowConductance.length; i++) maxRate = Math.max(maxRate, rowConductance[i] / this.capacity[i]);
    // Sufficient positivity bound, stricter than the spectral stability limit.
    this.dtMax = maxRate > 0 ? 0.9 / maxRate : Infinity;

    const n = this.capacity.length;
    this.state = new Float64Array(n + 1);
    this.nextState = new Float64Array(n + 1);
    this.state.fill(initial, 0, n);
    this.state[n] = ambient;
    this.nextState[n] = ambient;
    this.T = this.state.subarray(0, n);
    this.next = this.nextState.subarray(0, n);

    const rows = Array.from({ length: n + 1 }, (_, i) => [[i, i === n ? 0 : -rowConductance[i] / this.capacity[i], 1]]);
    for (const [i, j, g] of edges) {
      rows[i].push([j, g / this.capacity[i], 0]);
      rows[j].push([i, g / this.capacity[j], 0]);
    }
    for (let i = 0; i < n; i++) if (this.boundary[i] !== 0) rows[i].push([n, this.boundary[i] / this.capacity[i], 0]);

    const nonzeros = rows.reduce((sum, row) => sum + row.length, 0);
    this._rowOffsets = new Uint32Array(n + 2);
    this._columnIndices = new Uint32Array(nonzeros);
    this._rates = new Float64Array(nonzeros);
    this._identity = new Uint8Array(nonzeros);
    let p = 0;
    for (let i = 0; i < rows.length; i++) {
      this._rowOffsets[i] = p;
      rows[i].sort((a, b) => a[0] - b[0]);
      for (const [column, rate, identity] of rows[i]) {
        this._columnIndices[p] = column;
        this._rates[p] = rate;
        this._identity[p] = identity;
        p++;
      }
    }
    this._rowOffsets[n + 1] = p;

    // The common stable-step Γ is assembled once and reused for every full step.
    // An isolated system has Γ = I for every finite dt, so dt = 0 is sufficient.
    this.gamma = this._makeGamma(Number.isFinite(this.dtMax) ? this.dtMax : 0);
    this._partialGamma = this._makeGamma(0);
  }

  _makeGamma(dt) {
    const values = new Float64Array(this._rates.length);
    this._fillGamma(dt, values);
    return {
      dt,
      size: this.capacity.length + 1,
      rowOffsets: this._rowOffsets,
      columnIndices: this._columnIndices,
      values
    };
  }

  _fillGamma(dt, values) {
    for (let p = 0; p < values.length; p++) values[p] = this._identity[p] + dt * this._rates[p];
  }

  _gammaFor(dt) {
    if (!Number.isFinite(this.dtMax)) return this.gamma;
    const tolerance = 1e-12 * Math.max(1, this.dtMax);
    if (Math.abs(dt - this.gamma.dt) <= tolerance) return this.gamma;
    this._partialGamma.dt = dt;
    this._fillGamma(dt, this._partialGamma.values);
    return this._partialGamma;
  }

  reset(initial) {
    this.state.fill(initial, 0, this.capacity.length);
    this.state[this.capacity.length] = this.ambient;
    this.sources.clear();
    this.time = 0;
  }

  step(dt) {
    if (!(dt > 0) || !Number.isFinite(dt) || dt > this.dtMax * (1 + 1e-12)) throw Error('Unsafe time step.');
    const gamma = this._gammaFor(dt);
    const { rowOffsets, columnIndices, values } = gamma;
    const n = this.capacity.length;
    for (const [i, temperature] of this.sources) this.state[i] = temperature;
    this.state[n] = this.ambient;

    for (let row = 0; row < gamma.size; row++) {
      let value = 0;
      for (let p = rowOffsets[row]; p < rowOffsets[row + 1]; p++) value += values[p] * this.state[columnIndices[p]];
      this.nextState[row] = value;
    }
    for (const [i, temperature] of this.sources) this.nextState[i] = temperature;

    [this.state, this.nextState] = [this.nextState, this.state];
    this.T = this.state.subarray(0, n);
    this.next = this.nextState.subarray(0, n);
    this.time += dt;
  }

  advance(duration, maxSteps = 250) {
    let remaining = duration, steps = 0;
    while (remaining > 1e-10 && steps < maxSteps) {
      const dt = Math.min(remaining, this.dtMax);
      this.step(dt); remaining -= dt; steps++;
    }
    return duration - remaining;
  }

  stats() {
    let min = Infinity, max = -Infinity, energy = 0, capacity = 0;
    for (let i = 0; i < this.T.length; i++) {
      min = Math.min(min, this.T[i]); max = Math.max(max, this.T[i]);
      energy += this.T[i] * this.capacity[i]; capacity += this.capacity[i];
    }
    return { min, max, mean: energy / capacity, energy, time: this.time, dtMax: this.dtMax, sources: this.sources.size };
  }
}

export function gridNetwork(grid, material, physicalLength, convection) {
  const { positions, neighbors, exposed } = grid;
  const dx = grid.spacing * physicalLength;
  const capacity = new Float64Array(positions.length / 3).fill(material.rho * material.c * dx ** 3);
  const edges = neighbors.map(([i, j]) => [i, j, material.k * dx]);
  const boundary = Float64Array.from(exposed, faces => convection * faces * dx ** 2);
  return { capacity, edges, boundary };
}
