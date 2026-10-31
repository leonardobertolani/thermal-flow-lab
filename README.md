# Thermal Flow Lab

A local, interactive 3D heat-diffusion application based on Leonardo's thermodynamics study and its fully vectorized Γ iteration.

## Start here

Open a terminal and run:

```bash
cd ~/Desktop/thermal-flow-lab
./start.sh
```

The launcher starts Vite on localhost and opens your browser. Alternatively, use `npm run dev` and open the Local URL printed in the terminal, normally http://127.0.0.1:5173. If that port is occupied, use the next port Vite prints. Leave the terminal running; Ctrl+C stops the app.

Node.js 22.12+ (or a supported newer LTS) and npm are required. This machine was tested with Node 24.13.0. Dependencies are included in the prepared folder; `npm ci` restores their exact locked versions if needed. No Python installation, cloud account, API key or GPU-compute installation is needed. The browser needs WebGL.

Do not double-click `index.html`: JavaScript modules and workers need the local HTTP server. The server binds to 127.0.0.1, not your network interfaces. Once dependencies are installed, the app works without Internet access. Imported files are read inside the browser; they are not uploaded to a remote service.

## First experiment

1. Leave **Pipe**, aluminium, 0.24 m, balanced resolution, initial 20°C and convection h = 0 selected.
2. Click somewhere on the pipe. A spherical region is set to the brush temperature, initially 180°C. The clock remains paused until you start it.
3. Choose **Run simulation**. The red/orange region cools while its neighbors warm.
4. Drag to orbit, scroll to zoom, or right-drag to pan while heat continues to spread. A short click applies heat; a drag moves the camera. The Fit view button restores the camera. Auto orbit rotates the view continuously.
5. Pause, place more hot spots, and resume. You can also place spots during a run. Setting a lower brush temperature creates a cold spot.
6. Switch **Volume cells** on to see the actual discretized domain. The smooth surface is a visualization of this field, not a separate solver.
7. Choose **Export CSV** to save cell coordinates in metres and temperatures in Celsius at the exported simulation time.

The temperature legend uses a fixed range for each run, expanding if you apply a hotter or colder brush. It does not constantly rescale as the body cools. Lighting changes the perceived surface colors slightly; the numeric readouts and CSV contain the quantitative values.

## Controls and interpretation

- **Geometry:** pipe, solid block, piston with a cutaway cylinder, flanged pipe, finned heat sink, and stepped shaft. The piston assembly is static; the camera can move, but this does not simulate engine motion.
- **Import:** ASCII/binary STL, OBJ geometry, self-contained GLB, or embedded glTF. Maximum 15 MB and 150,000 source triangles. STEP/IGES need conversion first. glTF external resources and compressed geometry requiring additional decoder libraries are not supported. Use static, uncompressed, closed solid meshes. Textures, animation and source materials are not needed for temperature rendering.
- **Longest dimension:** the longest extent of the complete imported assembly in metres. Source units are deliberately normalized; always enter the real physical size. Relative proportions and component transforms are preserved.
- **Volume grid:** 24, 36, or 48 cells along the longest bounding-box dimension. Smaller features need finer resolution. Empty space contains no heat-conducting cells.
- **Material:** conductivity k in W/(m·K), density ρ in kg/m³, and specific heat c in J/(kg·K). Presets are illustrative constant values, not certified properties for a particular alloy or temperature. Editing a property selects Custom material.
- **Initial temperature:** the temperature of every occupied cell after reset.
- **Ambient and convection h:** h = 0 means insulated boundaries. Positive h couples exposed cell faces to fixed ambient air. Cavity faces are treated as exposed too; the app does not solve the air inside a cavity.
- **Apply settings & reset:** rebuilds the network with the current geometry/material/grid settings, clears heaters, and restarts time. Merely editing a field does not silently alter the running experiment.
- **Heat pulse:** overwrites the selected region's current temperature once. It is an imposed initial condition/local thermal intervention, not a heater of specified wattage. A pulse on a held cell releases that cell's thermostat.
- **Hold temperature:** creates ideal fixed-temperature cells. An external source supplies or removes whatever energy is needed. Later overlapping held spots replace the earlier setpoint.
- **Brush radius:** a sphere in 3D measured as a percentage of longest dimension. It can reach nearby pieces if they lie within the sphere; this is intentional brush placement, not conduction across air. If no cell center lies within the sphere, the nearest occupied cell is selected.
- **Release held heaters:** removes thermostats while retaining the current temperature field.
- **Reset:** restores the applied initial temperature, removes heaters, clears history, and pauses.
- **Speed:** requests 1×, 10×, 50× or 200× simulated time. Work per worker tick is bounded. If your computer cannot keep up, simulation time advances more slowly than the requested speed; it never skips physics time steps. The displayed clock is actual integrated simulation time.
- **Temperature information:** click the circular **i** button beside the temperature color scale to open the dedicated panel. It shows minimum, maximum and heat-capacity-weighted average across all occupied cells, with a larger live history chart and simulated-time labels. Readings continue updating while the panel is open. Close it with ×, Escape, or a click outside, just like the mathematics panel. The history chart retains the latest 250 received states; it is not an archival time-series recorder.
- **New engineering samples:** the flanged pipe has a continuous hollow bore and thicker end flanges; the heat sink has five fins joined to a base; the stepped shaft has several changes in diameter. Each is a connected, closed solid and uses the same volumetric heat solver.

