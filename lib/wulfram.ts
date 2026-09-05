export type Vec3 = [number, number, number];

export interface TerrainData {
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
  /** Original sky family, shared by all base layouts on this terrain. */
  skyName?: string;
  /** Packed cell IDs use width - 1 as stride; trailing land-row values are retained for round trips. */
  textureIds: number[];
  heights: number[];
  tagmap: string[];
  tagmap2: string[];
}

export interface StateEntity {
  id: string;
  token: string;
  subtype?: string;
  team: number;
  position: Vec3;
  rotation: Vec3;
  active: number;
  raw?: string;
}

export interface ValidationSettings {
  serviceRadius: number;
  backupRadius: number;
  maxSlopeDegrees: number;
  minSpacing: number;
}

export type BaseLayoutMetadata = Record<string, string>;

export interface BaseLayoutState {
  id: string;
  name: string;
  metadata: BaseLayoutMetadata;
  entities: StateEntity[];
  validation: ValidationSettings;
  updatedAt: string;
}

export interface WulframProject {
  format: 'wulfram-map-project';
  version: 1;
  name: string;
  terrain: TerrainData;
  entities: StateEntity[];
  validation: ValidationSettings;
  baseLayouts: BaseLayoutState[];
  activeBaseLayoutId: string;
  updatedAt: string;
}

export interface TextureAsset {
  url: string;
  width: number;
  height: number;
  average: string;
}

export interface TeamMaterialVariant {
  neutral: string;
  team1: string;
  team2: string;
}

export interface ModelAsset {
  url: string;
  bounds: { min: Vec3; max: Vec3 };
  vertices: number;
  faces: number;
}

export interface AssetManifest {
  provenance: Record<string, string>;
  terrainTextures: Record<string, TextureAsset>;
  terrainMasks?: Record<string, TextureAsset>;
  skyboxes?: Record<string, TextureAsset & { label: string; horizon: string }>;
  materials: Record<string, TextureAsset>;
  materialVariants: Record<string, TeamMaterialVariant>;
  models: Record<string, ModelAsset>;
  baseTemplates: { url: string; count: number };
  demo: { name: string; baseUrl: string; files: string[] };
}

export interface BaseTemplateUnit {
  token: string;
  subtype?: string;
  offset: [number, number];
  groundOffset: number;
  rotation: Vec3;
  active: number;
}

export interface BaseTemplate {
  id: string;
  name: string;
  description?: string;
  curated?: boolean;
  sourceMap: string;
  sourceState: string;
  sourceTeam: number;
  sourceWorldSize: [number, number];
  sourceAnchor: [number, number];
  unitCount: number;
  footprint: { width: number; height: number };
  units: BaseTemplateUnit[];
}

export interface BaseTemplateLibrary {
  format: 'wulfram-base-template-library';
  version: 1;
  source: {
    mapsRoot: string;
    stateFiles: number;
    records: number;
    method: string;
    clusterDistance: number;
    auxiliaryDistance: number;
    minimumCoreUnits: number;
    curatedTemplates?: number;
  };
  templates: BaseTemplate[];
}

export interface BaseTemplatePlacement {
  entities: StateEntity[];
  scale: number;
  anchor: [number, number];
  skippedWithoutModel: number;
}

export interface TerrainSnapResult {
  height: number;
  pitch: number;
  roll: number;
  groundHeight: number;
  safetyLift: number;
}

export interface StructureTerrainClearance {
  footprint: number;
  groundOffset: number;
  margin: number;
  modelBottom: number;
  modelName?: string;
}

export interface ShapeModel {
  name: string;
  materials: string[];
  meshes: { materialIndex: number; positions: number[]; uvs: number[] }[];
  bounds: { min: Vec3; max: Vec3 };
}

export interface CatalogItem {
  key: string;
  token: string;
  subtype?: string;
  label: string;
  shortLabel: string;
  description: string;
  category: 'infrastructure' | 'defense' | 'support' | 'logistics';
  requiresPower: boolean;
  footprint: number;
}

