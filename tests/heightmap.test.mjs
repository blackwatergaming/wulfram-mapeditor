import assert from 'node:assert/strict';
import test from 'node:test';

import { heightsFromGrayscaleRgba } from '../lib/heightmap.ts';
import { pinTerrainEdgeHeights } from '../lib/terrain-edge.ts';

void test('grayscale controls map black and white to explicit minimum and maximum heights', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
  assert.deepEqual(
    heightsFromGrayscaleRgba(pixels, 2, 1, { minimum: -20, maximum: 180, gamma: 1, smoothingPasses: 0 }),
    [-20, 180],
  );
});

void test('optional smoothing lowers isolated grayscale spikes without escaping the selected range', () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  const center = (2 * 5 + 2) * 4;
  pixels[center] = pixels[center + 1] = pixels[center + 2] = 255;
  const raw = heightsFromGrayscaleRgba(pixels, 5, 5, { minimum: 10, maximum: 170, gamma: 1, smoothingPasses: 0 });
  const softened = heightsFromGrayscaleRgba(pixels, 5, 5, { minimum: 10, maximum: 170, gamma: 1, smoothingPasses: 2 });
  assert.equal(raw[12], 170);
  assert.ok(softened[12] < raw[12]);
  assert.ok(softened[12] > 10);
  assert.ok(softened.every((height) => height >= 10 && height <= 170));
});

void test('gamma adjusts image midtones while preserving the endpoints', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 255,
  ]);
  const linear = heightsFromGrayscaleRgba(pixels, 3, 1, { minimum: 0, maximum: 100, gamma: 1, smoothingPasses: 0 });
  const shaped = heightsFromGrayscaleRgba(pixels, 3, 1, { minimum: 0, maximum: 100, gamma: 2, smoothingPasses: 0 });
  assert.equal(linear[0], shaped[0]);
  assert.equal(linear[2], shaped[2]);
  assert.ok(shaped[1] < linear[1]);
});

void test('terrain edges stay pinned at zero without changing interior heights', () => {
  const heights = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(pinTerrainEdgeHeights(heights, 5, 4), heights);
  assert.deepEqual(heights, [
    0, 0, 0, 0, 0,
    0, 7, 8, 9, 0,
    0, 12, 13, 14, 0,
    0, 0, 0, 0, 0,
  ]);

  const thinTerrain = [4, 3, 2, 1];
  pinTerrainEdgeHeights(thinTerrain, 1, 4);
  assert.deepEqual(thinTerrain, [0, 0, 0, 0]);
});