Reloading the page starts a new experiment. There is no persistent project/session storage in this version. CSV exports save a temperature snapshot, not a restartable project.

## How your equation is used

The fully vectorized update is

```text
T_next = Γ T
Γ = diag(1 − M_R · 1) + M_R
(M_R)_ij = Δt / (C_i R_ij)
```

Let C_i = m_i c_i and G_ij = 1/R_ij. For a fixed step Δt, Γ is static: it can be assembled once and reused at every iteration. Its equivalent component form is

```text
T_i,next = T_i + Δt/C_i · Σ_j G_ij (T_j − T_i)
```

This is the update implemented in `src/solver.js`. It is not an animation that only resembles diffusion: every displayed time step is a Γ matrix–vector multiplication in this thermal network.

The voxel grid gives each cell at most six conducting neighbors, so nearly all entries of the dense Γ matrix would be zero. The app assembles only its nonzero entries in compressed sparse row form. Each full stable step reuses the same stored Γ and streams its rows through the old temperature vector into a separate next vector. A shorter remainder step uses the same sparsity structure with coefficients scaled to that Δt.

This is a sparse JavaScript matrix multiplication rather than a dense NumPy or GPU multiplication. With at most six neighbors per cell, storage and work per step are O(N + E), approximately O(N), rather than the dense O(N²). Matrix indices, coefficients and the two temperature vectors use typed arrays. Visualization snapshots use Float32Array; exports and the solver use Float64 values.

For a cubic cell of physical width Δx:

```text
volume = Δx³
m = ρ Δx³
C = ρ c Δx³
G_neighbor = k A / distance = k Δx
R_neighbor = 1/(k Δx)
```

The interior update therefore becomes the familiar six-neighbor approximation to ∂T/∂t = [k/(ρc)]∇²T. This follows the same discretization you describe in the final part of your README.

For each exposed face, G_ambient = h Δx². The ambient term is Δt G_ambient(T_ambient − T_i)/C_i. The solver appends one fixed ambient node to the temperature vector and one identity row to Γ. The solid-to-ambient coefficients then live in the same matrix as the solid-to-solid coefficients. Thermostat cells are clamped exactly before and after each multiplication.

Celsius is valid here because only temperature differences enter the conduction and convection equations. A one-degree Celsius difference equals a one-kelvin difference. Adding radiation would require absolute temperatures in kelvin and a different model.

### Stability

A fixed large Δt can make Forward Euler oscillate or produce impossible temperatures. The app computes

```text
Δt_max = 0.9 min_i [C_i / (Σ_j G_ij + G_i,ambient)]
```

Every step is at most this bound. The update then has nonnegative weights: without external interventions, a temperature cannot jump outside the range of its old neighbors and ambient. This is a sufficient positivity/stability condition, rather than the least restrictive spectral bound. Higher conductivity, smaller cells and lower heat capacity require shorter steps.

In an insulated network without held sources, symmetric edge conductance makes the total Σ_i C_i T_i constant up to roundoff. For a connected system, equilibrium is the weighted mean Σ_i C_i T_i / Σ_i C_i, matching your two-body result. For disconnected parts, each island has its own conserved energy and equilibrium. Ambient exchange and ideal heaters intentionally break conservation within the solid alone.

## Software and architecture

| Component | Purpose |
|---|---|
| JavaScript ES modules, HTML, CSS | Local application, input handling, UI and responsive layout; no frontend framework required |
| Three.js | WebGL rendering, camera, OrbitControls, raycast selection, STL/OBJ/glTF loaders |
| three-mesh-bvh | Spatial acceleration for the many mesh-ray intersections used to fill the object with cells |
| Web Worker | Builds the thermal domain and advances the solver away from the rendering/UI thread |
| Typed arrays | Compact sparse Γ storage, numerical vectors and efficient messages to the renderer |
| Vite | Development server, dependency bundling, worker bundling and production build |
| Node's built-in test runner | Numerical, geometry and import regression checks |

