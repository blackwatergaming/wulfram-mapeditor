# Wulfram Map Editor — Progress

Updated: 2026-08-30

## Completed

- [x] Confirmed the target GitHub repository exists and is empty.
- [x] Scaffolded the browser application with the React/Vite toolchain.
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
- [x] Add the canonical Git-friendly map source format and validate conversion/recompilation across all 47 original maps.
- [x] Add browser loopback and desktop-native repository dropdown/load/save/publish workflows for `blackwatergaming/wulfram-maps`.
- [x] Seed and push all 47 canonical map sources, then publish 49 deterministic artifacts in the `wulfram-maps` v0.1.0 GitHub Release.
- [x] Build the self-contained Windows x64 Edge WebView2 desktop application and automated release workflow.
- [x] Add per-monitor-v2 DPI handling, compact high-DPI controls, fixed 100% WebView zoom, and headed layout/performance measurement.
- [x] Fix the terrain canvas upload so packaged WebView2 builds render original texture pixels instead of the average-color fallback.
- [x] Add live terrain-conformed original-model ghosts for single-unit and whole-template placement.
- [x] Remove the artificial camera close-zoom distance floor.
- [x] Remove the ChatGPT Sites hosting manifest/plugin so builds and publication remain local or GitHub-based.
- [x] Replace catalog-only snapping with extracted model-bounds clearance for every surviving placeable model, sample terrain-grid peaks, and retain a 1.25-unit underside margin.
- [x] Add a maps-service setup/diagnostics wizard plus `maps:doctor` for checkout, Git, GitHub CLI/authentication, origin, `main`, branch, and worktree checks.
- [x] Add branch creation/switching and make Publish create or reuse feature-branch commits and pull requests targeting `main`.
- [x] Add Shift-drag pickup for selected units with live terrain-conformed position/tilt preview and a single undoable commit on release.
- [x] Add grayscale import preview controls for minimum/maximum heights, gamma, and optional Gaussian spike smoothing, plus gentle/medium/raw presets.
- [x] Add `BUILD.md` with browser, self-contained desktop, research/debug, headed measurement, map PR, and release procedures.
- [x] Make Escape clear active unit/template placement and its cursor preview without discarding the selected placed unit.
- [x] Remove cargo variants for model-less deployables from new placement and templates while retaining legacy-row import/export.
- [x] Complete headed WebView2 verification of repository setup, placement preview, Shift-drag, Escape, grayscale controls, texture decoding, DPI layout, and camera performance.
- [x] Clear the previous repository slug when creating or importing a different map so Save cannot overwrite the formerly selected map.
- [x] Publish and verify the tagged v0.3.0 self-contained desktop release.

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
- State-file medians provide legacy origin offsets of 2.983 units (power cell), 2.742 (refuel pad), 3.853 (repair pad), 3.200 (missile launcher), and 4.528 (skypump). New placement takes the larger of that offset and the extracted rendered-model underside, scans the full model-bounds footprint plus covered terrain vertices, and retains a 1.25-unit bottom margin.
- Ghidra confirms the original client samples averaged terrain normals over a square radius (`TerrainNormal_SampleAroundPoint`) and raises map-editor objects by their model height above sampled terrain (`MapEdit_PlaceSelectedObject`). The browser implementation extends that behavior with full-footprint clearance to prevent corner clipping.
- The live viewport now renders on invalidation instead of continuously, reuses static shadow maps while the camera moves, caps pixel density at 1.5×, raycasts only terrain during pointer motion, and coalesces high-frequency pointer events to animation frames.
- A local 600,000-pixel blend-loop microbenchmark dropped from 338.8 ms with per-pixel contribution allocations to 69.5 ms with the reusable weight buffer (4.88× faster); headed WebView2 timing subsequently held 59–60 FPS in the tested idle, preview, and camera-motion paths.
- Shipped models exist for power, refuel, repair, gun, flak, missile launcher, skypump, darklight, uplink, and cargo. Shield, heavy silo, portal, spy bug, and template-only supply ships remain readable from legacy maps but are omitted from new placement.
- Final checks pass: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run verify:formats`, `npm run build`, and a local HTTP 200 response.
- Added a site-wide social preview matching the editor's dark steel, canyon, and team-color visual language.
- The editor is committed and pushed to the `main` branch of `blackwatergaming/wulfram-mapeditor`.
- The canonical source suite converts, reloads, and recompiles all 47 original maps; source ZIPs and compiled packages are deterministic for an unchanged revision.
- `blackwatergaming/wulfram-maps` now contains 47 canonical map directories on `main`; release v0.1.0 contains 47 map packages, one collection archive, and `SHA256SUMS.txt`.
- The loopback service returned all 47 maps and loaded Crossroads with 16,641 terrain vertices and 69 entities; the editor route returned HTTP 200.
- A headed Edge WebView2 run at Windows 200% scaling reported a 1280×730 CSS viewport at DPR 2 with no document overflow. Idle, nine-model template-preview, and active keyboard-camera timing held 59–60 FPS.
- The final v0.3.0 headed probe also passed repository diagnostics, a nine-unit model preview, Shift-drag terrain tuning, Escape cancellation, and grayscale preview/application; all texture requests decoded and no console, runtime, or network failures were reported.
- WebView2 texture requests and canvas pixel reads succeeded. Pre-sizing the 903×903 terrain atlas before its first GPU upload removed `glCopySubTextureCHROMIUM` overflow warnings and restored the original blended texture view.
- The desktop template placement probe selected a nine-unit shipped base, rendered its live preview badge and translucent terrain-conformed models, and completed without console or network errors.
- The native repository bridge exposed 47 maps (plus the new-map option) and loaded `aberdour` from canonical Git source into the packaged desktop editor.
- Repository workflow tests now create real temporary Git checkouts and bare remotes, then verify feature-branch naming, selected-map-only commits, pushes, PR metadata targeting `main`, branch switching, unrelated-change refusal, and the loopback health/diagnostics/catalog/branch endpoints.
- `npm run maps:doctor` passes against the actual sibling checkout for Git, GitHub CLI authentication, the `blackwatergaming/wulfram-maps` origin, and `main`; being on `main` is intentionally reported as a warning because Publish creates a feature branch automatically.
- The published v0.3.0 self-contained archive is 66,742,045 bytes with SHA-256 `cc5d9899e3c88da916dd0ff33b54f59a7cae30699ac3b09b3c78a22f2732aa12`.

## Notes

This file is maintained throughout implementation so format discoveries, derived defaults, validation rules, and verification results remain auditable.

## Release verification

- [x] Published and verified the tagged v0.2.0 desktop-editor GitHub Release with the self-contained Windows archive and SHA-256 checksum.
- [x] Published and verified the tagged v0.3.0 desktop-editor GitHub Release; its CI reran lint, all 28 regression tests, the self-contained build, artifact upload, and checksum publication successfully.
