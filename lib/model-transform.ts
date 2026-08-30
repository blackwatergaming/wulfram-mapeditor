import type { TerrainData, Vec3 } from './wulfram.ts';

/** Wulfram uses world XY with Z up; Three.js uses XZ with Y up. */
export function entityPositionToScene(position: Vec3, terrain: TerrainData, scale: number): Vec3 {
  return [
    (position[0] - terrain.worldWidth / 2) * scale,
    position[2] * scale,
    (position[1] - terrain.worldHeight / 2) * scale,
  ];
}

export function scenePositionToEntity(position: Vec3, terrain: TerrainData, scale: number): Vec3 {
  return [
    position[0] / scale + terrain.worldWidth / 2,
    position[2] / scale + terrain.worldHeight / 2,
    position[1] / scale,
  ];
}

/** Maps Wulfram pitch/roll/yaw into the model holder's Three.js X/Y/Z Euler axes. */
export function entityRotationToScene(rotation: Vec3): Vec3 {
  return [-rotation[0], -rotation[2], -rotation[1]];
}

export function sceneRotationToEntity(rotation: Vec3): Vec3 {
  return [-rotation[0], -rotation[2], -rotation[1]];
}
