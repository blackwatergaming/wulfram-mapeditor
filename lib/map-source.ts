import JSZip from 'jszip';
import { isSkyboxName } from './sky-settings.ts';

import {
  DEFAULT_BASE_LAYOUT_ID,
  DEFAULT_VALIDATION,
  cloneProject,
  synchronizeActiveBaseLayout,
  type BaseLayoutMetadata,
  type BaseLayoutState,
  type StateEntity,
  type ValidationSettings,
  type Vec3,
  type WulframProject,
} from './wulfram.ts';

const ARCHIVE_DATE = new Date('2000-01-01T00:00:00.000Z');
const SOURCE_SCHEMA = '../../schemas/wulfram-map-source-v1.schema.json';
const BASE_LAYOUTS_SCHEMA = 'https://raw.githubusercontent.com/blackwatergaming/wulfram-mapeditor/main/public/schemas/wulfram-base-layout-collection-v1.schema.json';

export const MAP_TERRAIN_SOURCE_FILES = [
  'map.json',
  'terrain.tsv',
  'tagmap.txt',
  'tagmap2.txt',
] as const;

export const MAP_BASE_SOURCE_FILES = [
  'entities.jsonl',
  'base-layouts.json',
] as const;

export const MAP_REQUIRED_SOURCE_FILES = [
  'map.json',
  'terrain.tsv',
  'entities.jsonl',
  'tagmap.txt',
  'tagmap2.txt',
] as const;

export const MAP_SOURCE_FILES = [
  'map.json',
  'terrain.tsv',
  'entities.jsonl',
  'tagmap.txt',
  'tagmap2.txt',
  'base-layouts.json',
] as const;

export type MapSourceFileName = (typeof MAP_SOURCE_FILES)[number];
export type MapSourceFiles = Partial<Record<MapSourceFileName, string>>
  & Record<(typeof MAP_REQUIRED_SOURCE_FILES)[number], string>;
export type CompleteMapSourceFiles = Record<MapSourceFileName, string>;

export interface MapSourceManifest {
  $schema: string;
  format: 'wulfram-map-source';
  version: 1;
  name: string;
  terrain: {
    width: number;
    height: number;
    worldWidth: number;
    worldHeight: number;
    skyName?: string;
  };
  validation: ValidationSettings;
  updatedAt: string;
}

export interface MapSourceArchive {
  root: string;
  files: MapSourceFiles;
  project: WulframProject;
}

export interface BaseLayoutCollectionV1 {
  $schema: string;
  format: 'wulfram-base-layout-collection';
  version: 1;
  activeLayoutId: string;
  layouts: BaseLayoutState[];
}

function assertRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object.`);
  }
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${context} must be a finite number.`);
  return value;
}

function integer(value: unknown, context: string, minimum?: number): number {
  const number = finiteNumber(value, context);
  if (
    !Number.isInteger(number) ||
    (minimum !== undefined && number < minimum)
  ) {
    throw new Error(
      `${context} must be an integer${minimum === undefined ? '' : ` of at least ${minimum}`}.`,
    );
  }
  return number;
}

function text(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new Error(`${context} must be text.`);
  return value;
}

function vector(value: unknown, context: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3)
    throw new Error(`${context} must contain exactly three numbers.`);
  return value.map((entry, index) =>
    finiteNumber(entry, `${context}[${index}]`),
  ) as Vec3;
}

function validationSettings(value: unknown): ValidationSettings {
  assertRecord(value, 'map.json validation');
  return {
    serviceRadius: finiteNumber(
      value.serviceRadius,
      'validation.serviceRadius',
    ),
    backupRadius: finiteNumber(value.backupRadius, 'validation.backupRadius'),
    maxSlopeDegrees: finiteNumber(
      value.maxSlopeDegrees,
      'validation.maxSlopeDegrees',
    ),
    minSpacing: finiteNumber(value.minSpacing, 'validation.minSpacing'),
  };
}

function sourceNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}

