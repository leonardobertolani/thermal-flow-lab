# Thermal Flow Lab

A local, interactive 3D heat-diffusion application based on a brief thermodynamics study of mine. You can find the details on the mathematical derivations [here](https://leonardobertolani.github.io/2026/07/24/on-heat-diffusion-equations.html), and [here](https://leonardobertolani.github.io/thermal-flow-lab/) is a running application hosted on my website.

I developed this simulation app mainly with the help of ChatGPT 6 Astra, while the underlying mathematics and implications has been fully formulated by me.

## How to use it

Open a terminal, move into the project folder, and run:

```bash
./start.sh
```

The launcher starts Vite on localhost and opens your browser. Alternatively, use `npm run dev` and open the Local URL printed in the terminal, normally http://127.0.0.1:5173.

## Controls and interpretation

- **Geometry:** some preloaded static objects ready to use.
- **Import:** ASCII/binary STL, OBJ geometry, self-contained GLB, or embedded glTF. Maximum 15 MB and 150,000 source triangles. STEP/IGES need conversion first. glTF external resources and compressed geometry requiring additional decoder libraries are not supported. Use static, uncompressed, closed solid meshes. Textures, animation and source materials are not needed for temperature rendering.
- **Longest dimension:** the longest extent of the complete imported assembly in metres. Source units are deliberately normalized; always enter the real physical size. Relative proportions and component transforms are preserved.
- **Volume grid:** 24, 36, or 48 cells along the longest bounding-box dimension. Smaller features need finer resolution.
- **Material:** conductivity k in W/(m·K), density ρ in kg/m³, and specific heat c in J/(kg·K). Presets are illustrative constant values, not certified properties for a particular alloy or temperature.
- **Initial temperature:** the temperature of every occupied cell after reset.
- **Ambient and convection h:** h = 0 means insulated boundaries, thus no heat exhance with the environment. Positive h couples exposed cell faces to fixed ambient air. Cavity faces are treated as exposed too; the app does not solve the air inside a cavity. The environment keeps a steady temperature over time.
- **Apply settings & reset:** rebuilds the network with the current geometry/material/grid settings, clears heaters, and restarts time.
- **Heat pulse:** overwrites the selected region's current temperature once. It is an imposed initial condition/local thermal intervention.
- **Hold temperature:** creates ideal fixed-temperature cells. An external source supplies or removes whatever energy is needed.
- **Brush radius:** a sphere in 3D measured as a percentage of longest dimension. It can reach nearby pieces if they lie within the sphere. If no cell center lies within the sphere, the nearest occupied cell is selected.
- **Release held heaters:** removes thermostats while retaining the current temperature field.
- **Reset:** restores the applied initial temperature, removes heaters, clears history, and pauses.
- **Speed:** requests 1×, 10×, 50× or 200× simulated time. Work per worker tick is bounded. If your computer cannot keep up, simulation time advances more slowly than the requested speed; it never skips physics time steps. The displayed clock is actual integrated simulation time.
- **Temperature information:** click the circular **i** button beside the temperature color scale to open the dedicated panel. It shows minimum, maximum and heat-capacity-weighted average across all occupied cells, with a larger live history chart and simulated-time labels. Readings continue updating while the panel is open. Close it with ×, Escape, or a click outside, just like the mathematics panel. The history chart retains the latest 250 received states; it is not an archival time-series recorder.

Reloading the page starts a new experiment. There is no persistent project/session storage in this version. CSV exports save a temperature snapshot, not a restartable project.


## Geometry approximation and limits

The volume is an axis-aligned cubic grid. Each cell center is classified as inside or outside closed triangle shells using ray intersection pairs. Separate mesh parts are combined as an occupied union. Shared face neighbors conduct; there is no distance-based heat transfer across empty cells. Per-mesh boundary/non-manifold edge checks catch common open-surface exports, but do not constitute a complete CAD validity check. Self-intersections, overlapping shells inside a single mesh and nested ambiguities may produce incorrect volumes. Inspect the cell view when importing complex assemblies.

The physical assumptions are: a single homogeneous isotropic material, constant k/ρ/c, conduction through occupied volume, optional linear convection, and imposed temperatures. This version does not include radiation, phase change, temperature-dependent properties, fluid flow, pressure/compression, moving piston geometry, multi-material interfaces, explicit contact resistance, or separate environmental temperatures per face. It visualizes temperature evolution; it does not currently draw heat-flux arrows.

This is a tested exploratory simulator, not a mesh-converged or experimentally validated engineering solver. The mathematical unit checks do not validate every imported geometry or a real piston assembly. Compare 24/36/48 resolution, physical dimensions, and material properties before interpreting a particular result quantitatively. A finer tetrahedral finite-volume/FEM mesh would be a natural next step for accurate curved boundaries and contact modeling, while retaining the same network perspective.


## Core Mathematical Justification

The main mathematical conclusion of my study is the construction of a general iteration scheme, based on the **Forward Euler** method, to determine the temperature evolution of a set of interconnected objects over time.

$$
T_i(t + dt) = T_i(t) - \frac{dt}{m_i \cdot c_i} ( \ \sum_{j=1}^{N}\frac{1}{R_{ij}} \cdot (T_i(t) - T_j(t)) \ ) \quad \quad \quad T_{N} = T_{env}
$$

Such iteration scheme is derived by basic thermodynamics equations and justified numerically by simulation tests. Moreover, this scheme allows the derivation of the heat diffusion differential equation, demonstrating its mathematical groundness (details in [my blog post](https://leonardobertolani.github.io/2026/07/24/on-heat-diffusion-equations.html)).

The solver uses a slight, highly-optimized variation of the iteration scheme above

$$
\vec{T}(t + dt) =  \Gamma \cdot \vec{T}(t)
$$

Where $\Gamma$ is a static matrix summarizing the physical properties of the system and computed a-priori. This is the actual update implemented in `src/solver.js`.

The voxel grid gives each cell at most six conducting neighbors, so nearly all entries of the dense $\Gamma$ matrix would be zero. The app assembles only its nonzero entries in compressed sparse row form. Each full stable step reuses the same stored $\Gamma$ and streams its rows through the old temperature vector into a separate next vector. A shorter remainder step uses the same sparsity structure with coefficients scaled to that Δt.

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
