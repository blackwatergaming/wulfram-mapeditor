# Original texture and sky rendering

The renderer uses decoded Wulfram artwork. These details were checked against
the retail `wulfram2.exe` loaded in Ghidra (image base `0x00400000`).

| Evidence | Rendering consequence |
| --- | --- |
| `TerrainHeightfield_LoadLandFile` (`0x004ef7e0`), `MapFile_SaveLandData` (`0x0042cef0`), `MapExport_WriteTerrainSourceMosaicJpeg` (`0x004445e0`) | Heights use vertex rows; cell texture IDs use a separate packed grid with stride `width - 1`. |
| `Tex_SerializeToStream` (`0x00498370`), `TexCache_CreateChunkFromBitmap` (`0x00497ed0`) | Kind-3 bitmaps store the smallest mip first. A 128×128 full-resolution mip begins at byte 5464. |
| `TagMap_ParseRuleLine` (`0x00465e90`), `TagMap_CompositeTaggedTexture` (`0x004663e0`), `TexAlias_SelectDominantAndVariants` (`0x0049cc50`) | Composite tags carry source names and complemented corner masks; the original binary masks choose overlay pixels. |
| Corner/frame table (`0x00577008`), `TexAlias_InitTerrainTable` (`0x0049cf20`) | Four template families use the 14 nontrivial masks. Background selection follows template registration order. |
| `TeamTilemap_BuildRemapTable` (`0x004938c0`), `TeamTilemap_RemapShapeFaces` (`0x00493850`) | Team 1 selects red artwork, team 2 blue, and other slots neutral. Cargo uses `cargosdR`/`cargotopsR` for red. |
| `SkyFog_RebuildVisibleGridQuads` (`0x0044ba00`), `SkyFog_ApplyQuadTexcoordRotation` (`0x0044ae20`) | Each sky contains 16 wall strips and 16 roof tiles, with different rotations for each wall. |

`terrain-material.ts` samples one native source bitmap per cell from an atlas,
with a separate floating-point cell lookup and mask atlas. Painting a vertex
updates the matching corner of each adjacent cell. Texture rows and shape UVs
retain the original image orientation. Source variants explicitly named in
tags remain stable; the editor does not reproduce the client's random choice
of interchangeable aliases.

`skies.zip` contains 11 complete sky sets. Each atlas preserves all 32 source
tiles at 128×128 with duplicated one-pixel gutters for linear filtering. The
renderer follows the original panel layout, applies camera rotation at the far
plane, and uses the source horizon average for the background/fog color. Camera
translation cannot leave the sky. This is an editor backdrop; the original
client's dynamic fog system is not reproduced.

The source power-cell models are numbered blue `energy_1`, red `energy_2`.
The remap table names neutral cargo bitmaps `cargosdG` and `cargotopsG`, but
neither is supplied in the retail archive. Neutral rendering uses the original
gray variant when available; otherwise it desaturates the sampled material in
the shader, without changing the texture shared by red or blue units.

## Verification

`npm test` checks cell stride, corner painting, source/mask coverage, team model
and material selection, sky orientation, all sky source/ZIP round trips, and
isolation between terrain and base-layout saves.

Optional GPU probes require Pillow and moderngl:

```sh
python -m unittest discover -s tests -p test_asset_extraction.py
python tools/verify-terrain-render.py
python tools/verify-sky-render.py
```

The terrain probe compares all 98,304 rendered pixels with independent original
source/mask composites. The sky probe compiles the actual Three.js sky shader
and renders all 11 skies. Preview images are written under
`outputs/texture-mapping/`. These probes test GPU rendering, not browser UI.
