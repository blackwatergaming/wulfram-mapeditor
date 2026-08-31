import assert from 'node:assert/strict';
import test from 'node:test';

import {
  constrainEntityTransform,
  entityPositionToScene,
  entityRotationToScene,
  hasLockedAltitudeAndRotation,
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

void test('starship transforms preserve absolute Z and every authored rotation axis', () => {
  const starship = {
    token: 'h',
    position: [100, 200, 2575],
    rotation: [0, 0, 1.570796],
  };
  assert.equal(hasLockedAltitudeAndRotation(starship), true);
  assert.deepEqual(
    constrainEntityTransform(starship, [350, 450, 12], [0.4, 0.6, 3.14]),
    { position: [350, 450, 2575], rotation: [0, 0, 1.570796] },
  );

  const repair = { ...starship, token: 'r' };
  assert.equal(hasLockedAltitudeAndRotation(repair), false);
  assert.deepEqual(
    constrainEntityTransform(repair, [350, 450, 12], [0.4, 0.6, 3.14]),
    { position: [350, 450, 12], rotation: [0.4, 0.6, 3.14] },
  );
});
