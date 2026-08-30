import assert from 'node:assert/strict';
import test from 'node:test';

import { cameraInputFromCodes, isCameraControlCode } from '../lib/camera-controls.ts';

void test('camera keyboard controls expose complete pan, tilt, turn, and zoom axes', () => {
  assert.deepEqual(cameraInputFromCodes(new Set(['KeyW', 'KeyD', 'ArrowLeft', 'ArrowUp', 'KeyQ'])), {
    panForward: 1,
    panRight: 1,
    yaw: -1,
    tilt: 1,
    zoom: 1,
  });
  assert.deepEqual(cameraInputFromCodes(new Set(['KeyS', 'KeyA', 'ArrowRight', 'ArrowDown', 'KeyE'])), {
    panForward: -1,
    panRight: -1,
    yaw: 1,
    tilt: -1,
    zoom: -1,
  });
});

void test('opposite camera keys cancel and every zoom alias is recognized', () => {
  const cancelled = cameraInputFromCodes(new Set([
    'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE',
  ]));
  assert.deepEqual(cancelled, { panForward: 0, panRight: 0, yaw: 0, tilt: 0, zoom: 0 });

  for (const code of ['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'PageUp', 'PageDown']) {
    assert.equal(isCameraControlCode(code), true, `${code} should control zoom.`);
  }
  assert.equal(isCameraControlCode('Digit1'), false);
});
