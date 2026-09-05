import type { TerrainData } from './wulfram.ts';

export interface TerrainTextureLayer {
  name: string;
  /** Occupied corners: +X/-Y = 1, -X/-Y = 2, +X/+Y = 4, -X/+Y = 8. */
  corners: number;
}

// Tex_LoadAnimatedFrameSet (0x49c890), lookup table at 0x577008. Frames are
// not in binary corner-mask order. The file's corner values are complemented.
export const TERRAIN_MASK_BY_FRAME = [0, 1, 3, 2, 5, 10, 4, 12, 8, 14, 13, 11, 7, 9, 6, 15] as const;
export const TERRAIN_CORNER_BITS = [2, 1, 8, 4] as const;

// TexAlias_InitTerrainTable (0x49cf20): the first registered layer supplies
// the background and its first template family supplies the overlay masks.
const defaultGroups = new Set((
  'Gdt 1silt 1snow 2snow 2grandcan bluegranite redgranite 1granite 2rough 4rough. '
  + '3grass 3litegrass Grs Bdt bdtdark gbdirt gbdirt_grassy gbdirt_rocky 2gbdirt '
  + '8ice 1ice 11ice 1bush 4sand grandcan roman 5granite 5graniteBrown '
  + 'groundmetal groundrunway groundstruct 20bush_4sand 9bush_1silt '
  + '1martian 2martian 3martian 4martian 6martian 7martian 8martian 9martian '
  + '10martian 11martian 12martian 13martian 14martian greenmartian yellowmartian '
  + 'marsbark marsdino marsdirt marsfunk marsland marslava marsold marsrock marsrough '
  + 'marssoil marsstucco marsvolc marswirl 2marsbark 2marsdino 2marsdirt 2marsfunk '
  + '2marsland 2marslava 2marsold 2marsrock 2marsrough 2marssoil 2marsstucco 2marsvolc '
  + '2marswirl marscanyon 2marscanyon marsand 2marsand rockwall greenrock 6redrockwall '
  + 'sandrock wheat 9bush 3bush olivesage 19bush megadirt reddirt Gmd brownmud 4snow'
).split(' '));
const specialGroups: Record<string, number> = {
  darkrock: 3, canyon: 3, junglecanyon: 3, JJcanyon: 3, '20bush': 3,
  '6redcanyon': 3, stonepath: 3, '4granite': 2, '5ice': 4,
  UDgreekwall: 2, ULgreekwall: 2, romanfloor: 2,
  machuwall_B: 2, machuwall_F: 2, machuwall_L: 2, machuwall_R: 2,
};

export function terrainTemplateFamily(name: string): number | undefined {
  const group = name.replace(/\d{3}$/, '');
  return specialGroups[group] ?? (defaultGroups.has(group) ? 1 : undefined);
}

export function parseTerrainTextureTag(line: string | undefined): TerrainTextureLayer[] {
  const value = line?.trim();
  if (!value) return [];
  if (!value.startsWith('+')) return [{ name: value, corners: 15 }];
  const tokens = value.slice(1).trim().split(/\s+/);
  if (tokens.length % 3 !== 0 || tokens.length > 12) return [];
  const layers: TerrainTextureLayer[] = [];
  for (let index = 0; index < tokens.length; index += 3) {
    const mask = Number(tokens[index + 2]);
    if (!Number.isInteger(mask) || mask < 0 || mask > 15) return [];
    layers.push({ name: tokens[index + 1], corners: mask ^ 15 });
  }
  return layers;
}

export function serializeTerrainTextureTag(layers: TerrainTextureLayer[]): string {
  if (layers.length === 1 && layers[0].corners === 15) return layers[0].name;
  return `+${layers.map(({ name, corners }) => `0template ${name} ${corners ^ 15}`).join(' ')} `;
}

/** Land interleaves two independent streams; only heights use width as stride. */
export function terrainTextureCellIndex(terrain: Pick<TerrainData, 'width' | 'height'>, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= terrain.width - 1 || y >= terrain.height - 1) return -1;
  return y * (terrain.width - 1) + x;
}

/** Original texture painting changes the shared vertex's corner in up to four cells. */
export function paintTerrainTextureVertex(
  terrain: TerrainData,
  vertexX: number,
  vertexY: number,
  name: string,
  tags = new Map(terrain.tagmap2.map((tag, id) => [tag.trim(), id])),
): void {
  for (let dy = -1; dy <= 0; dy += 1) {
    for (let dx = -1; dx <= 0; dx += 1) {
      const index = terrainTextureCellIndex(terrain, vertexX + dx, vertexY + dy);
      if (index < 0) continue;
      const bit = TERRAIN_CORNER_BITS[-dy * 2 - dx];
      const previous = parseTerrainTextureTag(terrain.tagmap2[terrain.textureIds[index]]);
      if (!previous.length) previous.push({ name, corners: 15 });
      const merged = new Map<string, number>();
      for (const layer of previous) {
        merged.set(layer.name, (merged.get(layer.name) ?? 0) | (layer.corners & ~bit));
      }
      merged.set(name, (merged.get(name) ?? 0) | bit);
      const layers = [...merged].filter(([, corners]) => corners !== 0).map(([name, corners]) => ({ name, corners }));
      const tag = serializeTerrainTextureTag(layers);
      let id = tags.get(tag.trim());
      if (id === undefined) {
        id = terrain.tagmap2.length;
        terrain.tagmap2.push(tag);
        tags.set(tag.trim(), id);
      }
      terrain.textureIds[index] = id;
    }
  }
}

/** Four packed source-slot/mask-slot values per cell, consumed by the terrain shader. */
export function buildTerrainCellLayers(terrain: TerrainData, sourceSlots: ReadonlyMap<string, number>): Float32Array {
  const count = (terrain.width - 1) * (terrain.height - 1);
  const output = new Float32Array(count * 4).fill(-1);
  const tags = terrain.tagmap2.map((tag) => {
    const layers = parseTerrainTextureTag(tag);
    const dominant = Math.max(0, layers.findIndex((layer) => terrainTemplateFamily(layer.name) !== undefined));
    const family = terrainTemplateFamily(layers[dominant]?.name ?? '') ?? 1;
    // The background is drawn first; the other layers retain their file order.
    const ordered = layers.length ? [layers[dominant], ...layers.filter((_, index) => index !== dominant)] : [];
    return ordered.map((layer) => (sourceSlots.get(layer.name) ?? 0) * 64 + (family - 1) * 16 + layer.corners);
  });
  for (let cell = 0; cell < count; cell += 1) {
    const layers = tags[terrain.textureIds[cell]];
    if (layers?.length) output.set(layers, cell * 4);
    else output[cell * 4] = 15; // Missing tag: the fallback art, with full coverage.
  }
  return output;
}
