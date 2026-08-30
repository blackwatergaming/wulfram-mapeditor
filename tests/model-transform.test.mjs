import assert from 'node:assert/strict';
import test from 'node:test';

import {
  entityPositionToScene,
  entityRotationToScene,
  scenePositionToEntity,
  sceneRotationToEntity,
} from '../lib/model-transform.ts';
import { createBlankProject } from '../lib/wulfram.ts';

void test('3D gizmo position conversion preserves Wulfram XYZ through Three.js XZY space', () => {
  const terrain = createBlankProject('Transform fixture', 3).terrain;
  terrain.worldWidth = 200;
  terrain.worldHeight = 160;
  const entityPosition = [135.25, 42.5, 17.75];
  const scenePosition = entityPositionToScene(entityPosition, terrain, 0.08);
  assert.deepEqual(scenePosition, [2.82, 1.42, -3]);
  assert.deepEqual(scenePositionToEntity(scenePosition, terrain, 0.08), entityPosition);
});

void test('3D gizmo rotation conversion exposes pitch, roll, and yaw without swapping on commit', () => {
  const entityRotation = [0.25, -0.5, 1.75];
  const sceneRotation = entityRotationToScene(entityRotation);
  assert.deepEqual(sceneRotation, [-0.25, -1.75, 0.5]);
  assert.deepEqual(sceneRotationToEntity(sceneRotation), entityRotation);
});
