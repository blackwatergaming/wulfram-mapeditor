'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  CircleDot,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
  FolderOpen,
  GitBranch,
  Grid3X3,
  Image as ImageIcon,
  Layers3,
  Mountain,
  Paintbrush,
  Pickaxe,
  Plus,
  Redo2,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BaseTemplatePreview } from '@/components/editor/base-template-preview';
import { TerrainViewport, type EditorMode, type StrokePhase, type TerrainTool } from '@/components/editor/terrain-viewport';
import { createMapArchive, readMapArchive, safeMapName } from '@/lib/map-package';
import { heightsFromGrayscaleRgba } from '@/lib/heightmap';
import {
  terrainBrushMix,
  terrainBrushWeight,
  type TerrainBrushFalloff,
  type TerrainBrushShape,
} from '@/lib/terrain-brush';
import {
  configureLocalRepository,
  diagnoseLocalRepository,
  hasNativeRepositoryBridge,
  listLocalRepositoryMaps,
  loadLocalRepositoryMap,
  publishLocalRepositoryMap,
  saveLocalRepositoryMap,
  switchLocalRepositoryBranch,
  type RepositoryCatalog,
  type RepositoryDiagnostics,
} from '@/lib/map-repository-client';
import {
  MAP_SOURCE_FILES,
  createMapSourceArchive,
  parseMapSourceFiles,
  readMapSourceArchive,
  type MapSourceFiles,
} from '@/lib/map-source';
import { shouldPaintTextureVertex } from '@/lib/terrain-blend';
import {
  CATALOG,
  DEFAULT_VALIDATION,
  ENTITY_NAMES,
  catalogFor,
  catalogItemHasModel,
  cloneProject,
  createBlankProject,
  createId,
  ensureTextureTag,
  hasModelForEntity,
  instantiateBaseTemplate,
  parseBaseLayout,
  parseLand,
  parseLines,
  parseState,
  sampleHeight,
  sampleSlopeDegrees,
  snapStructureToTerrain,
  structureTerrainClearance,
  toBaseLayout,
  usesFootprintTerrainSnap,
  validateProject,
  type AssetManifest,
  type BaseTemplateLibrary,
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
  placementDefaults: Record<string, {
    heightOffset: number;
    method: string;
    name: string;
    sampleCount: number;
    snapMargin: number;
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
const TERRAIN_TOOL_LABELS: Record<TerrainTool, string> = {
  sculpt: 'Raise',
  lower: 'Lower',
  level: 'Flatten',
  smooth: 'Smooth',
  paint: 'Paint texture',
  stamp: 'Set height',
};

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
  const [baseTemplates, setBaseTemplates] = useState<BaseTemplateLibrary>();
  const [project, setProject] = useState<WulframProject>();
  const [mode, setMode] = useState<EditorMode>('terrain');
  const [terrainTool, setTerrainTool] = useState<TerrainTool>('sculpt');
  const [brushRadius, setBrushRadius] = useState(165);
  const [brushStrength, setBrushStrength] = useState(32);
  const [brushShape, setBrushShape] = useState<TerrainBrushShape>('round');
  const [brushFalloff, setBrushFalloff] = useState<TerrainBrushFalloff>('soft');
  const [terrainTargetHeight, setTerrainTargetHeight] = useState(0);
  const [lastTerrainHeight, setLastTerrainHeight] = useState<number>();
  const [textureBlend, setTextureBlend] = useState(72);
  const [selectedTexture, setSelectedTexture] = useState('canyon003');
  const [textureSearch, setTextureSearch] = useState('');
  const [texturePage, setTexturePage] = useState(0);
  const [team, setTeam] = useState(1);
  const [selectedPlacementKey, setSelectedPlacementKey] = useState('power');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const [templateScale, setTemplateScale] = useState(1);
  const [templateYaw, setTemplateYaw] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState<string>();
  const [showGrid, setShowGrid] = useState(true);
  const [cursor, setCursor] = useState<Vec3>();
  const [heightmapRange, setHeightmapRange] = useState<[number, number]>([0, 180]);
  const [heightmapGamma, setHeightmapGamma] = useState(1);
  const [heightmapSmoothing, setHeightmapSmoothing] = useState(2);
  const [heightmapFile, setHeightmapFile] = useState<File>();
  const [heightmapPreviewUrl, setHeightmapPreviewUrl] = useState('');
  const [heightmapDialogOpen, setHeightmapDialogOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<WulframProject[]>([]);
  const [redoStack, setRedoStack] = useState<WulframProject[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>({ tone: 'working', text: 'Loading original Wulfram assets…' });
  const [repositoryCatalog, setRepositoryCatalog] = useState<RepositoryCatalog>();
  const [repositorySlug, setRepositorySlug] = useState('');
  const [repositoryChecked, setRepositoryChecked] = useState(false);
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const [repositoryWizardOpen, setRepositoryWizardOpen] = useState(false);
  const [repositoryDiagnostics, setRepositoryDiagnostics] = useState<RepositoryDiagnostics>();
  const [repositoryDiagnosticError, setRepositoryDiagnosticError] = useState('');
  const [repositoryDiagnosticBusy, setRepositoryDiagnosticBusy] = useState(false);
  const [repositoryBranchDraft, setRepositoryBranchDraft] = useState('');
  const [lastPullRequestUrl, setLastPullRequestUrl] = useState('');
  const [nativeRepositoryBridge] = useState(hasNativeRepositoryBridge);
  const importRef = useRef<HTMLInputElement>(null);
  const heightmapRef = useRef<HTMLInputElement>(null);
  const strokeSnapshotRef = useRef<WulframProject | null>(null);
  const levelHeightRef = useRef(0);

  const updateCursor = useCallback((point?: Vec3) => {
    setCursor(point);
    if (point) setLastTerrainHeight(point[2]);
  }, []);

  useEffect(() => () => {
    if (heightmapPreviewUrl) URL.revokeObjectURL(heightmapPreviewUrl);
  }, [heightmapPreviewUrl]);

  useEffect(() => {
    const cancelPlacement = (event: KeyboardEvent) => {
      if (event.key !== 'Escape'
        || mode !== 'base'
        || repositoryWizardOpen
        || heightmapDialogOpen
        || (!selectedPlacementKey && !selectedTemplateId)) return;
      event.preventDefault();
      setSelectedPlacementKey('');
      setSelectedTemplateId(undefined);
      setNotice({ tone: 'ready', text: 'Placement tool cleared · select a unit or template to place again' });
    };
    window.addEventListener('keydown', cancelPlacement);
    return () => window.removeEventListener('keydown', cancelPlacement);
  }, [heightmapDialogOpen, mode, repositoryWizardOpen, selectedPlacementKey, selectedTemplateId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [assetsResponse, analysisResponse, templatesResponse] = await Promise.all([
          fetch('/assets/manifest.json'),
          fetch('/assets/map-analysis.json'),
          fetch('/assets/base-templates.json'),
        ]);
        if (!assetsResponse.ok || !analysisResponse.ok || !templatesResponse.ok) throw new Error('The extracted asset manifest is unavailable.');
        const assets = await assetsResponse.json() as AssetManifest;
        const mapAnalysis = await analysisResponse.json() as MapAnalysis;
        const templateLibrary = await templatesResponse.json() as BaseTemplateLibrary;
        if (cancelled) return;
        setManifest(assets);
        setAnalysis(mapAnalysis);
        setBaseTemplates(templateLibrary);
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

  const refreshRepository = useCallback(async (announce = false) => {
    try {
      const catalog = await listLocalRepositoryMaps(announce ? 8000 : 1500);
      setRepositoryCatalog(catalog);
      setRepositorySlug((current) => catalog.maps.some((map) => map.slug === current) ? current : (catalog.maps[0]?.slug ?? ''));
      if (announce) setNotice({ tone: 'ready', text: `Found ${catalog.maps.length} map${catalog.maps.length === 1 ? '' : 's'} in the local repository` });
    } catch (error) {
      setRepositoryCatalog(undefined);
      if (announce) {
        setRepositoryWizardOpen(true);
        setRepositoryDiagnosticError(error instanceof Error ? error.message : 'Local maps service is offline.');
        setNotice({
          tone: 'error',
          text: error instanceof Error ? `${error.message} Run npm run dev to enable repository access.` : 'Local maps service is offline.',
        });
      }
    } finally {
      setRepositoryChecked(true);
    }
  }, []);

  const diagnoseRepository = useCallback(async () => {
    try {
      setRepositoryDiagnosticBusy(true);
      setRepositoryDiagnosticError('');
      setRepositoryDiagnostics(await diagnoseLocalRepository());
    } catch (error) {
      setRepositoryDiagnostics(undefined);
      setRepositoryDiagnosticError(error instanceof Error ? error.message : 'The local maps service did not respond.');
    } finally {
      setRepositoryDiagnosticBusy(false);
    }
  }, []);

  const openRepositoryWizard = useCallback(() => {
    setRepositoryWizardOpen(true);
    void diagnoseRepository();
  }, [diagnoseRepository]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRepository(false), 0);
    return () => window.clearTimeout(timer);
  }, [refreshRepository]);

  const configureRepository = useCallback(async () => {
    try {
      setRepositoryBusy(true);
      const catalog = await configureLocalRepository();
      setRepositoryCatalog(catalog);
      setRepositorySlug(catalog.maps[0]?.slug ?? '');
      setRepositoryChecked(true);
      setNotice({ tone: 'ready', text: `Using ${catalog.repository}` });
      void diagnoseRepository();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Repository selection failed.' });
    } finally {
      setRepositoryBusy(false);
    }
  }, [diagnoseRepository]);

  const changeRepositoryBranch = useCallback(async (branch: string, create: boolean) => {
    const normalized = branch.trim();
    if (!normalized) return;
    try {
      setRepositoryBusy(true);
      const catalog = await switchLocalRepositoryBranch(normalized, create);
      setRepositoryCatalog(catalog);
      setRepositorySlug((current) => catalog.maps.some((map) => map.slug === current) ? current : (catalog.maps[0]?.slug ?? ''));
      setRepositoryBranchDraft('');
      setNotice({ tone: 'ready', text: `${create ? 'Created and switched to' : 'Switched to'} ${catalog.branch}` });
      void diagnoseRepository();
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Branch operation failed.' });
    } finally {
      setRepositoryBusy(false);
    }
  }, [diagnoseRepository]);

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
      } else if (mode === 'terrain' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcutTools: Record<string, TerrainTool> = {
          '1': 'sculpt',
          '2': 'lower',
          '3': 'level',
          '4': 'smooth',
          '5': 'paint',
          '6': 'stamp',
        };
        const tool = shortcutTools[event.key];
        if (tool) {
          event.preventDefault();
          setTerrainTool(tool);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, mutate, project, redo, selectedEntityId, undo]);

  const issues = useMemo(() => project ? validateProject(project) : [], [project]);
  const selectedEntity = useMemo(
    () => project?.entities.find((entity) => entity.id === selectedEntityId),
    [project, selectedEntityId],
  );
  const selectedIssues = useMemo(
    () => issues.filter((issue) => issue.entityId === selectedEntityId),
    [issues, selectedEntityId],
  );
  const selectedTemplate = useMemo(
    () => baseTemplates?.templates.find((template) => template.id === selectedTemplateId),
    [baseTemplates, selectedTemplateId],
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
  const placeableCatalog = useMemo(
    () => manifest ? CATALOG.filter((item) => catalogItemHasModel(item, team, manifest)) : [],
    [manifest, team],
  );
  const placementPreview = useMemo((): StateEntity[] => {
    if (mode !== 'base' || !cursor || !project || !manifest) return [];
    const [x, y] = cursor;
    if (selectedTemplate) {
      return instantiateBaseTemplate(
        selectedTemplate,
        project.terrain,
        [x, y],
        team,
        templateScale,
        templateYaw * Math.PI / 180,
        manifest,
      ).entities.map((entity, index) => ({ ...entity, id: `placement-preview-${index}` }));
    }
    const item = placeableCatalog.find((entry) => entry.key === selectedPlacementKey);
    if (!item) return [];
    const defaultData = analysis?.turretDefaults[item.token];
    const placementDefault = analysis?.placementDefaults?.[item.token];
    const ground = sampleHeight(project.terrain, x, y);
    const offset = placementDefault?.heightOffset ?? defaultData?.heightOffset ?? 0;
    const yaw = defaultData?.yawCircularMean ?? 0;
    const clearance = structureTerrainClearance(
      { token: item.token, team },
      manifest,
      item.footprint,
      offset,
      placementDefault?.snapMargin,
    );
    const snap = usesFootprintTerrainSnap(item.token)
      ? snapStructureToTerrain(project.terrain, x, y, clearance.footprint, yaw, clearance.groundOffset, clearance.margin)
      : undefined;
    return [{
      id: 'placement-preview-0',
      token: item.token,
      subtype: item.subtype,
      team,
      position: [x, y, snap?.height ?? ground + offset],
      rotation: [snap?.pitch ?? defaultData?.pitch ?? 0, snap?.roll ?? defaultData?.roll ?? 0, yaw],
      active: 1,
    }];
  }, [analysis, cursor, manifest, mode, placeableCatalog, project, selectedPlacementKey, selectedTemplate, team, templateScale, templateYaw]);

  const applyBrush = useCallback((worldX: number, worldY: number) => {
    if (!manifest) return;
    setProject((current) => {
      if (!current) return current;
      const painting = terrainTool === 'paint';
      const terrain = {
        ...current.terrain,
        heights: painting ? current.terrain.heights : [...current.terrain.heights],
        textureIds: painting ? [...current.terrain.textureIds] : current.terrain.textureIds,
        tagmap: painting ? [...current.terrain.tagmap] : current.terrain.tagmap,
        tagmap2: painting ? [...current.terrain.tagmap2] : current.terrain.tagmap2,
      };
      const sourceHeights = terrainTool === 'smooth' ? current.terrain.heights : terrain.heights;
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
          const falloff = terrainBrushWeight(
            px - worldX,
            py - worldY,
            brushRadius,
            brushShape,
            brushFalloff,
          );
          if (falloff <= 0) continue;
          const index = y * terrain.width + x;
          if (terrainTool === 'paint') {
            if (shouldPaintTextureVertex(x, y, textureId, falloff, brushStrength)) terrain.textureIds[index] = textureId;
          } else if (terrainTool === 'sculpt' || terrainTool === 'lower') {
            const direction = terrainTool === 'lower' ? -1 : 1;
            terrain.heights[index] += direction * brushStrength / 100 * 7 * falloff;
          } else if (terrainTool === 'level') {
            const mix = terrainBrushMix(brushStrength, falloff, brushFalloff === 'hard' ? 1 : 0.34);
            terrain.heights[index] += (levelHeightRef.current - terrain.heights[index]) * mix;
          } else if (terrainTool === 'stamp') {
            const mix = terrainBrushMix(brushStrength, falloff);
            terrain.heights[index] += (terrainTargetHeight - terrain.heights[index]) * mix;
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
            const mix = terrainBrushMix(brushStrength, falloff, 0.3);
            terrain.heights[index] += (total / count - terrain.heights[index]) * mix;
          }
        }
      }
      return { ...current, terrain, updatedAt: new Date().toISOString() };
    });
    setDirty(true);
  }, [brushFalloff, brushRadius, brushShape, brushStrength, manifest, selectedTexture, terrainTargetHeight, terrainTool]);

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

  const conformEntityToTerrain = useCallback((entity: StateEntity, terrain: WulframProject['terrain']) => {
    const item = catalogFor(entity);
    const placementDefault = analysis?.placementDefaults?.[entity.token];
    const turretDefault = analysis?.turretDefaults[entity.token];
    const groundOffset = placementDefault?.heightOffset ?? turretDefault?.heightOffset ?? 0;
    if (usesFootprintTerrainSnap(entity.token)) {
      const clearance = structureTerrainClearance(
        entity,
        manifest,
        item?.footprint ?? 10,
        groundOffset,
        placementDefault?.snapMargin,
      );
      const snap = snapStructureToTerrain(
        terrain,
        entity.position[0],
        entity.position[1],
        clearance.footprint,
        entity.rotation[2],
        clearance.groundOffset,
        clearance.margin,
      );
      entity.position[2] = snap.height;
      entity.rotation[0] = snap.pitch;
      entity.rotation[1] = snap.roll;
    } else {
      entity.position[2] = sampleHeight(terrain, entity.position[0], entity.position[1]) + groundOffset;
    }
  }, [analysis, manifest]);

  const resolveEntityMove = useCallback((source: StateEntity, x: number, y: number): StateEntity => {
    if (!project) return source;
    const moved: StateEntity = {
      ...source,
      position: [x, y, source.position[2]],
      rotation: [...source.rotation],
    };
    conformEntityToTerrain(moved, project.terrain);
    return moved;
  }, [conformEntityToTerrain, project]);

  const moveEntity = useCallback((id: string, x: number, y: number) => {
    if (!project) return;
    mutate((draft) => {
      const entity = draft.entities.find((candidate) => candidate.id === id);
      if (!entity) return;
      entity.position[0] = x;
      entity.position[1] = y;
      conformEntityToTerrain(entity, draft.terrain);
    });
    setSelectedEntityId(id);
    setNotice({ tone: 'ready', text: `Unit moved and terrain-tuned at ${x.toFixed(1)}, ${y.toFixed(1)}` });
  }, [conformEntityToTerrain, mutate, project]);

  const placeUnit = useCallback((x: number, y: number) => {
    if (!project) return;
    if (selectedTemplate) {
      const placement = instantiateBaseTemplate(
        selectedTemplate,
        project.terrain,
        [x, y],
        team,
        templateScale,
        templateYaw * Math.PI / 180,
        manifest,
      );
      if (!placement.entities.length) return;
      mutate((draft) => { draft.entities.push(...placement.entities); });
      setSelectedEntityId(undefined);
      const autoFit = Math.abs(placement.scale - templateScale) > 0.001
        ? ` · auto-fit ${placement.scale.toFixed(2)}×`
        : '';
      setNotice({
        tone: 'ready',
        text: `${selectedTemplate.name} placed · ${placement.entities.length} modeled units terrain-conformed${placement.skippedWithoutModel ? ` · ${placement.skippedWithoutModel} removed omitted` : ''}${autoFit}`,
      });
      return;
    }
    const item = placeableCatalog.find((entry) => entry.key === selectedPlacementKey);
    if (!item) return;
    const defaultData = analysis?.turretDefaults[item.token];
    const placementDefault = analysis?.placementDefaults?.[item.token];
    const ground = sampleHeight(project.terrain, x, y);
    const offset = placementDefault?.heightOffset ?? defaultData?.heightOffset ?? 0;
    const yaw = defaultData?.yawCircularMean ?? 0;
    const clearance = structureTerrainClearance(
      { token: item.token, team },
      manifest,
      item.footprint,
      offset,
      placementDefault?.snapMargin,
    );
    const snap = usesFootprintTerrainSnap(item.token)
      ? snapStructureToTerrain(project.terrain, x, y, clearance.footprint, yaw, clearance.groundOffset, clearance.margin)
      : undefined;
    const entity: StateEntity = {
      id: createId(item.key),
      token: item.token,
      subtype: item.subtype,
      team,
      position: [x, y, snap?.height ?? ground + offset],
      rotation: [snap?.pitch ?? defaultData?.pitch ?? 0, snap?.roll ?? defaultData?.roll ?? 0, yaw],
      active: 1,
    };
    mutate((draft) => { draft.entities.push(entity); });
    setSelectedEntityId(entity.id);
    setNotice({ tone: 'ready', text: `${item.label} placed at ${x.toFixed(1)}, ${y.toFixed(1)}` });
  }, [analysis, manifest, mutate, placeableCatalog, project, selectedPlacementKey, selectedTemplate, team, templateScale, templateYaw]);

  const updateSelected = useCallback((change: (entity: StateEntity) => void, record = true) => {
    if (!selectedEntityId) return;
    mutate((draft) => {
      const entity = draft.entities.find((item) => item.id === selectedEntityId);
      if (entity) change(entity);
    }, record);
  }, [mutate, selectedEntityId]);

  const stageHeightmap = useCallback((file: File) => {
    setHeightmapFile(file);
    setHeightmapPreviewUrl(URL.createObjectURL(file));
    setHeightmapDialogOpen(true);
  }, []);

  const closeHeightmapDialog = useCallback(() => {
    setHeightmapDialogOpen(false);
    setHeightmapFile(undefined);
    setHeightmapPreviewUrl('');
  }, []);

  const importHeightmap = useCallback(async () => {
    const file = heightmapFile;
    if (!project) return;
    if (!file) return;
    try {
      setNotice({ tone: 'working', text: `Reading grayscale heightmap ${file.name}…` });
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = project.terrain.width;
      canvas.height = project.terrain.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas image decoding is unavailable.');
      context.imageSmoothingEnabled = false;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const [minimum, maximum] = heightmapRange;
      const heights = heightsFromGrayscaleRgba(pixels, canvas.width, canvas.height, {
        minimum,
        maximum,
        gamma: heightmapGamma,
        smoothingPasses: heightmapSmoothing,
      });
      bitmap.close();
      mutate((draft) => { draft.terrain.heights = heights; });
      setMode('terrain');
      setTerrainTool('sculpt');
      closeHeightmapDialog();
      setNotice({ tone: 'ready', text: `Heightmap applied at ${minimum}–${maximum} units with ${heightmapSmoothing} smoothing pass${heightmapSmoothing === 1 ? '' : 'es'}` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Heightmap import failed.' });
    }
  }, [closeHeightmapDialog, heightmapFile, heightmapGamma, heightmapRange, heightmapSmoothing, mutate, project]);

  const importFiles = async (files: File[]) => {
    if (!files.length || !project) return;
    try {
      setNotice({ tone: 'working', text: `Importing ${files.length === 1 ? files[0].name : `${files.length} map files`}…` });
      if (files.length === 1 && files[0].type.startsWith('image/')) {
        stageHeightmap(files[0]);
        setNotice({ tone: 'ready', text: 'Adjust the grayscale height controls, then apply the image' });
        return;
      }
      let landText: string | undefined;
      let stateText: string | undefined;
      let tagmapText: string | undefined;
      let tagmap2Text: string | undefined;
      let jsonValue: unknown;
      let sourceProject: WulframProject | undefined;
      const sourceFiles: Partial<MapSourceFiles> = {};
      let importedName: string | undefined;

      const consume = async (name: string, text: string) => {
        const base = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? name.toLowerCase();
        if (MAP_SOURCE_FILES.includes(base as (typeof MAP_SOURCE_FILES)[number])) {
          sourceFiles[base as (typeof MAP_SOURCE_FILES)[number]] = text;
        } else if (base === 'land' || base.endsWith('.land')) landText = text;
        else if (base === 'state' || /^state\d*$/.test(base) || base.endsWith('.state')) stateText = text;
        else if (base === 'tagmap2' || base.endsWith('.tagmap2')) tagmap2Text = text;
        else if (base === 'tagmap' || base.endsWith('.tagmap')) tagmapText = text;
        else if (base.endsWith('.json')) jsonValue = JSON.parse(text);
        else if (/^\d+x\d+\s*[\r\n]+[\d.]+x[\d.]+/i.test(text.trim())) landText = text;
      };

      for (const file of files) {
        if (/\.zip$/i.test(file.name)) {
          importedName = file.name.replace(/\.zip$/i, '');
          const sourceArchive = await readMapSourceArchive(file);
          if (sourceArchive) {
            sourceProject = sourceArchive.project;
            importedName = sourceArchive.root.split('/').pop() || importedName;
            continue;
          }
          for (const entry of await readMapArchive(file)) {
            await consume(entry.name, entry.text);
          }
        } else {
          await consume(file.name, await file.text());
          if (!importedName && !['land', 'state', 'tagmap', 'tagmap2'].includes(file.name.toLowerCase())) {
            importedName = file.name.replace(/\.[^.]+$/, '');
          }
        }
      }

      if (!sourceProject && MAP_SOURCE_FILES.every((fileName) => typeof sourceFiles[fileName] === 'string')) {
        sourceProject = parseMapSourceFiles(sourceFiles);
      }

      if (sourceProject) {
        pushHistory(cloneProject(project));
        setProject(sourceProject);
        setRepositorySlug('');
        setLastPullRequestUrl('');
        setDirty(true);
        setSelectedEntityId(undefined);
        setNotice({ tone: 'ready', text: `Git map source ${sourceProject.name} imported` });
        return;
      }

      if (jsonValue && typeof jsonValue === 'object' && (jsonValue as WulframProject).format === 'wulfram-map-project') {
        const restored = jsonValue as WulframProject;
        pushHistory(cloneProject(project));
        setProject(restored);
        setRepositorySlug('');
        setLastPullRequestUrl('');
        setDirty(true);
        setSelectedEntityId(undefined);
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
      setRepositorySlug('');
      setLastPullRequestUrl('');
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

  const exportSource = useCallback(async () => {
    if (!project) return;
    try {
      const slug = safeMapName(project.name);
      setNotice({ tone: 'working', text: 'Packing line-oriented Git map source…' });
      const archive = await createMapSourceArchive(project, slug);
      downloadBlob(new Blob([archive], { type: 'application/zip' }), `${slug}-source.zip`);
      setNotice({ tone: 'ready', text: 'Git-friendly TSV, JSONL, and tag-map source exported' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Source export failed.' });
    }
  }, [project]);

  const exportMap = useCallback(async () => {
    if (!project) return;
    try {
      setNotice({ tone: 'working', text: 'Packing original map files and JSON layout…' });
      const archive = await createMapArchive(project);
      const blob = new Blob([archive], { type: 'application/zip' });
      downloadBlob(blob, `${safeMapName(project.name)}.zip`);
      setDirty(false);
      setNotice({ tone: 'ready', text: 'Map ZIP exported with original and new-server formats' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    }
  }, [project]);

  const loadRepositorySelection = useCallback(async () => {
    if (!repositorySlug || !project) return;
    if (dirty && !window.confirm('Load the selected repository map? Your current project is autosaved in this browser, but the canvas will be replaced.')) return;
    try {
      setRepositoryBusy(true);
      setNotice({ tone: 'working', text: `Loading ${repositorySlug} from the local maps checkout…` });
      const loaded = await loadLocalRepositoryMap(repositorySlug);
      pushHistory(cloneProject(project));
      setProject(loaded.project);
      setRedoStack([]);
      setSelectedEntityId(undefined);
      setDirty(false);
      setNotice({ tone: 'ready', text: `${loaded.project.name} loaded from Git source` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Repository map load failed.' });
    } finally {
      setRepositoryBusy(false);
    }
  }, [dirty, project, pushHistory, repositorySlug]);

  const saveRepositorySelection = useCallback(async (publish: boolean) => {
    if (!project) return;
    const slug = repositorySlug || safeMapName(project.name);
    if (publish && !window.confirm(
      repositoryCatalog?.branch === repositoryCatalog?.defaultBranch
        ? `Save ${project.name}, create a feature branch, commit it, push it, and open a pull request into main?`
        : `Save ${project.name}, commit it on ${repositoryCatalog?.branch}, push it, and open or update its pull request into main?`,
    )) return;
    try {
      setRepositoryBusy(true);
      setNotice({ tone: 'working', text: publish ? `Saving and publishing ${slug}…` : `Saving ${slug} as Git map source…` });
      const saved = await saveLocalRepositoryMap(slug, project);
      setProject(saved.project);
      setRepositorySlug(slug);
      setDirty(false);
      if (publish) {
        const result = await publishLocalRepositoryMap(slug);
        setLastPullRequestUrl(result.prUrl);
        setRepositoryCatalog(result);
        setNotice({ tone: 'ready', text: result.message });
      } else {
        setNotice({ tone: 'ready', text: `${saved.project.name} saved to maps/${slug}` });
      }
      await refreshRepository(false);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Repository map save failed.' });
    } finally {
      setRepositoryBusy(false);
    }
  }, [project, refreshRepository, repositoryCatalog?.branch, repositoryCatalog?.defaultBranch, repositorySlug]);

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
    setRepositorySlug('');
    setLastPullRequestUrl('');
    setRedoStack([]);
    setSelectedEntityId(undefined);
    setMode('terrain');
    setDirty(true);
    setNotice({ tone: 'ready', text: 'Blank 129 × 129 map created' });
  }, [dirty, manifest, project, pushHistory]);

  if (!manifest || !baseTemplates || !project) {
    return (
      <main className="loading-screen">
        <img alt="Wulfram II" src="/assets/wulfram2-logo.png" />
        <div className="loading-bar"><span /></div>
        <p>{notice.text}</p>
      </main>
    );
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const activePlacementKey = selectedTemplate ? `template:${selectedTemplate.id}` : selectedPlacementKey;
  const modeLabel = mode === 'terrain'
    ? TERRAIN_TOOL_LABELS[terrainTool]
    : selectedTemplate
      ? `Place ${selectedTemplate.name}`
      : selectedPlacementKey
        ? `Place ${CATALOG.find((item) => item.key === selectedPlacementKey)?.label}`
        : 'Select units';

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
          if (file) stageHeightmap(file);
          event.target.value = '';
        }}
        ref={heightmapRef}
        type="file"
      />

      <Dialog onOpenChange={setRepositoryWizardOpen} open={repositoryWizardOpen}>
        <DialogContent className="repository-wizard">
          <DialogHeader>
            <DialogTitle>Maps repository setup</DialogTitle>
            <DialogDescription>
              Diagnose the local checkout, choose a working branch, and publish map commits as pull requests into <code>main</code>.
            </DialogDescription>
          </DialogHeader>

          <section className="repository-wizard-summary">
            <div className={repositoryDiagnosticError ? 'diagnostic-row fail' : 'diagnostic-row pass'}>
              {repositoryDiagnosticError ? <AlertTriangle /> : <CheckCircle2 />}
              <span>
                <strong>{nativeRepositoryBridge ? 'Desktop repository bridge' : 'Loopback maps service'}</strong>
                <small>{repositoryDiagnosticError || (repositoryDiagnostics ? `${repositoryDiagnostics.service} is responding.` : 'Run diagnostics to check the connection.')}</small>
              </span>
            </div>
            {repositoryDiagnostics?.checks.map((check) => (
              <div className={`diagnostic-row ${check.status}`} key={check.id}>
                {check.status === 'fail' ? <AlertTriangle /> : check.status === 'warn' ? <CircleDot /> : <CheckCircle2 />}
                <span>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                  {check.fix && check.status !== 'pass' && <code>{check.fix}</code>}
                </span>
              </div>
            ))}
          </section>

          {repositoryCatalog && (
            <section className="repository-branch-panel">
              <div>
                <span>WORKING BRANCH</span>
                <strong>{repositoryCatalog.branch}</strong>
              </div>
              <label>
                Switch branch
                <select
                  disabled={repositoryBusy}
                  onChange={(event) => void changeRepositoryBranch(event.target.value, false)}
                  value={repositoryCatalog.branch}
                >
                  {repositoryCatalog.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              </label>
              <label>
                Create feature branch
                <span>
                  <input
                    onChange={(event) => setRepositoryBranchDraft(event.target.value)}
                    placeholder="maps/my-layout"
                    value={repositoryBranchDraft}
                  />
                  <button
                    disabled={repositoryBusy || !repositoryBranchDraft.trim()}
                    onClick={() => void changeRepositoryBranch(repositoryBranchDraft, true)}
                    type="button"
                  >Create</button>
                </span>
              </label>
              <p>Publishing from <code>main</code> automatically creates a timestamped feature branch. Publishing from another branch commits there and opens or updates its PR into <code>main</code>.</p>
            </section>
          )}

          <section className="repository-start-help">
            <strong>{nativeRepositoryBridge ? 'Checkout discovery' : 'Start the browser companion'}</strong>
            {nativeRepositoryBridge ? (
              <>
                <p>Choose the local <code>blackwatergaming/wulfram-maps</code> Git checkout if automatic discovery picked the wrong folder.</p>
                <button disabled={repositoryBusy} onClick={() => void configureRepository()} type="button"><FolderOpen /> Choose maps checkout</button>
              </>
            ) : (
              <>
                <p>Run one of these from the editor checkout, then retry. The service listens on loopback only.</p>
                <code>npm run dev</code>
                <code>npm run maps:serve</code>
                <code>$env:WULFRAM_MAPS_REPO=&apos;C:&#92;path&#92;to&#92;wulfram-maps&apos;</code>
                <small>Diagnostic endpoint: http://127.0.0.1:4319/diagnostics</small>
              </>
            )}
          </section>

          <DialogFooter className="repository-wizard-footer">
            <Button onClick={() => setRepositoryWizardOpen(false)} variant="outline">Done</Button>
            <Button disabled={repositoryDiagnosticBusy} onClick={() => void diagnoseRepository()}>
              <RefreshCw /> {repositoryDiagnosticBusy ? 'Checking…' : 'Retry diagnostics'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open) closeHeightmapDialog(); }} open={heightmapDialogOpen}>
        <DialogContent className="heightmap-dialog">
          <DialogHeader>
            <DialogTitle>Import grayscale heightmap</DialogTitle>
            <DialogDescription>
              Black maps to the minimum height and white maps to the maximum. Use smoothing to soften isolated image spikes before changing the terrain.
            </DialogDescription>
          </DialogHeader>
          <div className="heightmap-preview">
            {heightmapPreviewUrl && <img alt="Selected grayscale heightmap" src={heightmapPreviewUrl} />}
            <span>{heightmapFile?.name}</span>
          </div>
          <div className="heightmap-control-grid">
            <NumberField label="Minimum (black)" max={5000} min={-5000} onChange={(value) => setHeightmapRange(([_, maximum]) => [value, maximum])} value={heightmapRange[0]} />
            <NumberField label="Maximum (white)" max={5000} min={-5000} onChange={(value) => setHeightmapRange(([minimum]) => [minimum, value])} value={heightmapRange[1]} />
          </div>
          <div className="heightmap-curves">
            <RangeField label="Spike smoothing" max={6} min={0} onChange={setHeightmapSmoothing} step={1} suffix=" passes" value={heightmapSmoothing} />
            <RangeField label="Midtone curve" max={2.5} min={0.35} onChange={setHeightmapGamma} step={0.05} suffix="×" value={heightmapGamma} />
          </div>
          <div className="heightmap-presets">
            <button onClick={() => { setHeightmapRange([0, 120]); setHeightmapSmoothing(3); setHeightmapGamma(1); }} type="button">Gentle 0–120</button>
            <button onClick={() => { setHeightmapRange([0, 240]); setHeightmapSmoothing(2); setHeightmapGamma(1); }} type="button">Medium 0–240</button>
            <button onClick={() => { setHeightmapRange([0, 420]); setHeightmapSmoothing(0); setHeightmapGamma(1); }} type="button">Raw 0–420</button>
          </div>
          <p className="heightmap-note">Image resizing uses exact nearest-pixel sampling. Smoothing is an explicit terrain-height pass and can be set to zero.</p>
          <DialogFooter>
            <Button onClick={closeHeightmapDialog} variant="outline">Cancel</Button>
            <Button disabled={!heightmapFile} onClick={() => void importHeightmap()}><ImageIcon /> Apply heightmap</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <Button onClick={newMap} size="sm" title="New map" variant="ghost"><Plus /> New</Button>
          <Button onClick={() => importRef.current?.click()} size="sm" title="Import map or heightmap" variant="ghost"><FolderOpen /> Import</Button>
          <Button onClick={saveLocal} size="sm" title="Save locally" variant="ghost"><Save /> Save</Button>
          <Button onClick={() => void exportSource()} size="sm" title="Export Git source" variant="ghost"><FileArchive /> Source</Button>
          <Button onClick={exportJson} size="sm" title="Export server JSON" variant="ghost"><FileJson /> JSON</Button>
          <Button className="export-button" onClick={() => void exportMap()} size="sm" title="Export Wulfram package"><Download /> Export map</Button>
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
                    ['level', CircleDot, 'Flatten', '3'],
                    ['smooth', RotateCw, 'Smooth', '4'],
                    ['paint', Paintbrush, 'Paint texture', '5'],
                    ['stamp', Grid3X3, 'Set height', '6'],
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
                  <button className={team === 0 ? 'team-neutral active' : 'team-neutral'} onClick={() => setTeam(0)} type="button">NEUTRAL</button>
                  <button className={team === 1 ? 'team-one active' : 'team-one'} onClick={() => setTeam(1)} type="button">TEAM 1</button>
                  <button className={team === 2 ? 'team-two active' : 'team-two'} onClick={() => setTeam(2)} type="button">TEAM 2</button>
                </div>
              </section>
              <section className="panel-section template-library">
                <div className="section-heading"><p className="section-label">SHIPPED BASE TEMPLATES</p><span>{baseTemplates.templates.length}</span></div>
                <select
                  aria-label="Shipped base template"
                  className="template-select"
                  onChange={(event) => {
                    const templateId = event.target.value || undefined;
                    setSelectedTemplateId(templateId);
                    if (templateId) setSelectedPlacementKey('');
                    setSelectedEntityId(undefined);
                  }}
                  value={selectedTemplateId ?? ''}
                >
                  <option value="">Choose a discovered base…</option>
                  {baseTemplates.templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name} · {template.unitCount} units</option>
                  ))}
                </select>
                {selectedTemplate && (
                  <div className="template-controls">
                    <BaseTemplatePreview manifest={manifest} scale={templateScale} team={team} template={selectedTemplate} yawDegrees={templateYaw} />
                    <div className="template-summary">
                      <span><strong>{selectedTemplate.units.filter((unit) => hasModelForEntity({ token: unit.token, subtype: unit.subtype, team }, manifest)).length}</strong> modeled units</span>
                      <span>{Math.round(selectedTemplate.footprint.width)} × {Math.round(selectedTemplate.footprint.height)} u</span>
                    </div>
                    <RangeField label="Footprint scale" max={1.5} min={0.5} onChange={setTemplateScale} step={0.05} suffix="×" value={templateScale} />
                    <RangeField label="Formation yaw" max={360} min={0} onChange={setTemplateYaw} step={5} suffix="°" value={templateYaw} />
                    <div className="rotation-presets template-rotation-presets">
                      {[0, 90, 180, 270].map((degrees) => <button key={degrees} onClick={() => setTemplateYaw(degrees)} type="button">{degrees}°</button>)}
                    </div>
                    <p className="field-help">Click terrain to place. Every surviving model clears its full rendered underside and slope footprint. Shift-drag an existing unit to pick it up and retune it.</p>
                  </div>
                )}
              </section>
              <section className="catalog-list">
                {(['infrastructure', 'defense', 'support', 'logistics'] as const).map((category) => (
                  <div className="catalog-group" key={category}>
                    <p className="section-label">{category.toUpperCase()}</p>
                    {placeableCatalog.filter((item) => item.category === category).map((item) => (
                      <button
                        className={!selectedTemplate && selectedPlacementKey === item.key ? 'catalog-item active' : 'catalog-item'}
                        key={item.key}
                        onClick={() => { setSelectedPlacementKey(item.key); setSelectedTemplateId(undefined); setSelectedEntityId(undefined); }}
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
            <div
              className={`repository-controls ${repositoryCatalog ? 'online' : 'offline'}`}
              title={repositoryCatalog
                ? `${repositoryCatalog.repository} · ${repositoryCatalog.branch} · ${repositoryCatalog.changes} uncommitted map change(s)`
                : 'Start the editor with npm run dev to enable the loopback maps service.'}
            >
              <GitBranch aria-hidden="true" />
              <select
                aria-label="Repository map"
                disabled={!repositoryCatalog || repositoryBusy}
                onChange={(event) => setRepositorySlug(event.target.value)}
                value={repositoryCatalog ? repositorySlug : ''}
              >
                <option value="">{repositoryCatalog ? 'New repository map…' : repositoryChecked ? 'Maps service offline' : 'Checking maps…'}</option>
                {repositoryCatalog?.maps.map((map) => <option key={map.slug} value={map.slug}>{map.name} · {map.slug}</option>)}
              </select>
              <button aria-label="Repository setup and diagnostics" disabled={repositoryBusy} onClick={openRepositoryWizard} title="Repository setup, branches, and diagnostics" type="button"><Settings2 /></button>
              <button aria-label="Refresh repository maps" disabled={repositoryBusy} onClick={() => void refreshRepository(true)} title="Refresh repository maps" type="button"><RefreshCw /></button>
              <button disabled={!repositoryCatalog || !repositorySlug || repositoryBusy} onClick={() => void loadRepositorySelection()} title="Load selected Git source" type="button"><FolderOpen /><span>Load</span></button>
              <button disabled={!repositoryCatalog || repositoryBusy} onClick={() => void saveRepositorySelection(false)} title="Save canonical source to the local maps checkout" type="button"><Save /><span>Save</span></button>
              <button disabled={!repositoryCatalog || repositoryBusy} onClick={() => void saveRepositorySelection(true)} title="Save, commit to a feature branch, push, and open a PR into main" type="button"><Upload /><span>Publish PR</span></button>
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
            brushShape={brushShape}
            entities={project.entities}
            manifest={manifest}
            mode={mode}
            onCursor={updateCursor}
            onMoveEntity={moveEntity}
            onPlace={placeUnit}
            resolveEntityMove={resolveEntityMove}
            onSelectEntity={setSelectedEntityId}
            onTerrainStroke={onTerrainStroke}
            placementPreview={placementPreview}
            placementPreviewAnchor={cursor ? [cursor[0], cursor[1]] : undefined}
            selectedEntityId={selectedEntityId}
            selectedPlacementKey={activePlacementKey}
            serviceRadius={project.validation.serviceRadius}
            showGrid={showGrid}
            terrain={project.terrain}
            textureBlend={textureBlend}
            terrainTool={terrainTool}
          />
          <footer className={`statusbar ${notice.tone}`}>
            <span>{notice.tone === 'error' ? <AlertTriangle /> : notice.tone === 'working' ? <CircleDot /> : <CheckCircle2 />}{notice.text}</span>
            {lastPullRequestUrl && <a className="pull-request-link" href={lastPullRequestUrl} rel="noreferrer" target="_blank">Open PR <ExternalLink /></a>}
            {cursor && <span className="cursor-position">X {cursor[0].toFixed(1)} · Y {cursor[1].toFixed(1)} · Z {cursor[2].toFixed(1)}</span>}
            <span className="format-state">GIT SOURCE + WULFRAM PACKAGE</span>
          </footer>
        </section>

        <aside className="inspector">
          {mode === 'terrain' ? (
            <>
              <div className="inspector-heading">
                <span>INSPECTOR</span>
                <h2>{TERRAIN_TOOL_LABELS[terrainTool]} brush</h2>
                <Badge variant="secondary">TERRAIN</Badge>
              </div>
              <section className="inspector-block">
                <RangeField label="Radius / half-size" max={600} min={25} onChange={setBrushRadius} step={5} suffix=" u" value={brushRadius} />
                <RangeField label="Strength" max={100} min={1} onChange={setBrushStrength} suffix="%" value={brushStrength} />
                <RangeField label="Texture blend" max={100} min={0} onChange={setTextureBlend} suffix="%" value={textureBlend} />
                <fieldset className="brush-option-group">
                  <legend>FOOTPRINT</legend>
                  <div className="brush-option-buttons">
                    {(['round', 'square', 'diamond'] as const).map((shape) => (
                      <button className={brushShape === shape ? 'active' : ''} key={shape} onClick={() => setBrushShape(shape)} type="button">{shape}</button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="brush-option-group">
                  <legend>EDGE PROFILE</legend>
                  <div className="brush-option-buttons">
                    {(['soft', 'linear', 'hard'] as const).map((falloff) => (
                      <button className={brushFalloff === falloff ? 'active' : ''} key={falloff} onClick={() => setBrushFalloff(falloff)} type="button">{falloff}</button>
                    ))}
                  </div>
                </fieldset>
                <button
                  className="secondary-action flat-pad-preset"
                  onClick={() => {
                    setTerrainTool('level');
                    setBrushShape('square');
                    setBrushFalloff('hard');
                    setBrushStrength(100);
                    setNotice({ tone: 'ready', text: 'Flat-pad preset ready · click the terrain height the square should match' });
                  }}
                  type="button"
                ><Grid3X3 /> Flat pad preset</button>
                <div className={`brush-profile ${brushShape} ${brushFalloff}`}><span /><span /><span /></div>
                <p className="field-help">Square + Hard covers every vertex evenly: Raise/Lower moves a flat pad without doming, Flatten copies the first clicked height, and Set height targets an exact value. Texture IDs remain exact pixels.</p>
              </section>
              {terrainTool === 'stamp' && (
                <section className="inspector-block height-stamp-controls">
                  <p className="section-label">EXACT HEIGHT</p>
                  <NumberField label="Target terrain height" max={5000} min={-5000} onChange={setTerrainTargetHeight} step={0.25} value={terrainTargetHeight} />
                  <div className="height-stamp-actions">
                    <button onClick={() => setTerrainTargetHeight((height) => height - 10)} type="button">−10</button>
                    <button disabled={lastTerrainHeight === undefined} onClick={() => { if (lastTerrainHeight !== undefined) setTerrainTargetHeight(lastTerrainHeight); }} type="button">Sample last cursor</button>
                    <button onClick={() => setTerrainTargetHeight((height) => height + 10)} type="button">+10</button>
                  </div>
                  <p className="field-help">At 100% strength with a Hard edge, all covered vertices are written to this exact height in one pass.</p>
                </section>
              )}
              {terrainTool === 'paint' && (
                <section className="inspector-block selected-texture">
                  <p className="section-label">PAINT MATERIAL</p>
                  <img alt={selectedTexture} src={manifest.terrainTextures[selectedTexture]?.url} />
                  <div><strong>{selectedTexture}</strong><small>Direct tagmap2 entry · original palette</small></div>
                </section>
              )}
              <section className="inspector-block">
                <p className="section-label">GRAYSCALE IMAGE CONTROLS</p>
                <div className="number-grid two">
                  <NumberField label="Min / black" onChange={(value) => setHeightmapRange(([_, maximum]) => [value, maximum])} value={heightmapRange[0]} />
                  <NumberField label="Max / white" onChange={(value) => setHeightmapRange(([minimum]) => [minimum, value])} value={heightmapRange[1]} />
                </div>
                <div className="heightmap-inline-controls">
                  <RangeField label="Smoothing" max={6} min={0} onChange={setHeightmapSmoothing} step={1} value={heightmapSmoothing} />
                  <RangeField label="Midtone" max={2.5} min={0.35} onChange={setHeightmapGamma} step={0.05} suffix="×" value={heightmapGamma} />
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
                <Badge className={selectedEntity.team === 0 ? 'badge-team-neutral' : selectedEntity.team === 2 ? 'badge-team-two' : 'badge-team-one'}>{selectedEntity.team === 0 ? 'NEUTRAL' : `TEAM ${selectedEntity.team}`}</Badge>
              </div>
              <section className="inspector-block">
                <p className="section-label">POSITION</p>
                <div className="number-grid three">
                  {(['X', 'Y', 'Z'] as const).map((label, index) => (
                    <NumberField key={label} label={label} onChange={(value) => updateSelected((entity) => {
                      entity.position[index] = value;
                      if (index !== 2 && usesFootprintTerrainSnap(entity.token)) conformEntityToTerrain(entity, project.terrain);
                    })} step={0.1} value={selectedEntity.position[index]} />
                  ))}
                </div>
                <button className="secondary-action" onClick={() => updateSelected((entity) => conformEntityToTerrain(entity, project.terrain))} type="button"><Mountain /> Snap and conform to footprint</button>
              </section>
              <section className="inspector-block">
                <RangeField
                  label="Yaw"
                  max={360}
                  min={0}
                  onChange={(degrees) => updateSelected((entity) => {
                    entity.rotation[2] = degrees * Math.PI / 180;
                    if (usesFootprintTerrainSnap(entity.token)) conformEntityToTerrain(entity, project.terrain);
                  }, false)}
                  suffix="°"
                  value={(selectedEntity.rotation[2] * 180 / Math.PI + 360) % 360}
                />
                <div className="rotation-presets">
                  {[0, 45, 90, 180, 270].map((degrees) => <button key={degrees} onClick={() => updateSelected((entity) => {
                    entity.rotation[2] = degrees * Math.PI / 180;
                    if (usesFootprintTerrainSnap(entity.token)) conformEntityToTerrain(entity, project.terrain);
                  })} type="button">{degrees}°</button>)}
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
                <span>{selectedTemplate ? 'BASE TEMPLATE' : 'BASE BUILDER'}</span>
                <h2>{selectedTemplate?.name ?? 'Placement rules'}</h2>
                <Badge variant="secondary">{selectedTemplate ? `${selectedTemplate.unitCount} UNIT TEMPLATE` : `${project.entities.filter((entity) => entity.token !== '*').length} UNITS`}</Badge>
              </div>
              {selectedTemplate && (
                <section className="inspector-block template-detail">
                  <div><span>Source map</span><strong>{selectedTemplate.sourceMap}</strong></div>
                  <div><span>Original team</span><strong>{selectedTemplate.sourceTeam}</strong></div>
                  <div><span>Footprint</span><strong>{Math.round(selectedTemplate.footprint.width)} × {Math.round(selectedTemplate.footprint.height)} u</strong></div>
                  <p>Placement remaps the formation to {team === 0 ? 'Neutral' : `Team ${team}`}, rotates and scales its XY offsets, then conforms modeled units to the destination terrain.</p>
                </section>
              )}
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
