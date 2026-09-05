import assert from 'node:assert/strict';
import test from 'node:test';

import { heightmapMidpointHeight, heightsFromGrayscaleRgba, recenterHeightmapRange } from '../lib/heightmap.ts';
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

void test('negative midpoint shifts a tall import below ground without flattening its relief', () => {
  const pixels = [0, 64, 127.5, 192, 255].flatMap((gray) => [gray, gray, gray, 255]);
  for (const gamma of [0.5, 1, 2]) {
    const range = recenterHeightmapRange([0, 1800], gamma, -600);
    assert.equal(range[1] - range[0], 1800);
    assert.ok(Math.abs(heightmapMidpointHeight(range, gamma) + 600) < 1e-9);
    const original = heightsFromGrayscaleRgba(pixels, 5, 1, { minimum: 0, maximum: 1800, gamma, smoothingPasses: 0 });
    const shifted = heightsFromGrayscaleRgba(pixels, 5, 1, { minimum: range[0], maximum: range[1], gamma, smoothingPasses: 0 });
    assert.ok(Math.abs(shifted[2] + 600) < 1e-9);
    for (let index = 1; index < shifted.length; index += 1) {
      assert.ok(Math.abs((shifted[index] - shifted[index - 1]) - (original[index] - original[index - 1])) < 1e-9);
    }
  }
});

void test('below-ground import and smoothing keep every interior height at or below the zero boundary', () => {
  const pixels = Array.from({ length: 49 }, (_, index) => [index * 5, index * 5, index * 5, 255]).flat();
  const heights = heightsFromGrayscaleRgba(pixels, 7, 7, { minimum: -420, maximum: 0, gamma: 1, smoothingPasses: 2 });
  pinTerrainEdgeHeights(heights, 7, 7);
  assert.ok(heights.every((height) => height >= -420 && height <= 0));
  assert.ok(heights[24] < 0);
  assert.equal(heights[0], 0);
});
