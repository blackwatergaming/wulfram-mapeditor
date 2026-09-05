import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildTerrainCellLayers, paintTerrainTextureVertex, parseTerrainTextureTag, serializeTerrainTextureTag, terrainTemplateFamily, terrainTextureCellIndex, TERRAIN_MASK_BY_FRAME } from '../lib/terrain-textures.ts';
import { parseLand, serializeLand } from '../lib/wulfram.ts';

function fixture() {
  return { width: 4, height: 3, worldWidth: 300, worldHeight: 200,
    textureIds: [0, 1, 2, 3, 4, 5, 91, 92, 93, 94, 95, 96],
    heights: Array.from({ length: 12 }, (_, index) => index),
    tagmap: [], tagmap2: ['A', 'B', 'C', 'D', 'E', 'F'] };
}

void test('land textures form a packed cell grid independent of vertex rows and trailing padding', () => {
  const terrain = fixture();
  assert.equal(terrainTextureCellIndex(terrain, 0, 1), 3);
  assert.equal(terrainTextureCellIndex(terrain, 2, 1), 5);
  assert.equal(terrainTextureCellIndex(terrain, 3, 1), -1);
  assert.equal(terrainTextureCellIndex(terrain, 1, 2), -1);
  const slots = new Map(terrain.tagmap2.map((name, index) => [name, index + 1]));
  const cells = buildTerrainCellLayers(terrain, slots);
  assert.equal(cells.length, 6 * 4);
  assert.deepEqual([...cells].filter((_, index) => index % 4 === 0).map((value) => Math.floor(value / 64)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseLand(serializeLand(terrain)).textureIds, terrain.textureIds);
});

void test('Crossroads cell rows use the original client stride at the first, middle, and last rows', async () => {
  const terrain = parseLand(await readFile(new URL('../public/assets/demo/crossroads/land', import.meta.url), 'utf8'));
  for (const [x, y, index] of [[0, 0, 0], [0, 1, 128], [63, 64, 8255], [127, 127, 16383]]) {
    assert.equal(terrainTextureCellIndex(terrain, x, y), index);
  }
  assert.equal(terrain.textureIds.length, 16641, 'Keep every original serialized value, including the ignored tail.');
});

void test('transition tags retain all four sources and complement serialized corner masks', () => {
  const line = '+0template 20bush001 14 0template canyon001 13 0template 4sand001 11 0template Bdt001 7 ';
  const layers = parseTerrainTextureTag(line);
  assert.deepEqual(layers, [{ name: '20bush001', corners: 1 }, { name: 'canyon001', corners: 2 }, { name: '4sand001', corners: 4 }, { name: 'Bdt001', corners: 8 }]);
  assert.equal(serializeTerrainTextureTag(layers), line);
  assert.deepEqual(parseTerrainTextureTag(' missle pack '), [{ name: 'missle pack', corners: 15 }]);
  for (const bad of [undefined, '', '+0template canyon001', '+0template canyon001 nope', '+0template canyon001 16']) assert.deepEqual(parseTerrainTextureTag(bad), []);
  assert.equal(TERRAIN_MASK_BY_FRAME[2], 3);
  assert.equal(TERRAIN_MASK_BY_FRAME[3], 2);
  assert.equal(TERRAIN_MASK_BY_FRAME[6], 4);
});

void test('mask family comes from the first registered background layer and overlays keep their order', () => {
  const terrain = fixture();
  terrain.tagmap2[0] = '+0template canyon001 14 0template Bdt001 13 0template 4sand001 3 ';
  const slots = new Map([['canyon001', 1], ['Bdt001', 2], ['4sand001', 3]]);
  assert.deepEqual(buildTerrainCellLayers(terrain, slots).slice(0, 4), Float32Array.of(64 + 32 + 1, 128 + 32 + 2, 192 + 32 + 12, -1));
  assert.equal(terrainTemplateFamily('4granite001'), 2);
  assert.equal(terrainTemplateFamily('5ice001'), 4);
  assert.equal(terrainTemplateFamily('groundstruct14a'), undefined);
  terrain.tagmap2[0] = '+0template unknown 14 0template Bdt001 1 ';
  assert.deepEqual(buildTerrainCellLayers(terrain, slots).slice(0, 4), Float32Array.of(128 + 14, 1, -1, -1));
});

void test('painting a shared vertex updates the corresponding corners of its four adjacent cells', () => {
  const terrain = fixture();
  const before = structuredClone(terrain);
  paintTerrainTextureVertex(terrain, 1, 1, 'paint');
  const masks = new Map([[0, 4], [1, 8], [3, 1], [4, 2]]);
  for (let cell = 0; cell < 6; cell += 1) {
    const layers = parseTerrainTextureTag(terrain.tagmap2[terrain.textureIds[cell]]);
    if (masks.has(cell)) {
      assert.equal(layers.find((layer) => layer.name === 'paint')?.corners, masks.get(cell));
      assert.equal(layers.find((layer) => layer.name === before.tagmap2[cell])?.corners, 15 ^ masks.get(cell));
    } else assert.equal(terrain.textureIds[cell], before.textureIds[cell]);
  }
  assert.deepEqual(terrain.textureIds.slice(6), before.textureIds.slice(6));
  assert.deepEqual(terrain.heights, before.heights);
  const painted = structuredClone(terrain);
  paintTerrainTextureVertex(terrain, 1, 1, 'paint');
  assert.deepEqual(terrain, painted, 'Repeated painting must reuse tags.');
  const roundTrip = parseLand(serializeLand(terrain));
  roundTrip.tagmap2 = [...terrain.tagmap2];
  assert.deepEqual(buildTerrainCellLayers(roundTrip, new Map([['paint', 7]])), buildTerrainCellLayers(terrain, new Map([['paint', 7]])));
});

void test('painting the outer map corners never wraps into another row or touches the land padding', () => {
  for (const [x, y, cell, mask] of [[0, 0, 0, 2], [3, 0, 2, 1], [0, 2, 3, 8], [3, 2, 5, 4]]) {
    const terrain = fixture();
    const before = [...terrain.textureIds];
    paintTerrainTextureVertex(terrain, x, y, 'paint');
    assert.deepEqual(terrain.textureIds.flatMap((id, index) => id !== before[index] ? [index] : []), [cell]);
    assert.equal(parseTerrainTextureTag(terrain.tagmap2[terrain.textureIds[cell]]).find((layer) => layer.name === 'paint')?.corners, mask);
  }
});

void test('painting all corners collapses a transition to one source', () => {
  const terrain = fixture();
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) paintTerrainTextureVertex(terrain, x, y, 'paint');
  assert.equal(terrain.tagmap2[terrain.textureIds[0]], 'paint');
});

void test('all checked-in Crossroads layers and template masks resolve to extracted assets', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const tags = (await readFile(new URL('../public/assets/demo/crossroads/tagmap2', import.meta.url), 'utf8')).trim().split(/\r?\n/);
  for (const tag of tags) {
    const layers = parseTerrainTextureTag(tag);
    assert.ok(layers.length);
    for (const { name } of layers) assert.ok(manifest.terrainTextures[name], name);
  }
  for (let family = 1; family <= 4; family += 1) {
    for (let frame = 1; frame <= 14; frame += 1) assert.ok(manifest.terrainMasks[`${family}template${String(frame).padStart(3, '0')}`]);
  }
});
