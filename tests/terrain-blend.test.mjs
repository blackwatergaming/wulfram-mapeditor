import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldPaintTextureVertex, textureBlendAxis, textureBlendContributions, textureBlendWeights } from '../lib/terrain-blend.ts';

void test('texture blend axis supports hard edges and smooth transition widths', () => {
  assert.equal(textureBlendAxis(0.49, 0), 0);
  assert.equal(textureBlendAxis(0.5, 0), 1);
  assert.equal(textureBlendAxis(0.1, 0.5), 0);
  assert.equal(textureBlendAxis(0.9, 0.5), 1);
  assert.equal(textureBlendAxis(0.5, 1), 0.5);
  let previous = 0;
  for (let step = 0; step <= 100; step += 1) {
    const current = textureBlendAxis(step / 100, 0.72);
    assert.ok(current >= previous, `Blend curve must be monotonic at step ${step}.`);
    previous = current;
  }
});

void test('checkerboard-triangle texture contributions stay normalized and merge matching materials', () => {
  for (let y = 0; y <= 20; y += 1) {
    for (let x = 0; x <= 20; x += 1) {
      const contributions = textureBlendContributions([3, 7, 11, 3], x / 20, y / 20, 0.72);
      const total = contributions.reduce((sum, contribution) => sum + contribution.weight, 0);
      assert.ok(Math.abs(total - 1) < 1e-12, `Weights must sum to one at ${x}, ${y}.`);
      assert.equal(new Set(contributions.map((contribution) => contribution.textureId)).size, contributions.length);
      assert.ok(contributions.every((contribution) => contribution.weight > 0 && contribution.weight <= 1));
    }
  }
  assert.deepEqual(textureBlendContributions([5, 5, 5, 5], 0.37, 0.81, 1), [{ textureId: 5, weight: 1 }]);
});

void test('hard mode chooses one vertex while full blend follows each checkerboard diagonal', () => {
  assert.deepEqual(textureBlendContributions([1, 2, 3, 4], 0.2, 0.8, 0), [{ textureId: 3, weight: 1 }]);
  assert.deepEqual(textureBlendContributions([1, 2, 3, 4], 0.5, 0.5, 1), [
    { textureId: 1, weight: 0.5 },
    { textureId: 4, weight: 0.5 },
  ]);
  assert.deepEqual(textureBlendContributions([1, 2, 3, 4], 0.5, 0.5, 1, true), [
    { textureId: 2, weight: 0.5 },
    { textureId: 3, weight: 0.5 },
  ]);
});

void test('reusable blend weights preserve contribution math without per-pixel allocation', () => {
  const output = [0, 0, 0, 0];
  const first = textureBlendWeights(0.31, 0.78, 0.72, false, output);
  assert.equal(first, output, 'The caller-provided buffer should be reused.');
  const ids = [4, 9, 4, 12];
  const expected = new Map();
  for (let index = 0; index < ids.length; index += 1) expected.set(ids[index], (expected.get(ids[index]) ?? 0) + output[index]);
  assert.deepEqual(textureBlendContributions(ids, 0.31, 0.78, 0.72), [...expected].filter(([, weight]) => weight > 0).map(([textureId, weight]) => ({ textureId, weight })));
});

void test('texture paint feathering is stable and increases coverage with brush strength', () => {
  const weak = [];
  const strong = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      weak.push(shouldPaintTextureVertex(x, y, 17, 0.35, 10));
      strong.push(shouldPaintTextureVertex(x, y, 17, 0.35, 90));
      assert.equal(
        shouldPaintTextureVertex(x, y, 17, 0.35, 90),
        shouldPaintTextureVertex(x, y, 17, 0.35, 90),
        'Dither decisions must be deterministic.',
      );
    }
  }
  assert.ok(strong.filter(Boolean).length > weak.filter(Boolean).length);
  assert.equal(shouldPaintTextureVertex(4, 9, 2, 1, 100), true);
  assert.equal(shouldPaintTextureVertex(4, 9, 2, 0, 100), false);
});
