# Validation record

Recorded on 2026-10-31. These are software checks, not certification of physical predictions.

## Automated checks

`npm test`: **17 passing tests**.

- Precomputed sparse Γ update versus dense matrix–vector multiplication, including unequal heat capacities.
- Augmented Γ structure for fixed-temperature ambient convection, including normalized matrix rows.
- Energy conservation and capacity-weighted equilibrium for an insulated two-body system.
- Comparison to the analytical Newton-cooling exponential, within the specified Euler error tolerance.
- Stable-step maximum/minimum bounds on a nonuniform network and rejection of unsafe steps.
- Exact held-temperature enforcement and energy conservation after source release.
- Bounded step work with accurately reported integrated time.
- No conduction to disconnected bodies.
- All built-in sample geometries are closed and generate usable volume grids.
- Reciprocal adjacency and six-face accounting for every occupied cell.
- Cube volume and exposed voxel face area against exact grid counts.
- Rejection of open surface geometry.
- OBJ, ASCII STL, binary STL, embedded glTF and GLB imports produce the expected voxelized cube.
- External glTF resource rejection and the file-size guard.

`npm run build`: successful Vite production build. Vite reports a non-fatal large-JavaScript-chunk advisory because Three.js and loaders are bundled locally. The full local bundle avoids CDN dependencies.

## Interactive browser checks

- Pipe initialization: 7,560 cells at balanced resolution, 6.7 mm cells for a 0.24 m longest dimension, one thermal island.
- Clicking the pipe surface set a local region to 180°C from 20°C. Capacity-weighted mean became 23.3°C.
- Run control advanced time and reduced maximum temperature while the mean stayed 23.3°C with h = 0.
- Fit view and manual drag/orbit remained responsive during active diffusion; simulated time continued advancing.
- Pause and Reset controls were exercised.
- Piston sample initialized with 4,023 cells and two thermal islands.
- Narrow layout and the desktop breakpoint were inspected. Native preview sizing was restored afterward.

The browser automation connection dropped during the OS file chooser step, so an end-to-end picker import was not confirmed. All supported format parsers and their resulting volumes were independently exercised in automated tests. Browser CSV-download completion, all glTF material/texture combinations, and very large production CAD assemblies were not exhaustively tested.

## Limits of these checks

This version has not undergone a formal spatial/temporal convergence study on a curved solid, comparison to commercial FEA software, or experimental calibration. Resolution-dependent staircase surface area and narrow-gap handling are documented in README.md. Material presets are illustrative. Read the assumptions before interpreting results quantitatively.

## Information panel and engineering samples update

- Full suite: **17 passing tests**; production build succeeds.
- The existing built-in geometry/conservation check now covers all six samples. A new regression check confirms flanged pipe, heat sink and stepped shaft remain one connected thermal island at 24, 36 and 48 resolution.
- Browser checks: all three added samples rendered successfully; at balanced resolution the flanged pipe has 10,380 cells, heat sink 9,860, and stepped shaft 3,590.
- The information button beside the color scale opens the new dialog. Minimum, average, maximum, live chart and simulated time are visible there, and the previous bottom readout bar is removed.
- Applied a heat pulse to the heat sink, started diffusion, and observed changing temperatures and chart history while the dialog stayed open.
- Confirmed ×, Escape and outside-click dismissal, scrollable chart on a narrow display, and continued operation of the mathematics dialog. No browser console errors were captured during these checks.