function sourceLines(lines: string[]): string {
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function parseSourceLines(value: string): string[] {
  const lines = value.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

function sourceEntity(entity: StateEntity): StateEntity {
  return {
    id: entity.id,
    token: entity.token,
    ...(entity.subtype === undefined ? {} : { subtype: entity.subtype }),
    team: Math.trunc(entity.team),
    position: entity.position.map((value) => Number(sourceNumber(value))) as Vec3,
    rotation: entity.rotation.map((value) => Number(sourceNumber(value))) as Vec3,
    active: Math.trunc(entity.active),
    ...(entity.raw === undefined ? {} : { raw: entity.raw }),
  };
}

function parseSourceEntity(value: unknown, context: string): StateEntity {
  assertRecord(value, context);
  const token = text(value.token, `${context} token`);
  if (!token.length) throw new Error(`${context} token cannot be empty.`);
  const subtype =
    value.subtype === undefined
      ? undefined
      : text(value.subtype, `${context} subtype`);
  const raw =
    value.raw === undefined ? undefined : text(value.raw, `${context} raw`);
  return {
    id: text(value.id, `${context} id`),
    token,
    ...(subtype === undefined ? {} : { subtype }),
    team: integer(value.team, `${context} team`),
    position: vector(value.position, `${context} position`),
    rotation: vector(value.rotation, `${context} rotation`),
    active: integer(value.active, `${context} active`),
    ...(raw === undefined ? {} : { raw }),
  };
}

function sourceMetadata(metadata: BaseLayoutMetadata): BaseLayoutMetadata {
  return Object.fromEntries(
    Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function parseMetadata(value: unknown, context: string): BaseLayoutMetadata {
  assertRecord(value, context);
  const metadata: BaseLayoutMetadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.length) throw new Error(`${context} keys cannot be empty.`);
    metadata[key] = text(entry, `${context}.${key}`);
  }
  return sourceMetadata(metadata);
}

function validateEntityIds(entities: StateEntity[], context: string): void {
  const ids = new Set<string>();
  for (const [index, entity] of entities.entries()) {
    if (!entity.id.length || ids.has(entity.id)) {
      throw new Error(`${context} entity ${index + 1} has an empty or duplicate id.`);
    }
    ids.add(entity.id);
  }
}

export function createBaseLayoutCollection(project: WulframProject): BaseLayoutCollectionV1 {
  const canonical = cloneProject(project);
  synchronizeActiveBaseLayout(canonical);
  return {
    $schema: BASE_LAYOUTS_SCHEMA,
    format: 'wulfram-base-layout-collection',
    version: 1,
    activeLayoutId: canonical.activeBaseLayoutId,
    layouts: canonical.baseLayouts.map((layout) => ({
      id: layout.id,
      name: layout.name,
      metadata: sourceMetadata(layout.metadata),
      entities: layout.entities.map(sourceEntity),
      validation: { ...layout.validation },
      updatedAt: layout.updatedAt,
    })),
  };
}

export function serializeBaseLayoutCollection(project: WulframProject): string {
  return `${JSON.stringify(createBaseLayoutCollection(project), null, 2)}\n`;
}

export function parseBaseLayoutCollection(textValue: string): {
  activeLayoutId: string;
  layouts: BaseLayoutState[];
} {
  let value: unknown;
  try {
    value = JSON.parse(textValue);
  } catch (error) {
    throw new Error(`base-layouts.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertRecord(value, 'base-layouts.json');
  if (value.format !== 'wulfram-base-layout-collection' || value.version !== 1) {
    throw new Error('Unsupported base layout collection. Expected wulfram-base-layout-collection v1.');
  }
  if (!Array.isArray(value.layouts) || value.layouts.length === 0) {
    throw new Error('base-layouts.json must contain at least one layout.');
  }
  const seenIds = new Set<string>();
  const layouts = value.layouts.map((entry, layoutIndex): BaseLayoutState => {
    const context = `base-layouts.json layout ${layoutIndex + 1}`;
    assertRecord(entry, context);
    const id = text(entry.id, `${context} id`).trim();
    const name = text(entry.name, `${context} name`).trim();
    if (!id || seenIds.has(id)) throw new Error(`${context} has an empty or duplicate id.`);
    if (!name) throw new Error(`${context} name cannot be empty.`);
    seenIds.add(id);
    if (!Array.isArray(entry.entities)) throw new Error(`${context} entities must be an array.`);
    const entities = entry.entities.map((entity, entityIndex) =>
      parseSourceEntity(entity, `${context} entity ${entityIndex + 1}`),
    );
    validateEntityIds(entities, context);
    const updatedAt = text(entry.updatedAt, `${context} updatedAt`);
    if (Number.isNaN(Date.parse(updatedAt))) throw new Error(`${context} updatedAt must be an ISO-compatible date string.`);
    return {
      id,
      name,
      metadata: parseMetadata(entry.metadata ?? {}, `${context} metadata`),
      entities,
      validation: entry.validation === undefined
        ? { ...DEFAULT_VALIDATION }
        : validationSettings(entry.validation),
      updatedAt,
    };
  });
  const activeLayoutId = text(value.activeLayoutId, 'base-layouts.json activeLayoutId');
  if (!seenIds.has(activeLayoutId)) throw new Error('base-layouts.json activeLayoutId does not identify a layout.');
  return { activeLayoutId, layouts };
}

export function createMapSourceFiles(project: WulframProject): CompleteMapSourceFiles {
  const canonical = cloneProject(project);
  const expectedVertices = canonical.terrain.width * canonical.terrain.height;
  if (
    canonical.terrain.heights.length !== expectedVertices ||
    canonical.terrain.textureIds.length !== expectedVertices
  ) {
    throw new Error(
      `Terrain arrays must each contain ${expectedVertices} vertices.`,
    );
  }

  const manifest: MapSourceManifest = {
    $schema: SOURCE_SCHEMA,
    format: 'wulfram-map-source',
    version: 1,
    name: canonical.name,
    terrain: {
      width: canonical.terrain.width,
      height: canonical.terrain.height,
      worldWidth: canonical.terrain.worldWidth,
      worldHeight: canonical.terrain.worldHeight,
      ...(canonical.terrain.skyName === undefined ? {} : { skyName: canonical.terrain.skyName }),
    },
    validation: { ...canonical.validation },
    updatedAt: canonical.updatedAt,
  };
  const terrainRows = ['x\ty\ttexture\theight'];
  for (let y = 0; y < canonical.terrain.height; y += 1) {
    for (let x = 0; x < canonical.terrain.width; x += 1) {
      const index = y * canonical.terrain.width + x;
      terrainRows.push(
        `${x}\t${y}\t${Math.max(0, Math.trunc(canonical.terrain.textureIds[index] ?? 0))}\t${sourceNumber(canonical.terrain.heights[index] ?? 0)}`,
      );
    }
  }

  return {
    'map.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'terrain.tsv': `${terrainRows.join('\n')}\n`,
    'entities.jsonl': sourceLines(
      canonical.entities.map((entity) => JSON.stringify(sourceEntity(entity))),
    ),
    'tagmap.txt': sourceLines(canonical.terrain.tagmap),
    'tagmap2.txt': sourceLines(canonical.terrain.tagmap2),
    'base-layouts.json': serializeBaseLayoutCollection(canonical),
  };
}

export function parseMapSourceFiles(
  files: Partial<Record<MapSourceFileName, string>>,
): WulframProject {
  for (const fileName of MAP_REQUIRED_SOURCE_FILES) {
    if (typeof files[fileName] !== 'string')
      throw new Error(`Map source is missing ${fileName}.`);
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(files['map.json']!);
  } catch (error) {
    throw new Error(
      `map.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertRecord(rawManifest, 'map.json');
  if (
    rawManifest.format !== 'wulfram-map-source' ||
    rawManifest.version !== 1
  ) {
    throw new Error(
      'Unsupported map source format. Expected wulfram-map-source v1.',
    );
  }
  assertRecord(rawManifest.terrain, 'map.json terrain');
  if (rawManifest.terrain.skyName !== undefined && !isSkyboxName(rawManifest.terrain.skyName)) {
    throw new Error('terrain.skyName must name an available Wulfram skybox.');
  }
  const width = integer(rawManifest.terrain.width, 'terrain.width', 2);
  const height = integer(rawManifest.terrain.height, 'terrain.height', 2);
  const worldWidth = finiteNumber(
    rawManifest.terrain.worldWidth,
    'terrain.worldWidth',
  );
  const worldHeight = finiteNumber(
    rawManifest.terrain.worldHeight,
    'terrain.worldHeight',
  );
  if (worldWidth <= 0 || worldHeight <= 0)
    throw new Error('Terrain world dimensions must be positive.');

  const terrainLines = parseSourceLines(files['terrain.tsv']!);
  if (
    terrainLines.shift()?.replace(/^\uFEFF/, '') !== 'x\ty\ttexture\theight'
  ) {
    throw new Error(
      'terrain.tsv must begin with the x, y, texture, and height header.',
    );
  }
  const expectedVertices = width * height;
  if (terrainLines.length !== expectedVertices) {
    throw new Error(
      `terrain.tsv has ${terrainLines.length} vertices; ${expectedVertices} are required.`,
    );
  }
  const textureIds: number[] = [];
  const heights: number[] = [];
  for (let index = 0; index < terrainLines.length; index += 1) {
    const values = terrainLines[index].split('\t');
    if (values.length !== 4)
      throw new Error(
        `terrain.tsv line ${index + 2} must contain four tab-separated values.`,
      );
    const expectedX = index % width;
    const expectedY = Math.floor(index / width);
    const x = Number(values[0]);
    const y = Number(values[1]);
    if (x !== expectedX || y !== expectedY) {
      throw new Error(
        `terrain.tsv line ${index + 2} is out of order; expected coordinate ${expectedX},${expectedY}.`,
      );
    }
    const texture = Number(values[2]);
    const elevation = Number(values[3]);
    textureIds.push(
      integer(texture, `terrain.tsv line ${index + 2} texture`, 0),
    );
    heights.push(
      finiteNumber(elevation, `terrain.tsv line ${index + 2} height`),
    );
  }

  const entities: StateEntity[] = [];
  const ids = new Set<string>();
  for (const [index, line] of parseSourceLines(
    files['entities.jsonl']!,
  ).entries()) {
    if (!line.trim())
      throw new Error(`entities.jsonl line ${index + 1} is empty.`);
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `entities.jsonl line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const entity = parseSourceEntity(value, `entities.jsonl line ${index + 1}`);
    if (!entity.id.length || ids.has(entity.id))
      throw new Error(
        `entities.jsonl line ${index + 1} has an empty or duplicate id.`,
      );
    ids.add(entity.id);
    entities.push(entity);
  }

  const updatedAt = text(rawManifest.updatedAt, 'updatedAt');
  if (Number.isNaN(Date.parse(updatedAt)))
    throw new Error('updatedAt must be an ISO-compatible date string.');
  const fallbackValidation = rawManifest.validation === undefined
    ? { ...DEFAULT_VALIDATION }
    : validationSettings(rawManifest.validation);
  const collection = typeof files['base-layouts.json'] === 'string'
    ? parseBaseLayoutCollection(files['base-layouts.json'])
    : undefined;
  const activeLayout = collection?.layouts.find(
    (layout) => layout.id === collection.activeLayoutId,
  );
  const project: WulframProject = {
    format: 'wulfram-map-project',
    version: 1,
    name: text(rawManifest.name, 'name'),
    terrain: {
      width,
      height,
      worldWidth,
      worldHeight,
      ...(rawManifest.terrain.skyName === undefined ? {} : { skyName: rawManifest.terrain.skyName }),
      textureIds,
      heights,
      tagmap: parseSourceLines(files['tagmap.txt']!),
      tagmap2: parseSourceLines(files['tagmap2.txt']!),
    },
    entities: activeLayout ? activeLayout.entities : entities,
    validation: activeLayout ? activeLayout.validation : fallbackValidation,
    baseLayouts: collection?.layouts ?? [{
      id: DEFAULT_BASE_LAYOUT_ID,
      name: 'Default',
      metadata: {},
      entities,
      validation: fallbackValidation,
      updatedAt,
    }],
    activeBaseLayoutId: collection?.activeLayoutId ?? DEFAULT_BASE_LAYOUT_ID,
    updatedAt,
  };
  return synchronizeActiveBaseLayout(project);
}

export async function createMapSourceArchive(
  project: WulframProject,
  root: string,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const files = createMapSourceFiles(project);
  for (const fileName of MAP_SOURCE_FILES) {
    zip.file(`${root}/${fileName}`, files[fileName], {
      createFolders: false,
      date: ARCHIVE_DATE,
      unixPermissions: 0o644,
    });
  }
  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}

export async function readMapSourceArchive(
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<MapSourceArchive | undefined> {
  const zip = await JSZip.loadAsync(data);
  const candidates = Object.keys(zip.files)
    .filter(
      (name) =>
        !zip.files[name].dir && name.replace(/\\/g, '/').endsWith('/map.json'),
    )
    .sort();
  for (const manifestPath of candidates) {
    const root = manifestPath.replace(/\\/g, '/').slice(0, -'/map.json'.length);
    const files: Partial<Record<MapSourceFileName, string>> = {};
    let complete = true;
    for (const fileName of MAP_REQUIRED_SOURCE_FILES) {
      const entry = zip.file(`${root}/${fileName}`);
      if (!entry) {
        complete = false;
        break;
      }
      files[fileName] = await entry.async('text');
    }
    if (complete) {
      const layouts = zip.file(`${root}/base-layouts.json`);
      if (layouts) files['base-layouts.json'] = await layouts.async('text');
      return {
        root,
        files: files as MapSourceFiles,
        project: parseMapSourceFiles(files),
      };
    }
  }
  return undefined;
}
