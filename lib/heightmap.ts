export interface HeightmapControls {
  minimum: number;
  maximum: number;
  gamma: number;
  smoothingPasses: number;
}

function smoothHeights(source: number[], width: number, height: number): number[] {
  const output = Array.from({ length: source.length }, () => 0);
  const weights = [1, 2, 1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
          total += source[sampleY * width + sampleX] * weights[offsetX + 1] * weights[offsetY + 1];
        }
      }
      output[y * width + x] = total / 16;
    }
  }
  return output;
}

export function heightsFromGrayscaleRgba(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  controls: HeightmapControls,
): number[] {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Heightmap dimensions must be positive integers.');
  }
  if (pixels.length < width * height * 4) throw new Error('Heightmap pixel data is incomplete.');
  const minimum = Number.isFinite(controls.minimum) ? controls.minimum : 0;
  const maximum = Number.isFinite(controls.maximum) ? controls.maximum : minimum;
  const gamma = Number.isFinite(controls.gamma) ? Math.max(0.1, Math.min(4, controls.gamma)) : 1;
  const smoothingPasses = Number.isFinite(controls.smoothingPasses)
    ? Math.max(0, Math.min(8, Math.trunc(controls.smoothingPasses)))
    : 0;
  let heights = Array.from({ length: width * height }, () => 0);
  for (let index = 0; index < heights.length; index += 1) {
    const pixel = index * 4;
    const rawLuminance = (pixels[pixel] * 0.2126 + pixels[pixel + 1] * 0.7152 + pixels[pixel + 2] * 0.0722) / 255;
    const luminance = rawLuminance < 1e-12 ? 0 : rawLuminance > 1 - 1e-12 ? 1 : rawLuminance;
    heights[index] = minimum + Math.pow(luminance, gamma) * (maximum - minimum);
  }
  for (let pass = 0; pass < smoothingPasses; pass += 1) heights = smoothHeights(heights, width, height);
  return heights;
}