The worker is the computation thread; WebGL is used for graphics, not heat computation. A worker is sufficient for the current modest grids and keeps camera interaction independent of the solver. Geometry parsing and creation of render meshes still run on the main thread, so a very large import can briefly pause the interface during setup. Rendering every temperature snapshot also has a cost. This is not a claim of unlimited model size or guaranteed frame rate.

```text
Local model file or procedural sample
                ↓
Normalize assembly transforms and overall dimensions
                ↓
Worker: validate closed edges → raycast volume → occupied cells
                ↓
Sparse Γ + physical heat capacities/conductances
                ↓
Stable Euler updates in the worker
                ↓
Temperature snapshots → surface colors / cell colors / readouts
                ↑
Click raycast → brush position, radius, temperature and mode
```

The camera operates solely on the view; orbiting/panning does not change coordinates, conductances, or heat flow. Object pose has no physical effect under this orientation-independent conduction model.

## Geometry approximation and limits

The volume is an axis-aligned cubic grid. Each cell center is classified as inside or outside closed triangle shells using ray intersection pairs. Separate mesh parts are combined as an occupied union. Shared face neighbors conduct; there is no distance-based heat transfer across empty cells. Per-mesh boundary/non-manifold edge checks catch common open-surface exports, but do not constitute a complete CAD validity check. Self-intersections, overlapping shells inside a single mesh and nested ambiguities may produce incorrect volumes. Inspect the cell view when importing complex assemblies.

A grid is straightforward and directly aligned with your derivation, but it introduces staircase boundaries. This affects both volume and exposed surface area. Curved-surface convection uses voxel face area, not the exact CAD surface area. Thin walls can disappear, narrow gaps can bridge, and disconnected details can be lost. The mesh need not have uniformly sized triangles; the simulation grid is independent of the display tessellation. Long display triangles are subdivided for coloring, and render vertices sample nearby occupied cells. Unmapped surface areas are shown grey with a warning. Surface coloring does not add physical resolution.

The physical assumptions are: a single homogeneous isotropic material, constant k/ρ/c, conduction through occupied volume, optional linear convection, and imposed temperatures. This version does not include radiation, phase change, temperature-dependent properties, fluid flow, pressure/compression, moving piston geometry, multi-material interfaces, explicit contact resistance, or separate environmental temperatures per face. It visualizes temperature evolution; it does not currently draw heat-flux arrows.

This is a tested exploratory simulator, not a mesh-converged or experimentally validated engineering solver. The mathematical unit checks do not validate every imported geometry or a real piston assembly. Compare 24/36/48 resolution, physical dimensions, and material properties before interpreting a particular result quantitatively. A finer tetrahedral finite-volume/FEM mesh would be a natural next step for accurate curved boundaries and contact modeling, while retaining the same network perspective.

## Files and development

- `src/solver.js`: sparse Γ construction and multiplication, stability bound, energy statistics.
- `src/voxelize.js`: closure checks, BVH ray filling, face adjacency, thermal island counting.
- `src/worker.js`: worker messages, timers, heat brushes, thermostats and exports.
- `src/models.js`: procedural models and local-file loading/normalization.
- `src/main.js`: renderer, controls, surface-to-cell mapping, UI and charts.
- `src/style.css` and `index.html`: interface and in-app mathematical explanation.
- `tests/`: numerical and geometry/import regression tests.
- `public/examples/cube.obj`: small watertight import fixture.
- `VALIDATION.md`: recorded checks and their limits.
- `package-lock.json`: reproducible dependency versions.

```bash
npm test           # run tests
npm run build      # create dist/ static production bundle
npm run preview    # serve the production build locally
```

The built `dist/` directory can also be served by a local static server, for example `python3 -m http.server 8080 --bind 127.0.0.1 --directory dist`. Python is optional and only acts as a file server in that case. There is no Python solver backend.

## Deployment

Every push to `main` runs the numerical/import tests, creates a production Vite build, and deploys `dist/` to GitHub Pages. The published application is available at:

<https://leonardobertolani.github.io/thermal-flow-lab/>

The workflow lives in `.github/workflows/pages.yml`. GitHub Pages must use **GitHub Actions** as its publishing source in the repository settings.

## References

- [On Heat Diffusion Equations](https://leonardobertolani.github.io/2026/07/24/on-heat-diffusion-equations.html), particularly “Second attempt: full matrix-vector form” and the derivation of the three-dimensional heat equation.
- [Three.js installation guide](https://threejs.org/manual/en/installation.html), [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [STLLoader](https://threejs.org/docs/pages/STLLoader.html), [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).
- [three-mesh-bvh repository](https://github.com/gkjohnson/three-mesh-bvh).
- [Vite guide](https://vite.dev/guide/).
