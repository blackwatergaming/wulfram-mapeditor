import assert from 'node:assert/strict';
import test from 'node:test';

import { terrainBrushDistance, terrainBrushMix, terrainBrushWeight } from '../lib/terrain-brush.ts';

void test('round, square, and diamond footprints use their actual boundaries', () => {
  assert.ok(terrainBrushDistance(8, 8, 10, 'round') > 1);
  assert.equal(terrainBrushDistance(8, 8, 10, 'square'), 0.8);
  assert.ok(terrainBrushDistance(8, 8, 10, 'diamond') > 1);
  assert.equal(terrainBrushDistance(10, 0, 10, 'round'), 1);
  assert.equal(terrainBrushDistance(10, 0, 10, 'square'), 1);
  assert.equal(terrainBrushDistance(10, 0, 10, 'diamond'), 1);
});

void test('hard footprints are uniform while linear and soft profiles taper', () => {
  assert.equal(terrainBrushWeight(9, 9, 10, 'square', 'hard'), 1);
  assert.equal(terrainBrushWeight(10.01, 0, 10, 'square', 'hard'), 0);
  assert.equal(terrainBrushWeight(5, 0, 10, 'round', 'linear'), 0.5);
  assert.equal(terrainBrushWeight(10, 0, 10, 'round', 'linear'), 0);
  assert.equal(terrainBrushWeight(0, 0, 10, 'round', 'soft'), 1);
  assert.ok(terrainBrushWeight(5, 0, 10, 'round', 'soft') < 0.5);
});

void test('full-strength hard height stamps can produce an exact flat surface', () => {
  const mix = terrainBrushMix(100, terrainBrushWeight(9, 9, 10, 'square', 'hard'));
  const heights = [-21, 3.5, 88].map((height) => height + (42 - height) * mix);
  assert.equal(mix, 1);
  assert.deepEqual(heights, [42, 42, 42]);
  assert.equal(terrainBrushMix(50, 1, 0.3), 0.15);
});
