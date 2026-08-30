'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  CircleDot,
  Download,
  FileJson,
  FolderOpen,
  Grid3X3,
  Image as ImageIcon,
  Layers3,
  Mountain,
  Paintbrush,
  Pickaxe,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TerrainViewport, type EditorMode, type StrokePhase, type TerrainTool } from '@/components/editor/terrain-viewport';
import {
  CATALOG,
  DEFAULT_VALIDATION,
  ENTITY_NAMES,
  catalogFor,
  cloneProject,
  createBlankProject,
  createId,
  ensureTextureTag,
  parseBaseLayout,
  parseLand,
  parseLines,
  parseState,
  sampleHeight,
  sampleSlopeDegrees,
  serializeLand,
  serializeLines,
  serializeState,
  toBaseLayout,
  validateProject,
  type AssetManifest,
  type StateEntity,
  type Vec3,
  type WulframProject,
} from '@/lib/wulfram';

interface MapAnalysis {
  turretDefaults: Record<string, {
    heightOffset: number;
    pitch: number;
    roll: number;
    yawCircularMean: number;
    sampleCount: number;
  }>;
  powerCell: {
    serviceRadius: number;
    backupRadius: number;
  };
}

interface Notice {
  tone: 'ready' | 'working' | 'error';
  text: string;
}

const STORAGE_KEY = 'wulfram-forge-project-v1';
const MAX_HISTORY = 32;

function safeMapName(name: string): string {
  return name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'wulfram-map';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        step={step}
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
      />
    </label>
  );
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = '',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="range-field">
      <span><b>{label}</b><output>{Math.round(value * 100) / 100}{suffix}</output></span>
      <input aria-label={label} max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} step={step} type="range" value={value} />
    </label>
  );
}

