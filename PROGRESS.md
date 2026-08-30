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
- Final checks pass: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run verify:formats`, `npm run build`, and a local HTTP 200 response.
- Added a site-wide social preview matching the editor's dark steel, canyon, and team-color visual language.
- The editor is committed and pushed to the `main` branch of `blackwatergaming/wulfram-mapeditor`.

## Notes

This file is maintained throughout implementation so format discoveries, derived defaults, validation rules, and verification results remain auditable.
