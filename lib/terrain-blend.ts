export interface TextureBlendContribution {
  textureId: number;
  weight: number;
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function textureBlendAxis(value: number, softness: number): number {
  const position = Math.max(0, Math.min(1, value));
  const width = Math.max(0, Math.min(1, softness));
  if (width <= 0.001) return position < 0.5 ? 0 : 1;
  const start = 0.5 - width * 0.5;
  return smoothstep((position - start) / width);
}

export function textureBlendContributions(
  textureIds: [number, number, number, number],
  xFraction: number,
  yFraction: number,
  softness: number,
  usesAntiDiagonal = false,
): TextureBlendContribution[] {
  const x = Math.max(0, Math.min(1, xFraction));
  const y = Math.max(0, Math.min(1, yFraction));
  let weights: [number, number, number, number];
  if (usesAntiDiagonal) {
    weights = x + y <= 1
      ? [1 - x - y, x, y, 0]
      : [0, 1 - y, 1 - x, x + y - 1];
  } else {
    weights = x <= y
      ? [1 - y, 0, y - x, x]
      : [1 - x, x - y, 0, y];
  }
  const blend = Math.max(0, Math.min(1, softness));
  if (blend <= 0.001) {
    const winner = weights.indexOf(Math.max(...weights));
    weights = weights.map((_, index) => index === winner ? 1 : 0) as [number, number, number, number];
  } else {
    const exponent = 1 + (1 - blend) * 8;
    weights = weights.map((weight) => Math.pow(Math.max(0, weight), exponent)) as [number, number, number, number];
  }
  const combined = new Map<number, number>();
  for (let index = 0; index < textureIds.length; index += 1) {
    combined.set(textureIds[index], (combined.get(textureIds[index]) ?? 0) + weights[index]);
  }
  const contributions = [...combined.entries()]
    .filter(([, weight]) => weight > 1e-8)
    .map(([textureId, weight]) => ({ textureId, weight }));
  const total = contributions.reduce((sum, contribution) => sum + contribution.weight, 0);
  return contributions.map((contribution) => ({
    textureId: contribution.textureId,
    weight: contribution.weight / total,
  }));
}

export function shouldPaintTextureVertex(
  gridX: number,
  gridY: number,
  textureId: number,
  radialFalloff: number,
  strengthPercent: number,
): boolean {
  const strength = Math.max(0, Math.min(1, strengthPercent / 100));
  const coverage = Math.max(0, Math.min(1, radialFalloff * (0.85 + strength * 1.15)));
  if (coverage >= 1) return true;
  let hash = Math.imul(Math.trunc(gridX), 73_856_093)
    ^ Math.imul(Math.trunc(gridY), 19_349_663)
    ^ Math.imul(Math.trunc(textureId), 83_492_791);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2_246_822_519);
  hash ^= hash >>> 13;
  const threshold = (hash >>> 0) / 4_294_967_295;
  return threshold < coverage;
}
