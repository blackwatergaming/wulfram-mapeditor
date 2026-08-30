export type TerrainBrushShape = 'round' | 'square' | 'diamond';
export type TerrainBrushFalloff = 'soft' | 'linear' | 'hard';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Returns normalized distance from the brush center to the selected footprint
 * boundary. Values at or below one are inside the brush.
 */
export function terrainBrushDistance(
  deltaX: number,
  deltaY: number,
  radius: number,
  shape: TerrainBrushShape,
): number {
  const extent = Math.max(Number.EPSILON, Math.abs(radius));
  const x = Math.abs(deltaX) / extent;
  const y = Math.abs(deltaY) / extent;
  if (shape === 'square') return Math.max(x, y);
  if (shape === 'diamond') return x + y;
  return Math.hypot(x, y);
}

/** Brush influence with exact hard edges available for pads and roads. */
export function terrainBrushWeight(
  deltaX: number,
  deltaY: number,
  radius: number,
  shape: TerrainBrushShape,
  falloff: TerrainBrushFalloff,
): number {
  const distance = terrainBrushDistance(deltaX, deltaY, radius, shape);
  if (distance > 1) return 0;
  if (falloff === 'hard') return 1;
  const remaining = clamp01(1 - distance);
  if (falloff === 'linear') return remaining;
  return Math.pow(remaining, 1.65);
}

/** Converts strength and brush influence into a safe interpolation amount. */
export function terrainBrushMix(strengthPercent: number, weight: number, response = 1): number {
  return clamp01(clamp01(strengthPercent / 100) * clamp01(weight) * Math.max(0, response));
}
