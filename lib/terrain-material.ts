import * as THREE from 'three';

import { buildTerrainCellLayers, parseTerrainTextureTag, TERRAIN_MASK_BY_FRAME } from './terrain-textures.ts';
import type { AssetManifest, TerrainData } from './wulfram.ts';

export const TERRAIN_TILE_PIXELS = 128;

// Sample at texel centers inside each source tile. Cell coordinates determine
// phase, so neither canvas resolution nor map dimensions can shift the artwork.
const terrainSamplingShader = `
uniform sampler2D terrainCells;
uniform sampler2D terrainMasks;
uniform vec2 terrainGrid;
uniform vec2 terrainAtlasGrid;

vec2 terrainAtlasUv(vec2 uv, float slot, vec2 atlasGrid) {
  vec2 tile = vec2(mod(slot, atlasGrid.x), floor(slot / atlasGrid.x));
  vec2 pixel = clamp(floor(uv * 128.0), vec2(0.0), vec2(127.0));
  return (tile + (pixel + 0.5) / 128.0) / atlasGrid;
}

vec4 terrainSource(float layer, vec2 uv) {
  return texture2D(map, terrainAtlasUv(uv, floor(layer / 64.0), terrainAtlasGrid));
}

vec4 terrainOverlay(vec4 base, float layer, vec2 uv) {
  if (layer < 0.0) return base;
  float maskSlot = mod(layer, 64.0);
  float coverage = texture2D(terrainMasks, terrainAtlasUv(uv, maskSlot, vec2(16.0, 4.0))).r;
  return mix(base, terrainSource(layer, uv), coverage);
}

vec4 terrainColor(vec2 mapUv) {
  vec2 grid = clamp(vec2(mapUv.x, 1.0 - mapUv.y) * terrainGrid, vec2(0.0), terrainGrid);
  vec2 cell = min(floor(grid), terrainGrid - 1.0);
  vec2 fraction = grid - cell;
  // Wulfram's -Y cell edge is the bottom row of the original bitmap.
  vec2 uv = vec2(fraction.x, 1.0 - fraction.y);
  vec4 layers = texture2D(terrainCells, (cell + 0.5) / terrainGrid);
  vec4 color = terrainSource(layers.r, uv);
  color = terrainOverlay(color, layers.g, uv);
  color = terrainOverlay(color, layers.b, uv);
  return terrainOverlay(color, layers.a, uv);
}
`;

/** One shared source-art atlas plus a small cell lookup; no whole-map downsampling. */
export function createTerrainMaterial(
  terrain: TerrainData,
  manifest: AssetManifest,
  loadImage: (url: string) => Promise<HTMLImageElement>,
  invalidate: () => void,
) {
  const entries = Object.entries(manifest.terrainTextures);
  const slots = new Map(entries.map(([name], index) => [name, index + 1]));
  const columns = Math.ceil(Math.sqrt(entries.length + 1));
  const rows = Math.ceil((entries.length + 1) / columns);
  const makeAtlas = (width: number, height: number, colors: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = width * TERRAIN_TILE_PIXELS;
    canvas.height = height * TERRAIN_TILE_PIXELS;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas texture decoding is unavailable.');
    context.imageSmoothingEnabled = false;
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.colorSpace = colors ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    return { context, texture };
  };
  const sources = makeAtlas(columns, rows, true);
  const masks = makeAtlas(16, 4, false);
  const fillTile = (context: CanvasRenderingContext2D, slot: number, width: number, color: string) => {
    context.fillStyle = color;
    context.fillRect(slot % width * 128, Math.floor(slot / width) * 128, 128, 128);
  };
  fillTile(sources.context, 0, columns, '#5b4638');
  for (const [name, asset] of entries) fillTile(sources.context, slots.get(name)!, columns, asset.average);
  // A useful corner preview remains available while the original masks load.
  masks.context.fillStyle = '#ffffff';
  for (let family = 0; family < 4; family += 1) {
    for (let mask = 1; mask < 16; mask += 1) {
      for (const [corner, bit] of [8, 4, 2, 1].entries()) {
        if (mask & bit) masks.context.fillRect(mask * 128 + corner % 2 * 64, family * 128 + Math.floor(corner / 2) * 64, 64, 64);
      }
    }
  }
  const cellData = buildTerrainCellLayers(terrain, slots);
  const cells = new THREE.DataTexture(cellData, terrain.width - 1, terrain.height - 1, THREE.RGBAFormat, THREE.FloatType);
  cells.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: sources.texture, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainCells = { value: cells };
    shader.uniforms.terrainMasks = { value: masks.texture };
    shader.uniforms.terrainGrid = { value: new THREE.Vector2(terrain.width - 1, terrain.height - 1) };
    shader.uniforms.terrainAtlasGrid = { value: new THREE.Vector2(columns, rows) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${terrainSamplingShader}`)
      .replace('#include <map_fragment>', 'diffuseColor *= terrainColor(vMapUv);');
  };
  material.customProgramCacheKey = () => 'wulfram-terrain-cells-v1';
  let disposed = false;
  let generation = 0;
  const loaded = new Map<string, Promise<void>>();
  const maskReady = Promise.all(Array.from({ length: 4 }, (_, family) =>
    Promise.all(TERRAIN_MASK_BY_FRAME.slice(1, 15).map(async (mask, index) => {
      const asset = manifest.terrainMasks?.[`${family + 1}template${String(index + 1).padStart(3, '0')}`];
      if (!asset) return;
      try {
        const image = await loadImage(asset.url);
        if (!disposed) masks.context.drawImage(image, mask * 128, family * 128, 128, 128);
      } catch { /* Keep the corner preview if this source mask is unavailable. */ }
    })),
  ));
  return {
    material,
    async update(current: TerrainData) {
      const revision = ++generation;
      cellData.set(buildTerrainCellLayers(current, slots));
      cells.needsUpdate = true;
      invalidate();
      const used = new Set(current.textureIds.slice(0, (current.width - 1) * (current.height - 1)));
      const names = new Set([...used].flatMap((id) => parseTerrainTextureTag(current.tagmap2[id]).map((layer) => layer.name)));
      await Promise.all([maskReady, ...[...names].map((name) => {
        let pending = loaded.get(name);
        if (!pending) {
          const asset = manifest.terrainTextures[name];
          if (!asset) return undefined;
          pending = loadImage(asset.url).then((image) => {
            if (disposed) return;
            const slot = slots.get(name)!;
            sources.context.drawImage(image, slot % columns * 128, Math.floor(slot / columns) * 128, 128, 128);
          }).catch(() => { /* Keep this source's average color if its bitmap is unavailable. */ });
          loaded.set(name, pending);
        }
        return pending;
      })]);
      if (disposed || revision !== generation) return;
      sources.texture.needsUpdate = true;
      masks.texture.needsUpdate = true;
      invalidate();
    },
    dispose() {
      disposed = true;
      cells.dispose();
      sources.texture.dispose();
      masks.texture.dispose();
      material.dispose();
    },
  };
}