export function EditorApp() {
  const [manifest, setManifest] = useState<AssetManifest>();
  const [analysis, setAnalysis] = useState<MapAnalysis>();
  const [project, setProject] = useState<WulframProject>();
  const [mode, setMode] = useState<EditorMode>('terrain');
  const [terrainTool, setTerrainTool] = useState<TerrainTool>('sculpt');
  const [brushRadius, setBrushRadius] = useState(165);
  const [brushStrength, setBrushStrength] = useState(32);
  const [selectedTexture, setSelectedTexture] = useState('canyon003');
  const [textureSearch, setTextureSearch] = useState('');
  const [texturePage, setTexturePage] = useState(0);
  const [team, setTeam] = useState(1);
  const [selectedPlacementKey, setSelectedPlacementKey] = useState('power');
  const [selectedEntityId, setSelectedEntityId] = useState<string>();
  const [showGrid, setShowGrid] = useState(true);
  const [cursor, setCursor] = useState<Vec3>();
  const [heightmapRange, setHeightmapRange] = useState<[number, number]>([0, 420]);
  const [undoStack, setUndoStack] = useState<WulframProject[]>([]);
  const [redoStack, setRedoStack] = useState<WulframProject[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>({ tone: 'working', text: 'Loading original Wulfram assets…' });
  const importRef = useRef<HTMLInputElement>(null);
  const heightmapRef = useRef<HTMLInputElement>(null);
  const strokeSnapshotRef = useRef<WulframProject | null>(null);
  const levelHeightRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [assetsResponse, analysisResponse] = await Promise.all([
          fetch('/assets/manifest.json'),
          fetch('/assets/map-analysis.json'),
        ]);
        if (!assetsResponse.ok || !analysisResponse.ok) throw new Error('The extracted asset manifest is unavailable.');
        const assets = await assetsResponse.json() as AssetManifest;
        const mapAnalysis = await analysisResponse.json() as MapAnalysis;
        if (cancelled) return;
        setManifest(assets);
        setAnalysis(mapAnalysis);
        if (assets.terrainTextures.canyon003 === undefined) {
          setSelectedTexture(Object.keys(assets.terrainTextures)[0] ?? '10martian001');
        }

        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const restored = JSON.parse(stored) as WulframProject;
            if (restored.format === 'wulfram-map-project' && restored.version === 1) {
              setProject(restored);
              setNotice({ tone: 'ready', text: 'Restored the latest local project' });
              return;
            }
          } catch {
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }

        const base = assets.demo.baseUrl;
        const [land, state, tagmap, tagmap2] = await Promise.all([
          fetch(`${base}/land`).then((response) => response.text()),
          fetch(`${base}/state`).then((response) => response.text()),
          fetch(`${base}/tagmap`).then((response) => response.text()),
          fetch(`${base}/tagmap2`).then((response) => response.text()),
        ]);
        const terrain = parseLand(land);
        terrain.tagmap = parseLines(tagmap);
        terrain.tagmap2 = parseLines(tagmap2);
        const demo: WulframProject = {
          format: 'wulfram-map-project',
          version: 1,
          name: assets.demo.name,
          terrain,
          entities: parseState(state),
          validation: {
            ...DEFAULT_VALIDATION,
            serviceRadius: mapAnalysis.powerCell.serviceRadius,
            backupRadius: mapAnalysis.powerCell.backupRadius,
          },
          updatedAt: new Date().toISOString(),
        };
        if (!cancelled) {
          setProject(demo);
          setNotice({ tone: 'ready', text: 'Crossroads loaded from the original map files' });
        }
      } catch (error) {
        if (!cancelled) setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Editor initialization failed.' });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!project) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      } catch {
        setNotice({ tone: 'error', text: 'Local autosave is full; export a ZIP backup.' });
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [project]);

  const pushHistory = useCallback((snapshot: WulframProject) => {
    setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), snapshot]);
    setRedoStack([]);
  }, []);

  const mutate = useCallback((change: (draft: WulframProject) => void, record = true) => {
    setProject((current) => {
      if (!current) return current;
      if (record) pushHistory(cloneProject(current));
      const next = cloneProject(current);
      change(next);
      next.updatedAt = new Date().toISOString();
      return next;
    });
    setDirty(true);
  }, [pushHistory]);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const previous = stack[stack.length - 1];
      if (!previous) return stack;
      setProject((current) => {
        if (current) setRedoStack((redo) => [...redo.slice(-(MAX_HISTORY - 1)), cloneProject(current)]);
        return cloneProject(previous);
      });
      setDirty(true);
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setProject((current) => {
        if (current) setUndoStack((undoHistory) => [...undoHistory.slice(-(MAX_HISTORY - 1)), cloneProject(current)]);
        return cloneProject(next);
      });
      setDirty(true);
      return stack.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (project) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
          setDirty(false);
          setNotice({ tone: 'ready', text: 'Saved locally' });
        }
      } else if (event.key === 'Delete' && selectedEntityId) {
        mutate((draft) => { draft.entities = draft.entities.filter((entity) => entity.id !== selectedEntityId); });
        setSelectedEntityId(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mutate, project, redo, selectedEntityId, undo]);

  const issues = useMemo(() => project ? validateProject(project) : [], [project]);
  const selectedEntity = useMemo(
    () => project?.entities.find((entity) => entity.id === selectedEntityId),
    [project, selectedEntityId],
  );
  const selectedIssues = useMemo(
    () => issues.filter((issue) => issue.entityId === selectedEntityId),
    [issues, selectedEntityId],
  );

  const textureNames = useMemo(() => {
    if (!manifest) return [];
    const query = textureSearch.trim().toLowerCase();
    return Object.keys(manifest.terrainTextures)
      .filter((name) => !query || name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [manifest, textureSearch]);
  const texturePageCount = Math.max(1, Math.ceil(textureNames.length / 18));
  const activeTexturePage = Math.min(texturePage, texturePageCount - 1);
  const visibleTextures = textureNames.slice(activeTexturePage * 18, activeTexturePage * 18 + 18);

  const applyBrush = useCallback((worldX: number, worldY: number) => {
    if (!project || !manifest) return;
    mutate((draft) => {
      const terrain = draft.terrain;
      const sourceHeights = terrainTool === 'smooth' ? [...terrain.heights] : terrain.heights;
      const cellX = terrain.worldWidth / Math.max(1, terrain.width - 1);
      const cellY = terrain.worldHeight / Math.max(1, terrain.height - 1);
      const minX = Math.max(0, Math.floor((worldX - brushRadius) / cellX));
      const maxX = Math.min(terrain.width - 1, Math.ceil((worldX + brushRadius) / cellX));
      const minY = Math.max(0, Math.floor((worldY - brushRadius) / cellY));
      const maxY = Math.min(terrain.height - 1, Math.ceil((worldY + brushRadius) / cellY));
      const textureId = terrainTool === 'paint' ? ensureTextureTag(terrain, selectedTexture) : -1;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x / (terrain.width - 1) * terrain.worldWidth;
          const py = y / (terrain.height - 1) * terrain.worldHeight;
          const distance = Math.hypot(px - worldX, py - worldY);
          if (distance > brushRadius) continue;
          const index = y * terrain.width + x;
          const falloff = Math.pow(1 - distance / Math.max(1, brushRadius), 1.65);
          if (terrainTool === 'paint') {
            if (falloff > 0.2) terrain.textureIds[index] = textureId;
          } else if (terrainTool === 'sculpt' || terrainTool === 'lower') {
            const direction = terrainTool === 'lower' ? -1 : 1;
            terrain.heights[index] += direction * brushStrength / 100 * 7 * falloff;
          } else if (terrainTool === 'level') {
            const mix = Math.min(1, brushStrength / 100 * 0.34 * falloff);
            terrain.heights[index] += (levelHeightRef.current - terrain.heights[index]) * mix;
          } else if (terrainTool === 'smooth') {
            let total = 0;
            let count = 0;
            for (let oy = -1; oy <= 1; oy += 1) {
              for (let ox = -1; ox <= 1; ox += 1) {
                const sx = Math.max(0, Math.min(terrain.width - 1, x + ox));
                const sy = Math.max(0, Math.min(terrain.height - 1, y + oy));
                total += sourceHeights[sy * terrain.width + sx];
                count += 1;
              }
            }
            const mix = Math.min(1, brushStrength / 100 * 0.3 * falloff);
            terrain.heights[index] += (total / count - terrain.heights[index]) * mix;
          }
        }
      }
    }, false);
  }, [brushRadius, brushStrength, manifest, mutate, project, selectedTexture, terrainTool]);

  const onTerrainStroke = useCallback((x: number, y: number, phase: StrokePhase) => {
    if (!project) return;
    if (phase === 'start') {
      strokeSnapshotRef.current = cloneProject(project);
      levelHeightRef.current = sampleHeight(project.terrain, x, y);
      applyBrush(x, y);
    } else if (phase === 'move') {
      applyBrush(x, y);
    } else if (strokeSnapshotRef.current) {
      pushHistory(strokeSnapshotRef.current);
      strokeSnapshotRef.current = null;
      setDirty(true);
    }
  }, [applyBrush, project, pushHistory]);

  const placeUnit = useCallback((x: number, y: number) => {
    if (!project) return;
    const item = CATALOG.find((entry) => entry.key === selectedPlacementKey);
    if (!item) return;
    const defaultData = analysis?.turretDefaults[item.token];
    const ground = sampleHeight(project.terrain, x, y);
    const offset = defaultData?.heightOffset ?? 0;
    const entity: StateEntity = {
      id: createId(item.key),
      token: item.token,
      subtype: item.subtype,
      team,
      position: [x, y, ground + offset],
      rotation: [defaultData?.pitch ?? 0, defaultData?.roll ?? 0, defaultData?.yawCircularMean ?? 0],
      active: 1,
    };
    mutate((draft) => { draft.entities.push(entity); });
    setSelectedEntityId(entity.id);
    setNotice({ tone: 'ready', text: `${item.label} placed at ${x.toFixed(1)}, ${y.toFixed(1)}` });
  }, [analysis, mutate, project, selectedPlacementKey, team]);

  const updateSelected = useCallback((change: (entity: StateEntity) => void, record = true) => {
    if (!selectedEntityId) return;
    mutate((draft) => {
      const entity = draft.entities.find((item) => item.id === selectedEntityId);
      if (entity) change(entity);
    }, record);
  }, [mutate, selectedEntityId]);

  const importHeightmap = useCallback(async (file: File) => {
    if (!project) return;
    try {
      setNotice({ tone: 'working', text: `Reading grayscale heightmap ${file.name}…` });
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = project.terrain.width;
      canvas.height = project.terrain.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas image decoding is unavailable.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const [minimum, maximum] = heightmapRange;
      const heights: number[] = [];
      for (let index = 0; index < pixels.length; index += 4) {
        const luminance = (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255;
        heights.push(minimum + luminance * (maximum - minimum));
      }
      bitmap.close();
      mutate((draft) => { draft.terrain.heights = heights; });
      setMode('terrain');
      setTerrainTool('sculpt');
      setNotice({ tone: 'ready', text: `Heightmap applied at ${minimum}–${maximum} world units` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Heightmap import failed.' });
    }
  }, [heightmapRange, mutate, project]);

  const importFiles = async (files: File[]) => {
    if (!files.length || !project) return;
    try {
      setNotice({ tone: 'working', text: `Importing ${files.length === 1 ? files[0].name : `${files.length} map files`}…` });
      if (files.length === 1 && files[0].type.startsWith('image/')) {
        await importHeightmap(files[0]);
        return;
      }
      let landText: string | undefined;
      let stateText: string | undefined;
      let tagmapText: string | undefined;
      let tagmap2Text: string | undefined;
      let jsonValue: unknown;
      let importedName: string | undefined;

      const consume = async (name: string, text: string) => {
        const base = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? name.toLowerCase();
        if (base === 'land' || base.endsWith('.land')) landText = text;
        else if (base === 'state' || /^state\d*$/.test(base) || base.endsWith('.state')) stateText = text;
        else if (base === 'tagmap2' || base.endsWith('.tagmap2')) tagmap2Text = text;
        else if (base === 'tagmap' || base.endsWith('.tagmap')) tagmapText = text;
        else if (base.endsWith('.json')) jsonValue = JSON.parse(text);
        else if (/^\d+x\d+\s*[\r\n]+[\d.]+x[\d.]+/i.test(text.trim())) landText = text;
      };

      for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
          const zip = await JSZip.loadAsync(file);
          importedName = file.name.replace(/\.zip$/i, '');
          for (const [name, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            const base = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
            if (['land', 'state', 'tagmap', 'tagmap2', 'base-layout.json'].includes(base) || /\.(land|state|tagmap2?|json)$/i.test(base)) {
              await consume(name, await entry.async('text'));
            }
          }
        } else {
          await consume(file.name, await file.text());
          if (!importedName && !['land', 'state', 'tagmap', 'tagmap2'].includes(file.name.toLowerCase())) {
            importedName = file.name.replace(/\.[^.]+$/, '');
          }
        }
      }

      if (jsonValue && typeof jsonValue === 'object' && (jsonValue as WulframProject).format === 'wulfram-map-project') {
        const restored = jsonValue as WulframProject;
        pushHistory(cloneProject(project));
        setProject(restored);
        setDirty(true);
        setNotice({ tone: 'ready', text: `Project ${restored.name} imported` });
        return;
      }

      mutate((draft) => {
        if (landText) {
          const imported = parseLand(landText);
          imported.tagmap = tagmapText ? parseLines(tagmapText) : draft.terrain.tagmap;
          imported.tagmap2 = tagmap2Text ? parseLines(tagmap2Text) : draft.terrain.tagmap2;
          draft.terrain = imported;
        } else {
          if (tagmapText) draft.terrain.tagmap = parseLines(tagmapText);
          if (tagmap2Text) draft.terrain.tagmap2 = parseLines(tagmap2Text);
        }
        if (stateText) draft.entities = parseState(stateText);
        if (jsonValue) {
          const layout = parseBaseLayout(jsonValue);
          draft.entities = layout.entities;
          if (layout.name) draft.name = layout.name;
          if (layout.validation) draft.validation = layout.validation;
        }
        if (importedName) draft.name = importedName;
      });
      setSelectedEntityId(undefined);
      setNotice({ tone: 'ready', text: 'Map files imported and ready to edit' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Map import failed.' });
    }
  };

  const saveLocal = useCallback(() => {
    if (!project) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      setDirty(false);
      setNotice({ tone: 'ready', text: 'Project saved in this browser' });
    } catch {
      setNotice({ tone: 'error', text: 'Local save failed; export a ZIP backup.' });
    }
  }, [project]);

  const exportJson = useCallback(() => {
    if (!project) return;
    const layout = toBaseLayout(project);
    downloadBlob(new Blob([`${JSON.stringify(layout, null, 2)}\n`], { type: 'application/json' }), `${safeMapName(project.name)}-base-layout.json`);
    setNotice({ tone: 'ready', text: 'New-server JSON base layout exported' });
  }, [project]);

  const exportMap = useCallback(async () => {
    if (!project) return;
    try {
      setNotice({ tone: 'working', text: 'Packing original map files and JSON layout…' });
      const zip = new JSZip();
      const folder = zip.folder(safeMapName(project.name));
      if (!folder) throw new Error('Unable to create the export package.');
      folder.file('land', serializeLand(project.terrain));
      folder.file('state', serializeState(project.entities));
      folder.file('tagmap', serializeLines(project.terrain.tagmap));
      folder.file('tagmap2', serializeLines(project.terrain.tagmap2));
      folder.file('base-layout.json', `${JSON.stringify(toBaseLayout(project), null, 2)}\n`);
      folder.file('wulfram-project.json', `${JSON.stringify(project)}\n`);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      downloadBlob(blob, `${safeMapName(project.name)}.zip`);
      setDirty(false);
      setNotice({ tone: 'ready', text: 'Map ZIP exported with original and new-server formats' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    }
  }, [project]);

  const newMap = useCallback(() => {
    if (dirty && !window.confirm('Start a new map? Your current project is autosaved locally, but unexported changes will leave the canvas.')) return;
    const name = window.prompt('Map name', 'Untitled map')?.trim();
    if (name === undefined) return;
    const blank = createBlankProject(name || 'Untitled map');
    if (manifest && !manifest.terrainTextures[blank.terrain.tagmap2[0]]) {
      const first = Object.keys(manifest.terrainTextures)[0];
      if (first) {
        blank.terrain.tagmap = [`0:${first}`];
        blank.terrain.tagmap2 = [first];
        setSelectedTexture(first);
      }
    }
    if (project) pushHistory(cloneProject(project));
    setProject(blank);
    setRedoStack([]);
    setSelectedEntityId(undefined);
    setMode('terrain');
    setDirty(true);
    setNotice({ tone: 'ready', text: 'Blank 129 × 129 map created' });
  }, [dirty, manifest, project, pushHistory]);

  if (!manifest || !project) {
    return (
      <main className="loading-screen">
        <img alt="Wulfram II" src="/wulfram2-logo.png" />
        <div className="loading-bar"><span /></div>
        <p>{notice.text}</p>
      </main>
    );
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const modeLabel = mode === 'terrain' ? `${terrainTool[0].toUpperCase()}${terrainTool.slice(1)} terrain` : selectedPlacementKey ? `Place ${CATALOG.find((item) => item.key === selectedPlacementKey)?.label}` : 'Select units';

  return (
    <main className="editor-shell">
      <input
        className="sr-only"
        multiple
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
        ref={importRef}
        type="file"
      />
      <input
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importHeightmap(file);
          event.target.value = '';
        }}
        ref={heightmapRef}
        type="file"
      />

      <header className="topbar">
        <button className="brand-lockup" onClick={() => window.open('https://github.com/blackwatergaming/wulfram-mapeditor', '_blank')} type="button">
          <span className="brand-mark"><Layers3 /></span>
          <span><strong>WULFRAM</strong><small>FORGE</small></span>
        </button>
        <div className="map-title">
          <span>MAP</span>
          <input
            aria-label="Map name"
            onChange={(event) => mutate((draft) => { draft.name = event.target.value; }, false)}
            value={project.name}
          />
          {dirty && <i aria-label="Unsaved changes" title="Unsaved changes" />}
          <Badge className="source-badge" variant="outline">ORIGINAL ASSETS</Badge>
        </div>
        <div className="top-actions">
          <Button onClick={newMap} size="sm" variant="ghost"><Plus /> New</Button>
          <Button onClick={() => importRef.current?.click()} size="sm" variant="ghost"><FolderOpen /> Import</Button>
          <Button onClick={saveLocal} size="sm" variant="ghost"><Save /> Save</Button>
          <Button onClick={exportJson} size="sm" variant="ghost"><FileJson /> JSON</Button>
          <Button className="export-button" onClick={() => void exportMap()} size="sm"><Download /> Export map</Button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail">
          <div className="mode-switch" role="tablist">
            <button aria-selected={mode === 'terrain'} className={mode === 'terrain' ? 'active' : ''} onClick={() => setMode('terrain')} role="tab" type="button"><Mountain /> Terrain</button>
            <button aria-selected={mode === 'base'} className={mode === 'base' ? 'active' : ''} onClick={() => setMode('base')} role="tab" type="button"><Box /> Base builder</button>
          </div>

          {mode === 'terrain' ? (
            <>
              <section className="panel-section">
                <p className="section-label">TERRAIN TOOLS</p>
                <div className="tool-list">
                  {([
                    ['sculpt', Pickaxe, 'Raise', '1'],
                    ['lower', Mountain, 'Lower', '2'],
                    ['level', CircleDot, 'Level', '3'],
                    ['smooth', RotateCw, 'Smooth', '4'],
                    ['paint', Paintbrush, 'Paint texture', '5'],
                  ] as const).map(([key, Icon, label, shortcut]) => (
                    <button className={terrainTool === key ? 'tool-item active' : 'tool-item'} key={key} onClick={() => setTerrainTool(key)} type="button">
                      <Icon /><span>{label}</span><kbd>{shortcut}</kbd>
                    </button>
                  ))}
                </div>
                <button className="heightmap-action" onClick={() => heightmapRef.current?.click()} type="button">
                  <ImageIcon /><span><strong>Import grayscale</strong><small>Create terrain from a heightmap</small></span>
                </button>
              </section>
              <section className="panel-section texture-library">
                <div className="section-heading"><p className="section-label">ORIGINAL TEXTURES</p><span>{textureNames.length}</span></div>
                <label className="search-field"><Search /><input aria-label="Search textures" onChange={(event) => { setTextureSearch(event.target.value); setTexturePage(0); }} placeholder="Filter archive…" value={textureSearch} /></label>
                <div className="texture-grid">
                  {visibleTextures.map((name) => (
                    <button
                      aria-label={name}
                      className={selectedTexture === name ? 'texture-chip selected' : 'texture-chip'}
                      key={name}
                      onClick={() => { setSelectedTexture(name); setTerrainTool('paint'); }}
                      title={name}
                      type="button"
                    >
                      <img alt="" src={manifest.terrainTextures[name].url} />
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
                <div className="pager">
                  <button disabled={activeTexturePage === 0} onClick={() => setTexturePage((page) => Math.max(0, page - 1))} type="button">←</button>
                  <span>{activeTexturePage + 1} / {texturePageCount}</span>
                  <button disabled={activeTexturePage + 1 >= texturePageCount} onClick={() => setTexturePage((page) => Math.min(texturePageCount - 1, page + 1))} type="button">→</button>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="panel-section">
                <div className="section-heading"><p className="section-label">BUILD TEAM</p><span>STATE {team}</span></div>
                <div className="team-switch">
                  <button className={team === 1 ? 'team-one active' : 'team-one'} onClick={() => setTeam(1)} type="button">TEAM 1</button>
                  <button className={team === 2 ? 'team-two active' : 'team-two'} onClick={() => setTeam(2)} type="button">TEAM 2</button>
                </div>
              </section>
              <section className="catalog-list">
                {(['infrastructure', 'defense', 'support', 'logistics'] as const).map((category) => (
                  <div className="catalog-group" key={category}>
                    <p className="section-label">{category.toUpperCase()}</p>
                    {CATALOG.filter((item) => item.category === category).map((item) => (
                      <button
                        className={selectedPlacementKey === item.key ? 'catalog-item active' : 'catalog-item'}
                        key={item.key}
                        onClick={() => { setSelectedPlacementKey(item.key); setSelectedEntityId(undefined); }}
                        type="button"
                      >
                        <span className={`catalog-glyph team-${team}`}>{item.shortLabel}</span>
                        <span><strong>{item.label}</strong><small>{item.description}</small></span>
                        {item.requiresPower && <i title="Requires power">⚡</i>}
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            </>
          )}
        </aside>

        <section className="stage-column">
          <div className="stage-toolbar">
            <div className="history-controls">
              <Button aria-label="Undo" disabled={!undoStack.length} onClick={undo} size="icon-sm" variant="ghost"><Undo2 /></Button>
              <Button aria-label="Redo" disabled={!redoStack.length} onClick={redo} size="icon-sm" variant="ghost"><Redo2 /></Button>
              <span className="toolbar-rule" />
              {mode === 'terrain' ? <Mountain /> : <Box />}
              <span>{modeLabel}</span>
            </div>
            <div className="stage-stats">
              <span>{project.terrain.width} × {project.terrain.height}</span>
              <span>{project.terrain.worldWidth.toLocaleString()} × {project.terrain.worldHeight.toLocaleString()} u</span>
              <span>{project.entities.filter((entity) => entity.token !== '*').length} units</span>
              <Button aria-label="Toggle terrain grid" className={showGrid ? 'grid-active' : ''} onClick={() => setShowGrid((value) => !value)} size="icon-sm" variant="ghost"><Grid3X3 /></Button>
            </div>
          </div>
          <TerrainViewport
            backupRadius={project.validation.backupRadius}
            brushRadius={brushRadius}
            entities={project.entities}
            manifest={manifest}
            mode={mode}
            onCursor={setCursor}
            onPlace={placeUnit}
            onSelectEntity={setSelectedEntityId}
            onTerrainStroke={onTerrainStroke}
            selectedEntityId={selectedEntityId}
            selectedPlacementKey={selectedPlacementKey}
            serviceRadius={project.validation.serviceRadius}
            showGrid={showGrid}
            terrain={project.terrain}
            terrainTool={terrainTool}
          />
          <footer className={`statusbar ${notice.tone}`}>
            <span>{notice.tone === 'error' ? <AlertTriangle /> : notice.tone === 'working' ? <CircleDot /> : <CheckCircle2 />}{notice.text}</span>
            {cursor && <span className="cursor-position">X {cursor[0].toFixed(1)} · Y {cursor[1].toFixed(1)} · Z {cursor[2].toFixed(1)}</span>}
            <span className="format-state">LAND + STATE + JSON</span>
          </footer>
        </section>

        <aside className="inspector">
          {mode === 'terrain' ? (
            <>
              <div className="inspector-heading">
                <span>INSPECTOR</span>
                <h2>{terrainTool === 'paint' ? 'Texture brush' : `${terrainTool[0].toUpperCase()}${terrainTool.slice(1)} brush`}</h2>
                <Badge variant="secondary">TERRAIN</Badge>
              </div>
              <section className="inspector-block">
                <RangeField label="Radius" max={600} min={25} onChange={setBrushRadius} step={5} suffix=" u" value={brushRadius} />
                <RangeField label="Strength" max={100} min={1} onChange={setBrushStrength} suffix="%" value={brushStrength} />
                <div className="brush-profile"><span /><span /><span /></div>
                <p className="field-help">Soft radial falloff. Drag with the left mouse button; orbit with the right.</p>
              </section>
              {terrainTool === 'paint' && (
                <section className="inspector-block selected-texture">
                  <p className="section-label">PAINT MATERIAL</p>
                  <img alt={selectedTexture} src={manifest.terrainTextures[selectedTexture]?.url} />
                  <div><strong>{selectedTexture}</strong><small>Direct tagmap2 entry · original palette</small></div>
                </section>
              )}
              <section className="inspector-block">
                <p className="section-label">GRAYSCALE IMPORT RANGE</p>
                <div className="number-grid two">
                  <NumberField label="Black" onChange={(value) => setHeightmapRange(([_, maximum]) => [value, maximum])} value={heightmapRange[0]} />
                  <NumberField label="White" onChange={(value) => setHeightmapRange(([minimum]) => [minimum, value])} value={heightmapRange[1]} />
                </div>
                <button className="secondary-action" onClick={() => heightmapRef.current?.click()} type="button"><ImageIcon /> Choose heightmap</button>
              </section>
              <section className="inspector-block format-note">
                <strong>Original terrain, lossless structure</strong>
                <p>Height and texture IDs stay in Wulfram&apos;s 129 × 129 <code>land</code> layout. Painted archive names are added to <code>tagmap2</code>.</p>
              </section>
            </>
          ) : selectedEntity ? (
            <>
              <div className="inspector-heading">
                <span>SELECTED UNIT</span>
                <h2>{catalogFor(selectedEntity)?.label ?? ENTITY_NAMES[selectedEntity.token] ?? selectedEntity.token}</h2>
                <Badge className={selectedEntity.team === 2 ? 'badge-team-two' : 'badge-team-one'}>TEAM {selectedEntity.team}</Badge>
              </div>
              <section className="inspector-block">
                <p className="section-label">POSITION</p>
                <div className="number-grid three">
                  {(['X', 'Y', 'Z'] as const).map((label, index) => (
                    <NumberField key={label} label={label} onChange={(value) => updateSelected((entity) => { entity.position[index] = value; })} step={0.1} value={selectedEntity.position[index]} />
                  ))}
                </div>
                <button className="secondary-action" onClick={() => updateSelected((entity) => {
                  const ground = sampleHeight(project.terrain, entity.position[0], entity.position[1]);
                  const offset = analysis?.turretDefaults[entity.token]?.heightOffset ?? 0;
                  entity.position[2] = ground + offset;
                })} type="button"><Mountain /> Snap to derived ground height</button>
              </section>
              <section className="inspector-block">
                <RangeField
                  label="Yaw"
                  max={360}
                  min={0}
                  onChange={(degrees) => updateSelected((entity) => { entity.rotation[2] = degrees * Math.PI / 180; }, false)}
                  suffix="°"
                  value={(selectedEntity.rotation[2] * 180 / Math.PI + 360) % 360}
                />
                <div className="rotation-presets">
                  {[0, 45, 90, 180, 270].map((degrees) => <button key={degrees} onClick={() => updateSelected((entity) => { entity.rotation[2] = degrees * Math.PI / 180; })} type="button">{degrees}°</button>)}
                </div>
                <div className="number-grid two">
                  <NumberField label="Pitch rad" onChange={(value) => updateSelected((entity) => { entity.rotation[0] = value; })} step={0.001} value={selectedEntity.rotation[0]} />
                  <NumberField label="Roll rad" onChange={(value) => updateSelected((entity) => { entity.rotation[1] = value; })} step={0.001} value={selectedEntity.rotation[1]} />
                </div>
              </section>
              <section className="inspector-block">
                <label className="toggle-row"><span><strong>Active on load</strong><small>Original state flag</small></span><input aria-label="Active on load" checked={Boolean(selectedEntity.active)} onChange={(event) => updateSelected((entity) => { entity.active = event.target.checked ? 1 : 0; })} type="checkbox" /></label>
                <button className="danger-action" onClick={() => {
                  mutate((draft) => { draft.entities = draft.entities.filter((entity) => entity.id !== selectedEntity.id); });
                  setSelectedEntityId(undefined);
                }} type="button"><Trash2 /> Delete unit</button>
              </section>
              <section className="inspector-block validation-list">
                <div className="section-heading"><p className="section-label">PLACEMENT CHECKS</p><span>{selectedIssues.length ? `${selectedIssues.length} issue${selectedIssues.length === 1 ? '' : 's'}` : 'VALID'}</span></div>
                <p className="slope-readout">Ground slope: {sampleSlopeDegrees(project.terrain, selectedEntity.position[0], selectedEntity.position[1]).toFixed(1)}°</p>
                {selectedIssues.length ? selectedIssues.map((issue) => (
                  <div className={`validation-item ${issue.severity}`} key={`${issue.code}-${issue.message}`}>
                    {issue.severity === 'error' ? <AlertTriangle /> : <CircleDot />}<span>{issue.message}</span>
                  </div>
                )) : <div className="validation-item valid"><CheckCircle2 /><span>Bounds, slope, spacing, and power checks pass.</span></div>}
              </section>
            </>
          ) : (
            <>
              <div className="inspector-heading">
                <span>BASE BUILDER</span>
                <h2>Placement rules</h2>
                <Badge variant="secondary">{project.entities.filter((entity) => entity.token !== '*').length} UNITS</Badge>
              </div>
              <section className="inspector-block validation-summary">
                <div><strong className={errorCount ? 'has-errors' : ''}>{errorCount}</strong><span>Errors</span></div>
                <div><strong>{warningCount}</strong><span>Warnings</span></div>
                <div><strong>{issues.length - errorCount - warningCount}</strong><span>Info</span></div>
              </section>
              <section className="inspector-block">
                <p className="section-label">SERVER-SUPPLIED RADII</p>
                <RangeField label="Service radius" max={1200} min={50} onChange={(value) => mutate((draft) => { draft.validation.serviceRadius = value; })} step={10} suffix=" u" value={project.validation.serviceRadius} />
                <RangeField label="Backup radius" max={600} min={20} onChange={(value) => mutate((draft) => { draft.validation.backupRadius = value; })} step={10} suffix=" u" value={project.validation.backupRadius} />
                <p className="field-help">The original client receives these values from the server. The JSON layout preserves them for deterministic new-server validation.</p>
              </section>
              <section className="inspector-block">
                <p className="section-label">SURFACE & SPACING</p>
                <RangeField label="Maximum slope" max={60} min={0} onChange={(value) => mutate((draft) => { draft.validation.maxSlopeDegrees = value; })} suffix="°" value={project.validation.maxSlopeDegrees} />
                <RangeField label="Minimum spacing" max={80} min={0} onChange={(value) => mutate((draft) => { draft.validation.minSpacing = value; })} suffix=" u" value={project.validation.minSpacing} />
              </section>
              <section className="inspector-block format-note">
                <strong>Ghidra-verified power rules</strong>
                <p>Cells test backup at <code>backup − 10</code>, block primary overlap at <code>2 × service + 10</code>, and power units at <code>service − 10</code>.</p>
              </section>
              <section className="inspector-block">
                <button className="secondary-action" onClick={exportJson} type="button"><FileJson /> Export base-layout JSON</button>
              </section>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
