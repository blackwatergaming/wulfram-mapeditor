import JSZip from 'jszip';

import {
  cloneProject,
  serializeLand,
  serializeLines,
  serializeState,
  toBaseLayout,
  type WulframProject,
} from './wulfram.ts';
import { serializeBaseLayoutCollection } from './map-source.ts';
import { resolveSkyboxName } from './sky-settings.ts';

const ARCHIVE_DATE = new Date('2000-01-01T00:00:00.000Z');

export const MAP_ARCHIVE_FILES = [
  'land',
  'state',
  'tagmap',
  'tagmap2',
  'start_script',
  'base-layout.json',
  'base-layouts.json',
  'wulfram-project.json',
] as const;

export interface MapArchiveEntry {
  name: string;
  text: string;
}

export function safeMapName(name: string): string {
  return name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'wulfram-map';
}

export function createMapArchiveFiles(project: WulframProject): Record<(typeof MAP_ARCHIVE_FILES)[number], string> {
  const canonical = cloneProject(project);
  return {
    land: serializeLand(canonical.terrain),
    state: serializeState(canonical.entities),
    tagmap: serializeLines(canonical.terrain.tagmap),
    tagmap2: serializeLines(canonical.terrain.tagmap2),
    start_script: `sky_names "${resolveSkyboxName(canonical.terrain.skyName)}"\nmap_name "${canonical.name.replace(/[\\"\r\n]/g, ' ')}"\n`,
    'base-layout.json': `${JSON.stringify(toBaseLayout(canonical), null, 2)}\n`,
    'base-layouts.json': serializeBaseLayoutCollection(canonical),
    'wulfram-project.json': `${JSON.stringify(canonical)}\n`,
  };
}

export async function createMapArchive(project: WulframProject): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const root = safeMapName(project.name);
  const files = createMapArchiveFiles(project);
  for (const fileName of MAP_ARCHIVE_FILES) {
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

export async function readMapArchive(data: Blob | ArrayBuffer | Uint8Array): Promise<MapArchiveEntry[]> {
  const zip = await JSZip.loadAsync(data);
  const entries: MapArchiveEntry[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const base = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
    if (MAP_ARCHIVE_FILES.includes(base as (typeof MAP_ARCHIVE_FILES)[number]) || /\.(land|state|tagmap2?|json)$/i.test(base)) {
      entries.push({ name, text: await entry.async('text') });
    }
  }
  return entries;
}
