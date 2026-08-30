# Wulfram Forge

Wulfram Forge is an in-browser terrain editor and base builder for Wulfram II maps. It uses the original palette-decoded terrain textures and shape geometry from the sibling `wulfram-debug` workspace, reads and writes the original `land`/`state` family of files, and adds a versioned JSON base-layout format for new servers.

## What works

- Full map lifecycle: new map, import, edit, validate, local save/autosave, undo/redo, and ZIP export.
- Terrain mode with raise, lower, level, smooth, and original-texture paint brushes. Painting uses stable edge feathering, while the viewport performs normalized multi-texture blending with an adjustable transition width and strict nearest-neighbor texel sampling.
- Event-driven 3D rendering with static shadow reuse, frame-coalesced pointer sampling, allocation-free blend weights, and independent terrain/texture/unit update paths.
- Full keyboard camera control: `WASD` pans, arrow keys turn and tilt, `Q`/`E` or `+`/`-` zoom, and `Home` resets the view. Right-drag orbits and the mouse wheel zooms, with no artificial close-zoom limit.
- Grayscale image import, resampled into the active terrain grid with configurable black/white heights.
- Base Builder mode with team placement, original models where shipped, rotation/position editing, cargo subtypes, and uplinks. A translucent, terrain-conformed model ghost follows the cursor for individual units and complete templates before placement.
- A 73-template shipped-base library extracted from powered formations across 19 maps, with a live 2D top-down layout preview. Whole bases can be remapped to Team 1, Team 2, or capturable Neutral, rotated, footprint-scaled, auto-fit inside map bounds, and terrain-conformed unit by unit.
- Repair pads, power cells, missile launchers, and skypumps fit a 3 × 3 plane across their whole footprint, inherit slope pitch/roll, then lift to the highest contact plus a 0.75-unit margin to prevent clipping.
- The build catalog and template placer are asset-authoritative: removed unit types without a shipped model cannot be newly placed, while legacy map rows remain importable for lossless editing.
- Placement validation for bounds, slope, spacing, ground height, power coverage, primary-cell overlap, and backup-cell areas.
- Original `land`, `state`, `tagmap`, and `tagmap2` import/export.
- `wulfram-base-layout` JSON v1 import/export, included in every map ZIP with an editor project backup.
- Canonical Git source import/export using `map.json`, `terrain.tsv`, `entities.jsonl`, and the two tag maps. All 47 shipped maps are available in [`blackwatergaming/wulfram-maps`](https://github.com/blackwatergaming/wulfram-maps).
- Repository dropdown/load/save/publish controls backed by a loopback-only local service in browser mode and a native bridge in the desktop app.
- A self-contained Windows x64 Edge WebView2 app with per-monitor DPI handling, responsive high-DPI controls, and embedded editor/assets. See [the desktop release guide](docs/DESKTOP_RELEASE.md).

Download [Wulfram Forge v0.2.0](https://github.com/blackwatergaming/wulfram-mapeditor/releases/tag/v0.2.0), extract the ZIP, and run `WulframForge/WulframForge.exe`. Node.js and a local web server are not required for the desktop build.

The built-in Crossroads sample is read directly from the shipped map data. Gun and flak placement defaults come from robust statistics over 390 shipped turret records. The original client’s placement routines and checkerboard triangle interpolation were checked in Ghidra: rotations are radians, median gun/flak ground offsets are 16.420/15.847 world units, and power thresholds use `backupRadius - 10`, `2 × serviceRadius + 10`, and `serviceRadius - 10`. Power radii are server-supplied at runtime, so the editor exposes and stores them rather than pretending they are executable constants.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` also starts the maps service on `127.0.0.1:4319`. Put a `wulfram-maps` checkout beside this repository to populate the editor's repository dropdown.

Verification:

```bash
npm run lint
npm test
npm run verify:formats
npm run build
```

`npm test` discovers every original map under `../wulfram-debug/data/maps` (or `WULFRAM_MAPS_DIR`), then runs each through the actual editor writers and ZIP packager. It reloads the generated files and compares terrain dimensions, every height and texture index, tag maps, unit order/types, cargo subtypes, teams, positions, rotations, active flags, JSON layout, and browser backup. It also matches all extracted template units back to their source state rows and tests terrain fitting plus normalized texture-blend weights. The checked-in Crossroads map is used as a portable fallback when the sibling asset tree is unavailable.

## Asset extraction

Browser-ready assets are checked in so the editor deploys independently. To regenerate them from a sibling checkout:

```bash
python tools/extract_wulfram_assets.py
```

The extractor expects `../wulfram-debug/data/bitmaps/landscape.zip`, `base.zip`, `shapes.zip`, the palette, and shipped maps. It performs palette decoding and the original 16.16 fixed-point shape conversion without redesigning the source art.

Some entity shape names referenced by the executable—heavy silo, shield, portal, and spy bug—are absent from the shipped shape archive. Legacy rows remain readable for lossless round trips, but removed types are never offered for new unit or template placement. Available units render their original models and materials.

## Map source and releases

The reviewable source format is documented in [docs/MAP_SOURCE_FORMAT.md](docs/MAP_SOURCE_FORMAT.md). Compiled game ZIPs stay out of Git and are published from a clean `wulfram-maps` checkout:

```bash
npm run maps:compile -- --all
npm run maps:release -- v1.0.0
```

The first imported-map artifact set is [wulfram-maps v0.1.0](https://github.com/blackwatergaming/wulfram-maps/releases/tag/v0.1.0), containing 47 individual packages, a collection archive, and SHA-256 checksums.

The former ChatGPT Sites hosting manifest and plugin have been removed. Supported publication targets are the local server and GitHub Releases only.

## New-server JSON

See [docs/BASE_LAYOUT_FORMAT.md](docs/BASE_LAYOUT_FORMAT.md) and the checked-in [JSON Schema](public/schemas/wulfram-base-layout-v1.schema.json). Cargo units retain both `stateToken: "c"` and their original `cargoToken`, and all coordinates and rotations retain original Wulfram semantics.
