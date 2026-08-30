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
  const weights = textureBlendWeights(xFraction, yFraction, softness, usesAntiDiagonal);
  const combined = new Map<number, number>();
  for (let index = 0; index < textureIds.length; index += 1) {
    combined.set(textureIds[index], (combined.get(textureIds[index]) ?? 0) + weights[index]);
  }
  return [...combined.entries()]
    .filter(([, weight]) => weight > 0)
    .map(([textureId, weight]) => ({ textureId, weight }));
}

export function textureBlendWeights(
  xFraction: number,
  yFraction: number,
  softness: number,
  usesAntiDiagonal = false,
  output: [number, number, number, number] = [0, 0, 0, 0],
): [number, number, number, number] {
  const x = Math.max(0, Math.min(1, xFraction));
  const y = Math.max(0, Math.min(1, yFraction));
  if (usesAntiDiagonal) {
    if (x + y <= 1) {
      output[0] = 1 - x - y;
      output[1] = x;
      output[2] = y;
      output[3] = 0;
    } else {
      output[0] = 0;
      output[1] = 1 - y;
      output[2] = 1 - x;
      output[3] = x + y - 1;
    }
  } else if (x <= y) {
    output[0] = 1 - y;
    output[1] = 0;
    output[2] = y - x;
    output[3] = x;
  } else {
    output[0] = 1 - x;
    output[1] = x - y;
    output[2] = 0;
    output[3] = y;
  }
  const blend = Math.max(0, Math.min(1, softness));
  if (blend <= 0.001) {
    let winner = 0;
    for (let index = 1; index < output.length; index += 1) {
      if (output[index] > output[winner]) winner = index;
    }
    for (let index = 0; index < output.length; index += 1) output[index] = index === winner ? 1 : 0;
  } else {
    const exponent = 1 + (1 - blend) * 8;
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.pow(Math.max(0, output[index]), exponent);
    }
  }
  let total = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] <= 1e-8) output[index] = 0;
    total += output[index];
  }
  for (let index = 0; index < output.length; index += 1) output[index] /= total;
  return output;
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
