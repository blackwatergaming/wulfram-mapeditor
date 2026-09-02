/** Keep the outer ring of terrain vertices at the map's ground-plane height. */
export function pinTerrainEdgeHeights(
  heights: number[],
  width: number,
  height: number,
): number[] {
  if (width < 1 || height < 1) return heights;

  const lastRow = (height - 1) * width;
  for (let x = 0; x < width; x += 1) {
    heights[x] = 0;
    heights[lastRow + x] = 0;
  }
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    heights[row] = 0;
    heights[row + width - 1] = 0;
  }
  return heights;
}
