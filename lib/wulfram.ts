export type Vec3 = [number, number, number];

export interface TerrainData {
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
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

export interface WulframProject {
  format: 'wulfram-map-project';
  version: 1;
  name: string;
  terrain: TerrainData;
  entities: StateEntity[];
  validation: ValidationSettings;
  updatedAt: string;
}

export interface TextureAsset {
  url: string;
  width: number;
  height: number;
  average: string;
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
  materials: Record<string, TextureAsset>;
  models: Record<string, ModelAsset>;
  demo: { name: string; baseUrl: string; files: string[] };
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

export function createId(prefix = 'unit'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function createBlankProject(name = 'Untitled map', size = 129): WulframProject {
  const count = size * size;
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
      tagmap: ['0:10martian001'],
      tagmap2: ['10martian001'],
    },
    entities: [],
    validation: { ...DEFAULT_VALIDATION },
    updatedAt: new Date().toISOString(),
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
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === '*') {
      entities.push({ id: createId('decoration'), token: '*', team: 0, position: [0, 0, 0], rotation: [0, 0, 0], active: 1, raw: line });
      continue;
    }
    const cargo = parts[0] === 'c';
    const numeric = cargo ? parts.slice(2) : parts.slice(1);
    if (numeric.length < 8) continue;
    const values = numeric.map(Number);
    if (values.some((value) => !Number.isFinite(value))) continue;
    entities.push({
      id: createId(parts[0]),
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

export function catalogFor(entity: StateEntity): CatalogItem | undefined {
  return CATALOG.find((item) => item.token === entity.token && (entity.token !== 'c' || item.subtype === entity.subtype));
}

export function modelNameFor(entity: StateEntity): string | undefined {
  const team = entity.team === 2 ? 2 : 1;
  const models: Record<string, string> = {
    e: `energy_${team}`,
    f: `refuel_${team}`,
    r: `repair_${team}`,
    s: `flak_turret_${team}`,
    g: `gun_turret_${team}`,
    L: `missile_launcher_${team}`,
    p: `skypump_${team}`,
    d: `darklight_${team}`,
    u: team === 2 ? 'uplinkblue' : 'uplinkred',
    c: 'cargo',
  };
  return models[entity.token];
}

export function validateProject(project: WulframProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { terrain, entities, validation } = project;
  const editable = entities.filter((entity) => entity.token !== '*');
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
      const powered = editable.some((cell) => cell.token === 'e' && cell.team === entity.team && Math.hypot(x - cell.position[0], y - cell.position[1]) <= validation.serviceRadius - 10);
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
  return {
    $schema: 'https://raw.githubusercontent.com/blackwatergaming/wulfram-mapeditor/main/public/schemas/wulfram-base-layout-v1.schema.json',
    format: 'wulfram-base-layout',
    version: 1,
    map: {
      name: project.name,
      coordinateSystem: 'wulfram-world-xy-z-up',
      worldSize: { x: project.terrain.worldWidth, y: project.terrain.worldHeight },
    },
    validation: { ...project.validation },
    units: project.entities.filter((entity) => entity.token !== '*').map((entity) => ({
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

export function parseBaseLayout(value: unknown): { name?: string; entities: StateEntity[]; validation?: ValidationSettings } {
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
  return { name: layout.map?.name, entities, validation };
}

export function cloneProject(project: WulframProject): WulframProject {
  return JSON.parse(JSON.stringify(project)) as WulframProject;
}