export interface ValidationIssue {
  entityId: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export const ENTITY_NAMES: Record<string, string> = {
  i: 'Mine',
  c: 'Cargo Box',
  u: 'Uplink',
  h: 'Supply Ship',
  e: 'Power Cell',
  f: 'Refuel Pad',
  r: 'Repair Pad',
  S: 'Shield',
  s: 'Flak Turret',
  g: 'Gun Turret',
  E: 'Heavy Missile Silo',
  L: 'Missile Launcher',
  p: 'Skypump',
  o: 'Portal',
  d: 'Darklight',
  b: 'Spy Bug',
  '*': 'Decoration',
};

export const CARGO_NAMES: Record<string, string> = {
  e: 'Power Cell cargo',
  f: 'Refuel cargo',
  r: 'Repair cargo',
  h: 'Shield cargo',
  s: 'Flak cargo',
  g: 'Gun cargo',
  M: 'Heavy silo cargo',
  L: 'Missile launcher cargo',
  p: 'Skypump cargo',
  o: 'Portal cargo',
  d: 'Darklight cargo',
  b: 'Spy bug cargo',
};

export const CATALOG: CatalogItem[] = [
  { key: 'power', token: 'e', label: 'Power Cell', shortLabel: 'PC', description: 'Primary or backup power source', category: 'infrastructure', requiresPower: false, footprint: 14 },
  { key: 'refuel', token: 'f', label: 'Refuel Pad', shortLabel: 'RF', description: 'Vehicle refueling platform', category: 'infrastructure', requiresPower: true, footprint: 26 },
  { key: 'repair', token: 'r', label: 'Repair Pad', shortLabel: 'RP', description: 'Vehicle repair platform', category: 'infrastructure', requiresPower: true, footprint: 26 },
  { key: 'shield', token: 'S', label: 'Shield', shortLabel: 'SH', description: 'Base shield generator', category: 'defense', requiresPower: true, footprint: 18 },
  { key: 'flak', token: 's', label: 'Flak Turret', shortLabel: 'FL', description: 'Anti-air defense turret', category: 'defense', requiresPower: true, footprint: 12 },
  { key: 'gun', token: 'g', label: 'Gun Turret', shortLabel: 'GT', description: 'Direct-fire defense turret', category: 'defense', requiresPower: true, footprint: 12 },
  { key: 'silo', token: 'E', label: 'Heavy Missile Silo', shortLabel: 'HS', description: 'Heavy missile defense', category: 'defense', requiresPower: true, footprint: 18 },
  { key: 'launcher', token: 'L', label: 'Missile Launcher', shortLabel: 'ML', description: 'Guided missile launcher', category: 'defense', requiresPower: true, footprint: 14 },
  { key: 'skypump', token: 'p', label: 'Skypump', shortLabel: 'SK', description: 'Atmospheric resource pump', category: 'support', requiresPower: false, footprint: 14 },
  { key: 'portal', token: 'o', label: 'Portal', shortLabel: 'PO', description: 'Powered transit portal', category: 'support', requiresPower: true, footprint: 18 },
  { key: 'darklight', token: 'd', label: 'Darklight', shortLabel: 'DL', description: 'Darklight support unit', category: 'support', requiresPower: false, footprint: 13 },
  { key: 'bug', token: 'b', label: 'Spy Bug', shortLabel: 'SB', description: 'Small reconnaissance unit', category: 'support', requiresPower: false, footprint: 7 },
  { key: 'uplink', token: 'u', label: 'Uplink', shortLabel: 'UP', description: 'Team communications uplink', category: 'logistics', requiresPower: false, footprint: 10 },
  { key: 'starship', token: 'h', label: 'Supply Starship', shortLabel: 'SS', description: 'State-tagged team supply ship', category: 'logistics', requiresPower: false, footprint: 36 },
  { key: 'cargo-power', token: 'c', subtype: 'e', label: 'Power Cell Cargo', shortLabel: 'CP', description: 'Deployable power-cell cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-refuel', token: 'c', subtype: 'f', label: 'Refuel Cargo', shortLabel: 'CR', description: 'Deployable refuel-pad cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-repair', token: 'c', subtype: 'r', label: 'Repair Cargo', shortLabel: 'CX', description: 'Deployable repair-pad cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-shield', token: 'c', subtype: 'h', label: 'Shield Cargo', shortLabel: 'CS', description: 'Deployable shield cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-gun', token: 'c', subtype: 'g', label: 'Gun Turret Cargo', shortLabel: 'CG', description: 'Deployable gun-turret cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-flak', token: 'c', subtype: 's', label: 'Flak Turret Cargo', shortLabel: 'CF', description: 'Deployable flak-turret cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-silo', token: 'c', subtype: 'M', label: 'Heavy Silo Cargo', shortLabel: 'CH', description: 'Deployable heavy-silo cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-missile', token: 'c', subtype: 'L', label: 'Missile Cargo', shortLabel: 'CM', description: 'Deployable missile-launcher cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-skypump', token: 'c', subtype: 'p', label: 'Skypump Cargo', shortLabel: 'CK', description: 'Deployable skypump cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-portal', token: 'c', subtype: 'o', label: 'Portal Cargo', shortLabel: 'CO', description: 'Deployable portal cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-darklight', token: 'c', subtype: 'd', label: 'Darklight Cargo', shortLabel: 'CD', description: 'Deployable darklight cargo', category: 'logistics', requiresPower: false, footprint: 8 },
  { key: 'cargo-bug', token: 'c', subtype: 'b', label: 'Spy Bug Cargo', shortLabel: 'CB', description: 'Deployable spy-bug cargo', category: 'logistics', requiresPower: false, footprint: 8 },
];

export const DEFAULT_VALIDATION: ValidationSettings = {
  serviceRadius: 300,
  backupRadius: 80,
  maxSlopeDegrees: 22,
  minSpacing: 8,
};

/** The extracted .shape coordinates are rendered at this world-unit scale. */
export const MODEL_WORLD_SCALE = 2.1;

/** Minimum air gap retained below terrain-conformed structures. */
export const STRUCTURE_BOTTOM_MARGIN = 0.25;

/** Median absolute Z across the 46 unique supply-starship rows in all shipped maps. */
export const STARSHIP_SPAWN_HEIGHT = 2574.066650390625;

export const DEFAULT_BASE_LAYOUT_ID = 'default';

export function createId(prefix = 'unit'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function cloneStateEntities(entities: StateEntity[]): StateEntity[] {
  return entities.map((entity) => ({
    ...entity,
    position: [...entity.position] as Vec3,
    rotation: [...entity.rotation] as Vec3,
  }));
}

function normalizedLayoutMetadata(value: unknown): BaseLayoutMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key.length > 0 && typeof entry === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Upgrades legacy single-state projects in place and makes the top-level
 * entities/validation fields the editable projection of the active layout.
 */
export function synchronizeActiveBaseLayout(
  project: WulframProject,
  updatedAt?: string,
): WulframProject {
  if (!Array.isArray(project.baseLayouts) || project.baseLayouts.length === 0) {
    project.baseLayouts = [{
      id: DEFAULT_BASE_LAYOUT_ID,
      name: 'Default',
      metadata: {},
      entities: cloneStateEntities(project.entities ?? []),
      validation: { ...DEFAULT_VALIDATION, ...project.validation },
      updatedAt: project.updatedAt,
    }];
    project.activeBaseLayoutId = DEFAULT_BASE_LAYOUT_ID;
  }

  const seen = new Set<string>();
  project.baseLayouts = project.baseLayouts.map((layout, index) => {
    let id = typeof layout.id === 'string' && layout.id.trim()
      ? layout.id.trim()
      : index === 0 ? DEFAULT_BASE_LAYOUT_ID : `layout-${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id,
      name: typeof layout.name === 'string' && layout.name.trim()
        ? layout.name.trim()
        : `Layout ${index + 1}`,
      metadata: normalizedLayoutMetadata(layout.metadata),
      entities: cloneStateEntities(Array.isArray(layout.entities) ? layout.entities : []),
      validation: { ...DEFAULT_VALIDATION, ...project.validation, ...layout.validation },
      updatedAt: typeof layout.updatedAt === 'string' && !Number.isNaN(Date.parse(layout.updatedAt))
        ? layout.updatedAt
        : project.updatedAt,
    };
  });

  if (!seen.has(project.activeBaseLayoutId)) {
    project.activeBaseLayoutId = project.baseLayouts[0].id;
  }
  const active = project.baseLayouts.find((layout) => layout.id === project.activeBaseLayoutId)!;
  active.entities = cloneStateEntities(project.entities ?? active.entities);
  active.validation = { ...DEFAULT_VALIDATION, ...project.validation };
  if (updatedAt) active.updatedAt = updatedAt;
  return project;
}

export function activeBaseLayout(project: WulframProject): BaseLayoutState {
  synchronizeActiveBaseLayout(project);
  return project.baseLayouts.find((layout) => layout.id === project.activeBaseLayoutId)!;
}

export function activateBaseLayout(project: WulframProject, id: string): WulframProject {
  synchronizeActiveBaseLayout(project);
  const layout = project.baseLayouts.find((candidate) => candidate.id === id);
  if (!layout) throw new Error(`Unknown base layout: ${id}`);
  project.activeBaseLayoutId = layout.id;
  project.entities = cloneStateEntities(layout.entities);
  project.validation = { ...layout.validation };
  return project;
}

export function createBlankProject(name = 'Untitled map', size = 129): WulframProject {
  const count = size * size;
  const updatedAt = new Date().toISOString();
  return {
    format: 'wulfram-map-project',
    version: 1,
    name,
    terrain: {
      width: size,
      height: size,
      worldWidth: 5600,
      worldHeight: 5600,
      textureIds: Array.from({ length: count }, () => 0),
      heights: Array.from({ length: count }, () => 0),
      tagmap: ['0:backface'],
      tagmap2: ['backface'],
    },
    entities: [],
    validation: { ...DEFAULT_VALIDATION },
    baseLayouts: [{
      id: DEFAULT_BASE_LAYOUT_ID,
      name: 'Default',
      metadata: {},
      entities: [],
      validation: { ...DEFAULT_VALIDATION },
      updatedAt,
    }],
    activeBaseLayoutId: DEFAULT_BASE_LAYOUT_ID,
    updatedAt,
  };
}

export function parseLand(text: string): TerrainData {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  const dimensions = lines[0]?.trim().match(/^(\d+)x(\d+)$/i);
  const world = lines[1]?.trim().match(/^([\d.+-eE]+)x([\d.+-eE]+)$/);
  if (!dimensions || !world) throw new Error('Invalid land header. Expected widthxheight and worldWidthxworldHeight.');
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  const worldWidth = Number(world[1]);
  const worldHeight = Number(world[2]);
  if (!Number.isFinite(worldWidth) || !Number.isFinite(worldHeight) || lines.length < width * height + 2) {
    throw new Error('The land file is incomplete or has an invalid world size.');
  }
  const textureIds: number[] = [];
  const heights: number[] = [];
  for (const line of lines.slice(2, 2 + width * height)) {
    const [texture, elevation] = line.trim().split(/\s+/);
    textureIds.push(Number.parseInt(texture, 10) || 0);
    heights.push(Number.parseFloat(elevation) || 0);
  }
  return { width, height, worldWidth, worldHeight, textureIds, heights, tagmap: [], tagmap2: [] };
}

export function serializeLand(terrain: TerrainData): string {
  const rows = [`${terrain.width}x${terrain.height}`, `${terrain.worldWidth.toFixed(6)}x${terrain.worldHeight.toFixed(6)}`];
  for (let index = 0; index < terrain.width * terrain.height; index += 1) {
    rows.push(`${Math.max(0, Math.trunc(terrain.textureIds[index] ?? 0))} ${(terrain.heights[index] ?? 0).toFixed(6)}`);
  }
  return `${rows.join('\r\n')}\r\n`;
}

export function parseState(text: string): StateEntity[] {
  const entities: StateEntity[] = [];
  let sourceRow = 0;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    sourceRow += 1;
    const parts = line.split(/\s+/);
    if (parts[0] === '*') {
      entities.push({ id: `decoration-${sourceRow}`, token: '*', team: 0, position: [0, 0, 0], rotation: [0, 0, 0], active: 1, raw: line });
      continue;
    }
    const cargo = parts[0] === 'c';
    const numeric = cargo ? parts.slice(2) : parts.slice(1);
    if (numeric.length < 8) continue;
    const values = numeric.map(Number);
    if (values.some((value) => !Number.isFinite(value))) continue;
    entities.push({
      id: `${parts[0]}-${sourceRow}`,
      token: parts[0],
      subtype: cargo ? parts[1] : undefined,
      team: Math.trunc(values[0]),
      position: [values[1], values[2], values[3]],
      rotation: [values[4], values[5], values[6]],
      active: Math.trunc(values[7]),
    });
  }
  return entities;
}

const fixed = (value: number) => (Number.isFinite(value) ? value : 0).toFixed(12);

export function serializeState(entities: StateEntity[]): string {
  const rows = entities.map((entity) => {
    if (entity.raw && entity.token === '*') return entity.raw;
    const prefix = entity.token === 'c' ? `c ${entity.subtype ?? 'e'}` : entity.token;
    return `${prefix} ${Math.trunc(entity.team)} ${entity.position.map(fixed).join(' ')}  ${entity.rotation.map(fixed).join(' ')} ${Math.trunc(entity.active)}`;
  });
  return rows.length ? `${rows.join('\r\n\r\n')}\r\n` : '';
}

export function parseLines(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

export function serializeLines(lines: string[]): string {
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

export function resolveTextureName(line: string | undefined, assets: Record<string, TextureAsset>): string | undefined {
  if (!line) return undefined;
  if (assets[line]) return line;
  for (const token of line.split(/\s+/)) {
    if (assets[token]) return token;
  }
  return undefined;
}

export function ensureTextureTag(terrain: TerrainData, textureName: string): number {
  const existing = terrain.tagmap2.findIndex((line) => line.trim() === textureName);
  if (existing >= 0) return existing;
  terrain.tagmap2.push(textureName);
  if (!terrain.tagmap.some((line) => line.endsWith(`:${textureName}`))) {
    terrain.tagmap.push(`${terrain.tagmap.length}:${textureName}`);
  }
  return terrain.tagmap2.length - 1;
}

export function sampleHeight(terrain: TerrainData, worldX: number, worldY: number): number {
  const gridX = Math.max(0, Math.min(terrain.width - 1, worldX / terrain.worldWidth * (terrain.width - 1)));
  const gridY = Math.max(0, Math.min(terrain.height - 1, worldY / terrain.worldHeight * (terrain.height - 1)));
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = Math.min(x0 + 1, terrain.width - 1);
  const y1 = Math.min(y0 + 1, terrain.height - 1);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const at = (x: number, y: number) => terrain.heights[y * terrain.width + x] ?? 0;
  const usesAntiDiagonal = ((x0 ^ y0) & 1) === 1;
  if (usesAntiDiagonal) {
    return tx + ty <= 1
      ? at(x0, y0) + tx * (at(x1, y0) - at(x0, y0)) + ty * (at(x0, y1) - at(x0, y0))
      : at(x1, y1) + (1 - tx) * (at(x0, y1) - at(x1, y1)) + (1 - ty) * (at(x1, y0) - at(x1, y1));
  }
  return tx <= ty
    ? at(x0, y0) + tx * (at(x1, y1) - at(x0, y0)) + (ty - tx) * (at(x0, y1) - at(x0, y0))
    : at(x0, y0) + ty * (at(x1, y1) - at(x0, y0)) + (tx - ty) * (at(x1, y0) - at(x0, y0));
}

export function sampleSlopeDegrees(terrain: TerrainData, worldX: number, worldY: number): number {
  const dx = terrain.worldWidth / Math.max(1, terrain.width - 1);
  const dy = terrain.worldHeight / Math.max(1, terrain.height - 1);
  const sx = (sampleHeight(terrain, worldX + dx, worldY) - sampleHeight(terrain, worldX - dx, worldY)) / (2 * dx);
  const sy = (sampleHeight(terrain, worldX, worldY + dy) - sampleHeight(terrain, worldX, worldY - dy)) / (2 * dy);
  return Math.atan(Math.hypot(sx, sy)) * 180 / Math.PI;
}

export function usesFootprintTerrainSnap(token: string): boolean {
  return token === 'e'
    || token === 'f'
    || token === 'r'
    || token === 's'
    || token === 'g'
    || token === 'L'
    || token === 'p'
    || token === 'd'
    || token === 'u'
    || token === 'c';
}

/** Keeps newly placed airborne starships at the authored example-state altitude. */
export function placementHeightForToken(token: string, terrainConformedHeight: number): number {
  return token === 'h' ? STARSHIP_SPAWN_HEIGHT : terrainConformedHeight;
}

/**
 * Expands legacy placement defaults to the actual rendered model bounds. Some
 * pad models are much wider and extend farther below their origin than their
 * old catalog footprint suggests, which otherwise lets their edges clip.
 */
export function structureTerrainClearance(
  entity: Pick<StateEntity, 'token' | 'team'>,
  manifest: AssetManifest | undefined,
  requestedFootprint: number,
  requestedGroundOffset: number,
  requestedMargin = STRUCTURE_BOTTOM_MARGIN,
): StructureTerrainClearance {
  const name = modelNameFor(entity);
  const bounds = name ? manifest?.models[name]?.bounds : undefined;
  const modelWidth = bounds ? Math.max(0, bounds.max[0] - bounds.min[0]) * MODEL_WORLD_SCALE : 0;
  const modelDepth = bounds ? Math.max(0, bounds.max[1] - bounds.min[1]) * MODEL_WORLD_SCALE : 0;
  const modelBottom = bounds ? Math.max(0, -bounds.min[2] * MODEL_WORLD_SCALE) : 0;
  const footprint = Number.isFinite(requestedFootprint) ? Math.abs(requestedFootprint) : 0;
  const groundOffset = Number.isFinite(requestedGroundOffset) ? requestedGroundOffset : 0;
  const margin = Number.isFinite(requestedMargin) ? requestedMargin : 0;
  return {
    footprint: Math.max(0.5, footprint, modelWidth, modelDepth),
    groundOffset: Math.max(groundOffset, modelBottom),
    margin: Math.max(STRUCTURE_BOTTOM_MARGIN, margin),
    modelBottom,
    modelName: bounds ? name : undefined,
  };
}

/**
 * Fits a plane to dense samples across a structure-sized terrain footprint, aligns the
 * structure's local up axis to that plane, then lifts its origin until every
 * sampled point clears the terrain. The final margin prevents coplanar flicker
 * and small triangle-to-model penetrations.
 */
export function snapStructureToTerrain(
  terrain: TerrainData,
  worldX: number,
  worldY: number,
  footprint: number,
  yawRadians: number,
  groundOffset: number,
  margin = STRUCTURE_BOTTOM_MARGIN,
): TerrainSnapResult {
  const halfExtent = Math.max(0.5, Math.abs(footprint) * 0.5);
  const yaw = Number.isFinite(yawRadians) ? yawRadians : 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const samples: Array<{ dx: number; dy: number; height: number }> = [];
  const sampleSteps = [-1, -0.5, 0, 0.5, 1];
  for (const yStep of sampleSteps) {
    for (const xStep of sampleSteps) {
      const localX = halfExtent * xStep;
      const localY = halfExtent * yStep;
      const dx = localX * cosine - localY * sine;
      const dy = localX * sine + localY * cosine;
      samples.push({ dx, dy, height: sampleHeight(terrain, worldX + dx, worldY + dy) });
    }
  }

  // Also include every underlying terrain-grid vertex within the rotated
  // footprint so a narrow ridge between regular samples cannot pierce a pad.
  const gridStepX = terrain.worldWidth / Math.max(1, terrain.width - 1);
  const gridStepY = terrain.worldHeight / Math.max(1, terrain.height - 1);
  const worldExtent = halfExtent * (Math.abs(cosine) + Math.abs(sine));
  const minimumGridX = Math.max(0, Math.ceil((worldX - worldExtent) / gridStepX));
  const maximumGridX = Math.min(terrain.width - 1, Math.floor((worldX + worldExtent) / gridStepX));
  const minimumGridY = Math.max(0, Math.ceil((worldY - worldExtent) / gridStepY));
  const maximumGridY = Math.min(terrain.height - 1, Math.floor((worldY + worldExtent) / gridStepY));
  for (let gridY = minimumGridY; gridY <= maximumGridY; gridY += 1) {
    for (let gridX = minimumGridX; gridX <= maximumGridX; gridX += 1) {
      const dx = gridX * gridStepX - worldX;
      const dy = gridY * gridStepY - worldY;
      const localX = dx * cosine + dy * sine;
      const localY = -dx * sine + dy * cosine;
      if (Math.abs(localX) > halfExtent + 1e-9 || Math.abs(localY) > halfExtent + 1e-9) continue;
      samples.push({ dx, dy, height: terrain.heights[gridY * terrain.width + gridX] ?? 0 });
    }
  }

  const meanHeight = samples.reduce((total, sample) => total + sample.height, 0) / samples.length;
  const xx = samples.reduce((total, sample) => total + sample.dx * sample.dx, 0);
  const yy = samples.reduce((total, sample) => total + sample.dy * sample.dy, 0);
  const xy = samples.reduce((total, sample) => total + sample.dx * sample.dy, 0);
  const xh = samples.reduce((total, sample) => total + sample.dx * (sample.height - meanHeight), 0);
  const yh = samples.reduce((total, sample) => total + sample.dy * (sample.height - meanHeight), 0);
  const determinant = xx * yy - xy * xy;
  const slopeX = Math.abs(determinant) > 1e-9 ? (xh * yy - yh * xy) / determinant : 0;
  const slopeY = Math.abs(determinant) > 1e-9 ? (yh * xx - xh * xy) / determinant : 0;
  const highestResidual = samples.reduce(
    (highest, sample) => Math.max(highest, sample.height - (meanHeight + slopeX * sample.dx + slopeY * sample.dy)),
    0,
  );
  const localSlopeX = slopeX * cosine + slopeY * sine;
  const localSlopeY = -slopeX * sine + slopeY * cosine;
  const pitch = Math.atan2(localSlopeY, Math.sqrt(1 + localSlopeX * localSlopeX));
  const roll = Math.atan2(-localSlopeX, 1);
  const safeGroundOffset = Number.isFinite(groundOffset) ? groundOffset : 0;
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  const safetyLift = highestResidual + safeMargin;

  return {
    height: meanHeight + safeGroundOffset + safetyLift,
    pitch,
    roll,
    groundHeight: sampleHeight(terrain, worldX, worldY),
    safetyLift,
  };
}

export function instantiateBaseTemplate(
  template: BaseTemplate,
  terrain: TerrainData,
  requestedAnchor: [number, number],
  team: number,
  requestedScale = 1,
  yawRadians = 0,
  manifest?: AssetManifest,
  placementMargin = STRUCTURE_BOTTOM_MARGIN,
): BaseTemplatePlacement {
  const units = template.units.filter((unit) => {
    const entity = { token: unit.token, subtype: unit.subtype, team };
    return manifest ? hasModelForEntity(entity, manifest) : Boolean(modelNameFor(entity));
  });
  const skippedWithoutModel = template.units.length - units.length;
  if (!units.length) return { entities: [], scale: requestedScale, anchor: requestedAnchor, skippedWithoutModel };
  const safeScale = Number.isFinite(requestedScale) ? Math.max(0.1, requestedScale) : 1;
  const safeYaw = Number.isFinite(yawRadians) ? yawRadians : 0;
  const cosine = Math.cos(safeYaw);
  const sine = Math.sin(safeYaw);
  const rotatedOffsets = units.map((unit) => [
    unit.offset[0] * cosine - unit.offset[1] * sine,
    unit.offset[0] * sine + unit.offset[1] * cosine,
  ] as [number, number]);
  const minimumX = Math.min(...rotatedOffsets.map((offset) => offset[0]));
  const maximumX = Math.max(...rotatedOffsets.map((offset) => offset[0]));
  const minimumY = Math.min(...rotatedOffsets.map((offset) => offset[1]));
  const maximumY = Math.max(...rotatedOffsets.map((offset) => offset[1]));
  const margin = 10;
  const availableWidth = Math.max(1, terrain.worldWidth - margin * 2);
  const availableHeight = Math.max(1, terrain.worldHeight - margin * 2);
  const scaledWidth = (maximumX - minimumX) * safeScale;
  const scaledHeight = (maximumY - minimumY) * safeScale;
  const fit = Math.min(
    1,
    scaledWidth > 0 ? availableWidth / scaledWidth : 1,
    scaledHeight > 0 ? availableHeight / scaledHeight : 1,
  );
  const scale = safeScale * fit;
  const lowerAnchorX = margin - minimumX * scale;
  const upperAnchorX = terrain.worldWidth - margin - maximumX * scale;
  const lowerAnchorY = margin - minimumY * scale;
  const upperAnchorY = terrain.worldHeight - margin - maximumY * scale;
  const anchor: [number, number] = [
    Math.max(lowerAnchorX, Math.min(upperAnchorX, requestedAnchor[0])),
    Math.max(lowerAnchorY, Math.min(upperAnchorY, requestedAnchor[1])),
  ];
  const normalizedYaw = (value: number) => (value % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const entities = units.map((unit, index): StateEntity => {
    const x = anchor[0] + rotatedOffsets[index][0] * scale;
    const y = anchor[1] + rotatedOffsets[index][1] * scale;
    const yaw = normalizedYaw(unit.rotation[2] + safeYaw);
    const item = CATALOG.find((candidate) => candidate.token === unit.token && (unit.token !== 'c' || candidate.subtype === unit.subtype));
    const clearance = structureTerrainClearance(
      { token: unit.token, team },
      manifest,
      (item?.footprint ?? 10) * scale,
      unit.groundOffset,
      placementMargin,
    );
    const snap = usesFootprintTerrainSnap(unit.token)
      ? snapStructureToTerrain(terrain, x, y, clearance.footprint, yaw, clearance.groundOffset, clearance.margin)
      : undefined;
    const terrainConformedHeight = snap?.height
      ?? sampleHeight(terrain, x, y) + (Number.isFinite(unit.groundOffset) ? unit.groundOffset : 0);
    return {
      id: createId(`${template.id}-${index + 1}`),
      token: unit.token,
      subtype: unit.subtype,
      team: Math.trunc(team),
      position: [x, y, placementHeightForToken(unit.token, terrainConformedHeight)],
      rotation: [snap?.pitch ?? unit.rotation[0], snap?.roll ?? unit.rotation[1], yaw],
      active: Math.trunc(unit.active),
    };
  });
  return { entities, scale, anchor, skippedWithoutModel };
}

export function catalogFor(entity: StateEntity): CatalogItem | undefined {
  return CATALOG.find((item) => item.token === entity.token && (entity.token !== 'c' || item.subtype === entity.subtype));
}

export function modelNameFor(entity: Pick<StateEntity, 'token' | 'team'>): string | undefined {
  const team = entity.team === 2 ? 2 : 1;
  const models: Record<string, string> = {
    // The archived power-cell meshes are numbered blue=1, red=2.
    e: entity.team === 1 ? 'energy_2' : 'energy_1',
    f: `refuel_${team}`,
    r: `repair_${team}`,
    s: `flak_turret_${team}`,
    g: `gun_turret_${team}`,
    L: `missile_launcher_${team}`,
    p: `skypump_${team}`,
    d: `darklight_${team}`,
    u: team === 2 ? 'uplinkblue' : 'uplinkred',
    h: `spaceship_${team}`,
    c: 'cargo',
  };
  return models[entity.token];
}

/** Resolves the original per-face team tile remap for an extracted material. */
export function materialNameForTeam(
  materialName: string,
  team: number,
  manifest: Pick<AssetManifest, 'materials' | 'materialVariants'>,
): string {
  const variants = manifest.materialVariants?.[materialName];
  if (!variants) return materialName;
  const remapped = team === 1 ? variants.team1 : team === 2 ? variants.team2 : variants.neutral;
  return manifest.materials[remapped] ? remapped : materialName;
}

export function hasModelForEntity(
  entity: Pick<StateEntity, 'token' | 'subtype' | 'team'>,
  manifest: AssetManifest,
): boolean {
  const name = modelNameFor(entity);
  if (!name || !manifest.models[name]) return false;
  if (entity.token !== 'c') return true;
  const cargoTarget: Record<string, string> = {
    e: 'e',
    f: 'f',
    r: 'r',
    h: 'S',
    s: 's',
    g: 'g',
    M: 'E',
    L: 'L',
    p: 'p',
    o: 'o',
    d: 'd',
    b: 'b',
  };
  const targetToken = entity.subtype ? cargoTarget[entity.subtype] : undefined;
  if (!targetToken) return false;
  const deployedName = modelNameFor({ token: targetToken, team: entity.team });
  return Boolean(deployedName && manifest.models[deployedName]);
}

export function catalogItemHasModel(item: CatalogItem, team: number, manifest: AssetManifest): boolean {
  return hasModelForEntity({ token: item.token, subtype: item.subtype, team }, manifest);
}

export function validateProject(project: WulframProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { terrain, entities, validation } = project;
  const editable = entities.filter((entity) => entity.token !== '*');
  const powerServiceRange = Math.max(0, validation.serviceRadius - 10);
  for (const entity of editable) {
    const item = catalogFor(entity);
    const [x, y, z] = entity.position;
    if (x < 0 || y < 0 || x > terrain.worldWidth || y > terrain.worldHeight) {
      issues.push({ entityId: entity.id, severity: 'error', code: 'bounds', message: 'Outside the terrain boundary.' });
      continue;
    }
    const slope = sampleSlopeDegrees(terrain, x, y);
    if (slope > validation.maxSlopeDegrees) {
      issues.push({ entityId: entity.id, severity: 'error', code: 'slope', message: `Slope ${slope.toFixed(1)}° exceeds ${validation.maxSlopeDegrees}°.` });
    }
    const ground = sampleHeight(terrain, x, y);
    if (z < ground - 2) {
      issues.push({ entityId: entity.id, severity: 'warning', code: 'buried', message: `${(ground - z).toFixed(1)} units below the terrain.` });
    }
    const radius = item?.footprint ?? validation.minSpacing;
    const collision = editable.find((other) => {
      if (other.id === entity.id) return false;
      const otherRadius = catalogFor(other)?.footprint ?? validation.minSpacing;
      return Math.hypot(x - other.position[0], y - other.position[1]) < Math.max(validation.minSpacing, (radius + otherRadius) * 0.55);
    });
    if (collision && entity.id.localeCompare(collision.id) < 0) {
      issues.push({ entityId: entity.id, severity: 'error', code: 'overlap', message: `Overlaps ${catalogFor(collision)?.label ?? ENTITY_NAMES[collision.token] ?? 'another unit'}.` });
    }
    if (item?.requiresPower) {
      const powered = editable.some((cell) => cell.token === 'e' && cell.team === entity.team && Math.hypot(x - cell.position[0], y - cell.position[1]) <= powerServiceRange);
      if (!powered) issues.push({ entityId: entity.id, severity: 'error', code: 'power', message: 'Outside power-cell service range.' });
    }
    if (entity.token === 'e') {
      const distances = editable
        .filter((cell) => cell.id !== entity.id && cell.token === 'e' && cell.team === entity.team)
        .map((cell) => Math.hypot(x - cell.position[0], y - cell.position[1]));
      const nearest = distances.length ? Math.min(...distances) : Number.POSITIVE_INFINITY;
      if (nearest <= validation.backupRadius - 10) {
        issues.push({ entityId: entity.id, severity: 'info', code: 'backup', message: 'Valid backup cell for the nearby primary.' });
      } else if (nearest <= 2 * validation.serviceRadius + 10) {
        issues.push({ entityId: entity.id, severity: 'error', code: 'cell-overlap', message: 'Primary cell range overlaps another primary.' });
      }
    }
  }

  for (const team of [1, 2]) {
    const teamEntities = editable.filter((entity) => entity.team === team);
    const stateEntityId = `state-team-${team}`;
    if (!teamEntities.some((entity) => entity.token === 'u')) {
      issues.push({
        entityId: stateEntityId,
        severity: 'error',
        code: 'state-uplink',
        message: `Team ${team} must have an uplink.`,
      });
    }

    const repairPads = teamEntities.filter((entity) => entity.token === 'r');
    const poweredRepairPad = repairPads.some((repairPad) => teamEntities.some((cell) => (
      cell.token === 'e'
      && Math.hypot(repairPad.position[0] - cell.position[0], repairPad.position[1] - cell.position[1]) <= powerServiceRange
    )));
    if (!poweredRepairPad) {
      issues.push({
        entityId: repairPads[0]?.id ?? stateEntityId,
        severity: 'error',
        code: 'state-powered-repair',
        message: `Team ${team} must have at least one powered repair pad.`,
      });
    }
  }
  return issues;
}

export interface BaseLayoutV1 {
  $schema: string;
  format: 'wulfram-base-layout';
  version: 1;
  map: {
    name: string;
    coordinateSystem: 'wulfram-world-xy-z-up';
    worldSize: { x: number; y: number };
  };
  layout: {
    id: string;
    name: string;
    metadata: BaseLayoutMetadata;
  };
  validation: ValidationSettings;
  units: Array<{
    id: string;
    stateToken: string;
    cargoToken?: string;
    type: string;
    team: number;
    position: Vec3;
    rotationRadians: Vec3;
    active: boolean;
  }>;
}

export function toBaseLayout(project: WulframProject): BaseLayoutV1 {
  const canonical = cloneProject(project);
  const layout = activeBaseLayout(canonical);
  return {
    $schema: 'https://raw.githubusercontent.com/blackwatergaming/wulfram-mapeditor/main/public/schemas/wulfram-base-layout-v1.schema.json',
    format: 'wulfram-base-layout',
    version: 1,
    map: {
      name: canonical.name,
      coordinateSystem: 'wulfram-world-xy-z-up',
      worldSize: { x: canonical.terrain.worldWidth, y: canonical.terrain.worldHeight },
    },
    layout: {
      id: layout.id,
      name: layout.name,
      metadata: { ...layout.metadata },
    },
    validation: { ...canonical.validation },
    units: canonical.entities.filter((entity) => entity.token !== '*').map((entity) => ({
      id: entity.id,
      stateToken: entity.token,
      ...(entity.subtype ? { cargoToken: entity.subtype } : {}),
      type: catalogFor(entity)?.key ?? ENTITY_NAMES[entity.token] ?? entity.token,
      team: entity.team,
      position: [...entity.position] as Vec3,
      rotationRadians: [...entity.rotation] as Vec3,
      active: Boolean(entity.active),
    })),
  };
}

export function parseBaseLayout(value: unknown): {
  name?: string;
  entities: StateEntity[];
  validation?: ValidationSettings;
  layout?: Pick<BaseLayoutState, 'id' | 'name' | 'metadata'>;
} {
  if (!value || typeof value !== 'object') throw new Error('JSON layout must be an object.');
  const layout = value as Partial<BaseLayoutV1> & { units?: unknown[] };
  if (layout.format !== 'wulfram-base-layout' || layout.version !== 1 || !Array.isArray(layout.units)) {
    throw new Error('Unsupported JSON layout. Expected wulfram-base-layout version 1.');
  }
  const entities: StateEntity[] = layout.units.map((raw, index) => {
    const unit = raw as Record<string, unknown>;
    const token = typeof unit.stateToken === 'string' ? unit.stateToken : '';
    const position = unit.position as number[];
    const rotation = unit.rotationRadians as number[];
    if (!token || !Array.isArray(position) || position.length !== 3 || !Array.isArray(rotation) || rotation.length !== 3) {
      throw new Error(`Invalid unit at JSON index ${index}.`);
    }
    return {
      id: typeof unit.id === 'string' ? unit.id : createId(token),
      token,
      subtype: typeof unit.cargoToken === 'string' ? unit.cargoToken : undefined,
      team: Number(unit.team) || 0,
      position: position.map(Number) as Vec3,
      rotation: rotation.map(Number) as Vec3,
      active: unit.active === false ? 0 : 1,
    };
  });
  const settings = layout.validation;
  const validation = settings && typeof settings === 'object'
    ? { ...DEFAULT_VALIDATION, ...settings }
    : undefined;
  const rawLayout = layout.layout as Record<string, unknown> | undefined;
  const parsedLayout = rawLayout && typeof rawLayout === 'object'
    && typeof rawLayout.id === 'string' && rawLayout.id.trim()
    && typeof rawLayout.name === 'string' && rawLayout.name.trim()
    ? {
        id: rawLayout.id.trim(),
        name: rawLayout.name.trim(),
        metadata: normalizedLayoutMetadata(rawLayout.metadata),
      }
    : undefined;
  return { name: layout.map?.name, entities, validation, layout: parsedLayout };
}

export function cloneProject(project: WulframProject): WulframProject {
  const clone = JSON.parse(JSON.stringify(project)) as WulframProject;
  const canonical = synchronizeActiveBaseLayout(clone);
  return {
    format: 'wulfram-map-project',
    version: 1,
    name: canonical.name,
    terrain: canonical.terrain,
    entities: canonical.entities,
    validation: canonical.validation,
    baseLayouts: canonical.baseLayouts,
    activeBaseLayoutId: canonical.activeBaseLayoutId,
    updatedAt: canonical.updatedAt,
  };
}
