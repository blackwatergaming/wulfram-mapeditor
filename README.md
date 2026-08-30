# Wulfram Forge

Wulfram Forge is an in-browser terrain editor and base builder for Wulfram II maps. It uses the original palette-decoded terrain textures and shape geometry from the sibling `wulfram-debug` workspace, reads and writes the original `land`/`state` family of files, and adds a versioned JSON base-layout format for new servers.

## What works

- Full map lifecycle: new map, import, edit, validate, local save/autosave, undo/redo, and ZIP export.
- Terrain mode with raise, lower, level, smooth, and original-texture paint brushes. Painting uses stable edge feathering, while the viewport performs normalized multi-texture blending with an adjustable transition width.
- Grayscale image import, resampled into the active terrain grid with configurable black/white heights.
- Base Builder mode with team placement, original models where shipped, rotation/position editing, cargo subtypes, and uplinks.
- A 73-template shipped-base library extracted from powered formations across 19 maps. Whole bases can be team-remapped, rotated, footprint-scaled, auto-fit inside map bounds, and terrain-conformed unit by unit.
- Placement validation for bounds, slope, spacing, ground height, power coverage, primary-cell overlap, and backup-cell areas.
- Original `land`, `state`, `tagmap`, and `tagmap2` import/export.
- `wulfram-base-layout` JSON v1 import/export, included in every map ZIP with an editor project backup.

The built-in Crossroads sample is read directly from the shipped map data. Gun and flak placement defaults come from robust statistics over 390 shipped turret records. The original client’s placement routines and checkerboard triangle interpolation were checked in Ghidra: rotations are radians, median gun/flak ground offsets are 16.420/15.847 world units, and power thresholds use `backupRadius - 10`, `2 × serviceRadius + 10`, and `serviceRadius - 10`. Power radii are server-supplied at runtime, so the editor exposes and stores them rather than pretending they are executable constants.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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

Some entity shape names referenced by the executable—heavy silo, shield, portal, and spy bug—are absent from the shipped shape archive. Those entities deliberately use geometric editor markers; available units render their original models and materials.

## New-server JSON

See [docs/BASE_LAYOUT_FORMAT.md](docs/BASE_LAYOUT_FORMAT.md) and the checked-in [JSON Schema](public/schemas/wulfram-base-layout-v1.schema.json). Cargo units retain both `stateToken: "c"` and their original `cargoToken`, and all coordinates and rotations retain original Wulfram semantics.
