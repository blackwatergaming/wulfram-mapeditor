# Wulfram Map Editor — Progress

Updated: 2026-08-30

## Completed

- [x] Confirmed the target GitHub repository exists and is empty.
- [x] Scaffolded the browser application with the Sites/React toolchain.
- [x] Located the original terrain, map state, bitmap, and shape archives in `../wulfram-debug`.
- [x] Decode the original `land` and `state` formats and derive placement defaults from shipped maps.
- [x] Extract and convert the original textures and models into browser-ready assets.
- [x] Build the Terrain Editor mode.
- [x] Build the Base Builder mode with validated placement rules.
- [x] Add a full create/import/edit/validate/save/export map lifecycle.
- [x] Add grayscale heightmap import and terrain texture-painting tools.
- [x] Add original map import/export plus versioned JSON base-layout import/export for the new server.
- [x] Add undo/redo and local project persistence.
- [x] Validate type safety, lint, map-format round trips, asset references, the production build, and the local HTTP route.
- [x] Add an original-map regression suite that validates the shared writers and ZIP packager by loading, exporting, reopening, and comparing shipped maps.
- [x] Extract powered bases from shipped state files into reusable whole-base templates with team, scale, rotation, bounds fitting, and per-unit terrain conformance.
- [x] Replace hard texture blocks with normalized multi-texture transitions and stable feathered paint edges, with an adjustable blend control.
- [x] Preserve strict pixel sampling while removing continuous idle rendering, repeated live shadow passes, per-pixel blend allocations, and terrain-stroke model rebuilds.
- [x] Add full keyboard camera pan/turn/tilt/zoom controls and camera reset.
- [x] Add a live 2D top-down layout viewer for every shipped base template.
- [x] Add Neutral team placement for capturable bases and filter new placements against the extracted model manifest.
- [x] Add footprint-wide slope snapping and anti-clipping clearance for repair pads, power cells, missile launchers, and skypumps.
- [x] Commit and push the completed editor to `blackwatergaming/wulfram-mapeditor`.

## Findings

- Source assets are available under `../wulfram-debug/data`.
- Shipped maps contain `land`, `state`/`db_state`, `tagmap`, and supplemental files.
- Original `land` files are `width x height`, `worldWidth x worldHeight`, then one texture-index/height pair per vertex.
- Original `state` rows use entity tokens followed by team, XYZ, rotation XYZ (radians), and active state; cargo rows include a subtype token.
- Ghidra confirms power-cell validation uses `backupRadius - 10`, `2 * serviceRadius + 10`, and `serviceRadius - 10` thresholds. These radii are server-supplied, so the editor exposes editable offline defaults.
- Ghidra-verified checkerboard triangle sampling plus shipped placements yield median ground offsets of 16.420 (gun) and 15.847 (flak), with rotations stored in radians.
- Converted 499 original terrain textures, 114 model material textures, and 19 original shape models for direct browser use.
- The new-server layout will be a versioned JSON representation of state entities, with map metadata and validation settings retained for round trips.
- Dense shipped placements support offline defaults of 300 units for service and 80 units for backup; both remain editable because live servers supply the authoritative values.
- Every exported ZIP now carries original-format files, `base-layout.json`, and a browser-project backup.
- The format verification suite round-trips the 16,641-vertex Crossroads land file and all 69 state entities, and exercises the Ghidra-derived power rules.
- The full regression suite round-trips all 47 discovered original maps (782,127 terrain vertices) and 44 state files (1,615 entities), then packages, reloads, and compares all 47 ZIPs. It also verifies deterministic ZIP output and falls back to the checked-in Crossroads fixture outside the source workspace.
- Powered connected-component analysis found 73 reusable bases across 19 shipped maps, containing 832 original units. Nearby cargo, uplinks, and supply ships attach only to their nearest base, avoiding duplication.
- Template tests match all 832 units back to their source state rows and source terrain heights, then verify team remapping, rotation, footprint auto-fit, bounds clamping, and destination-terrain conformance.
- Terrain material rendering now keeps original categorical texture IDs on disk while producing normalized, adjustable transitions in the viewport; the paint brush uses deterministic feathering so repeated strokes remain stable. Texture texels use strict nearest-neighbor sampling with smoothing and mipmaps disabled, preserving the source pixels.
- State-file medians provide footprint-snap origin clearances of 2.983 units (power cell), 3.853 (repair pad), 3.200 (missile launcher), and 4.528 (skypump). A 0.75-unit safety margin is added after fitting the footprint plane and clearing its highest terrain residual.
- Ghidra confirms the original client samples averaged terrain normals over a square radius (`TerrainNormal_SampleAroundPoint`) and raises map-editor objects by their model height above sampled terrain (`MapEdit_PlaceSelectedObject`). The browser implementation extends that behavior with full-footprint clearance to prevent corner clipping.
- The live viewport now renders on invalidation instead of continuously, reuses static shadow maps while the camera moves, caps pixel density at 1.5×, raycasts only terrain during pointer motion, and coalesces high-frequency pointer events to animation frames.
- A local 600,000-pixel blend-loop microbenchmark dropped from 338.8 ms with per-pixel contribution allocations to 69.5 ms with the reusable weight buffer (4.88× faster); headed end-to-end frame timing remains pending below.
- Shipped models exist for power, refuel, repair, gun, flak, missile launcher, skypump, darklight, uplink, and cargo. Shield, heavy silo, portal, spy bug, and template-only supply ships remain readable from legacy maps but are omitted from new placement.
- Final checks pass: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run verify:formats`, `npm run build`, and a local HTTP 200 response.
- Added a site-wide social preview matching the editor's dark steel, canyon, and team-color visual language.
- The editor is committed and pushed to the `main` branch of `blackwatergaming/wulfram-mapeditor`.

## Notes

This file is maintained throughout implementation so format discoveries, derived defaults, validation rules, and verification results remain auditable.

## Pending verification

- [ ] Measure interactive frame timing in a headed remote-control browser. No Chrome or Firefox backend is currently connected to this session through Computer use.
