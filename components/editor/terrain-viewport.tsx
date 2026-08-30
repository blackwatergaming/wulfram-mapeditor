'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { cameraInputFromCodes, isCameraControlCode } from '@/lib/camera-controls';
import { textureBlendWeights } from '@/lib/terrain-blend';
import type { AssetManifest, ShapeModel, StateEntity, TerrainData } from '@/lib/wulfram';
import { catalogFor, modelNameFor, resolveTextureName, sampleHeight } from '@/lib/wulfram';

export type EditorMode = 'terrain' | 'base';
export type TerrainTool = 'sculpt' | 'lower' | 'level' | 'smooth' | 'paint';
export type StrokePhase = 'start' | 'move' | 'end';

interface TerrainViewportProps {
  terrain: TerrainData;
  entities: StateEntity[];
  manifest: AssetManifest;
  mode: EditorMode;
  terrainTool: TerrainTool;
  brushRadius: number;
  textureBlend: number;
  placementPreview: StateEntity[];
  placementPreviewAnchor?: [number, number];
  selectedEntityId?: string;
  selectedPlacementKey: string;
  serviceRadius: number;
  backupRadius: number;
  showGrid: boolean;
  onTerrainStroke: (x: number, y: number, phase: StrokePhase) => void;
  onPlace: (x: number, y: number) => void;
  onSelectEntity: (id?: string) => void;
  onCursor: (point?: [number, number, number]) => void;
}

const shapeCache = new Map<string, Promise<ShapeModel>>();
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const texturePixelCache = new Map<string, Promise<TexturePixels>>();
const materialTextureCache = new Map<string, THREE.Texture>();

interface TexturePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function loadShape(url: string): Promise<ShapeModel> {
  let pending = shapeCache.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
      return response.json() as Promise<ShapeModel>;
    });
    shapeCache.set(url, pending);
  }
  return pending;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Texture request failed: ${url}`));
      image.src = url;
    });
    imageCache.set(url, pending);
  }
  return pending;
}

function colorChannels(color: string): [number, number, number] {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return match
    ? [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)]
    : [91, 70, 56];
}

function loadTexturePixels(url: string): Promise<TexturePixels> {
  let pending = texturePixelCache.get(url);
  if (!pending) {
    pending = loadImage(url).then((image) => {
      const source = document.createElement('canvas');
      source.width = image.naturalWidth || image.width;
      source.height = image.naturalHeight || image.height;
      const context = source.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas texture decoding is unavailable.');
      context.drawImage(image, 0, 0);
      return {
        width: source.width,
        height: source.height,
        data: context.getImageData(0, 0, source.width, source.height).data,
      };
    });
    texturePixelCache.set(url, pending);
  }
  return pending;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
  });
  root.clear();
}

function terrainGeometry(terrain: TerrainData, scale: number): THREE.BufferGeometry {
  const count = terrain.width * terrain.height;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      const index = y * terrain.width + x;
      positions[index * 3] = (x / (terrain.width - 1) * terrain.worldWidth - terrain.worldWidth / 2) * scale;
      positions[index * 3 + 1] = (terrain.heights[index] ?? 0) * scale;
      positions[index * 3 + 2] = (y / (terrain.height - 1) * terrain.worldHeight - terrain.worldHeight / 2) * scale;
      uvs[index * 2] = x / (terrain.width - 1);
      uvs[index * 2 + 1] = 1 - y / (terrain.height - 1);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < terrain.height - 1; y += 1) {
    for (let x = 0; x < terrain.width - 1; x += 1) {
      const a = y * terrain.width + x;
      const b = a + 1;
      const c = a + terrain.width;
      const d = c + 1;
      if (((x ^ y) & 1) === 1) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function updateTerrainHeights(geometry: THREE.BufferGeometry, terrain: TerrainData, scale: number) {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positions || positions.count !== terrain.width * terrain.height) return;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, (terrain.heights[index] ?? 0) * scale);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function terrainTextureDimensions(terrain: TerrainData) {
  const tile = Math.max(2, Math.min(7, Math.floor(896 / Math.max(terrain.width, terrain.height))));
  return { tile, width: terrain.width * tile, height: terrain.height * tile };
}

async function paintTerrainCanvas(
  canvas: HTMLCanvasElement,
  terrain: TerrainData,
  manifest: AssetManifest,
  texture: THREE.CanvasTexture,
  blendStrength: number,
  cancelled: () => boolean,
  invalidate: () => void,
) {
  const dimensions = terrainTextureDimensions(terrain);
  if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
  if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  const { tile } = dimensions;
  context.imageSmoothingEnabled = false;

  const names = terrain.tagmap2.map((line) => resolveTextureName(line, manifest.terrainTextures));
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      const id = terrain.textureIds[y * terrain.width + x] ?? 0;
      const asset = names[id] ? manifest.terrainTextures[names[id]!] : undefined;
      context.fillStyle = asset?.average ?? '#5b4638';
      context.fillRect(x * tile, y * tile, tile, tile);
    }
  }
  texture.needsUpdate = true;
  invalidate();

  const used = new Set(terrain.textureIds.map((id) => names[id]).filter(Boolean) as string[]);
  const loaded = new Map<number, TexturePixels>();
  await Promise.all([...used].map(async (name) => {
    const asset = manifest.terrainTextures[name];
    if (!asset) return;
    try {
      for (let id = 0; id < names.length; id += 1) {
        if (names[id] === name) loaded.set(id, await loadTexturePixels(asset.url));
      }
    } catch {
      // The average-color base remains a valid preview if one source bitmap fails.
    }
  }));
  if (cancelled()) return;
  const output = context.createImageData(canvas.width, canvas.height);
  const softness = Math.max(0, Math.min(1, blendStrength / 100));
  const repeatPixels = Math.max(24, tile * 5);
  const fallbackById = new Map<number, [number, number, number]>();
  for (const id of new Set(terrain.textureIds)) {
    const asset = names[id] ? manifest.terrainTextures[names[id]!] : undefined;
    fallbackById.set(id, colorChannels(asset?.average ?? '#5b4638'));
  }
  const maximumGridX = terrain.width - 1;
  const maximumGridY = terrain.height - 1;
  const ids: [number, number, number, number] = [0, 0, 0, 0];
  const weights: [number, number, number, number] = [0, 0, 0, 0];
  for (let pixelY = 0; pixelY < canvas.height; pixelY += 1) {
    const gridY = pixelY / Math.max(1, canvas.height - 1) * maximumGridY;
    const y0 = Math.min(maximumGridY, Math.floor(gridY));
    const y1 = Math.min(maximumGridY, y0 + 1);
    const fractionY = gridY - y0;
    for (let pixelX = 0; pixelX < canvas.width; pixelX += 1) {
      const gridX = pixelX / Math.max(1, canvas.width - 1) * maximumGridX;
      const x0 = Math.min(maximumGridX, Math.floor(gridX));
      const x1 = Math.min(maximumGridX, x0 + 1);
      const fractionX = gridX - x0;
      ids[0] = terrain.textureIds[y0 * terrain.width + x0] ?? 0;
      ids[1] = terrain.textureIds[y0 * terrain.width + x1] ?? 0;
      ids[2] = terrain.textureIds[y1 * terrain.width + x0] ?? 0;
      ids[3] = terrain.textureIds[y1 * terrain.width + x1] ?? 0;
      textureBlendWeights(fractionX, fractionY, softness, ((x0 ^ y0) & 1) === 1, weights);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let corner = 0; corner < 4; corner += 1) {
        const weight = weights[corner];
        if (!weight) continue;
        const textureId = ids[corner];
        const pixels = loaded.get(textureId);
        if (pixels) {
          const sourceX = Math.floor(pixelX % repeatPixels / repeatPixels * pixels.width) % pixels.width;
          const sourceY = Math.floor(pixelY % repeatPixels / repeatPixels * pixels.height) % pixels.height;
          const sourceIndex = (sourceY * pixels.width + sourceX) * 4;
          red += pixels.data[sourceIndex] * weight;
          green += pixels.data[sourceIndex + 1] * weight;
          blue += pixels.data[sourceIndex + 2] * weight;
        } else {
          const fallback = fallbackById.get(textureId) ?? [91, 70, 56];
          red += fallback[0] * weight;
          green += fallback[1] * weight;
          blue += fallback[2] * weight;
        }
      }
      const outputIndex = (pixelY * canvas.width + pixelX) * 4;
      output.data[outputIndex] = red;
      output.data[outputIndex + 1] = green;
      output.data[outputIndex + 2] = blue;
      output.data[outputIndex + 3] = 255;
    }
    if (pixelY % 48 === 47) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled()) return;
    }
  }
  if (cancelled()) return;
  context.putImageData(output, 0, 0);
  texture.needsUpdate = true;
  invalidate();
}

function materialTexture(url: string, invalidate: () => void): THREE.Texture {
  const cached = materialTextureCache.get(url);
  if (cached) return cached;
  const texture = new THREE.TextureLoader().load(url, invalidate);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  materialTextureCache.set(url, texture);
  return texture;
}

function fallbackUnit(entity: StateEntity, scale: number): THREE.Group {
  const group = new THREE.Group();
  const teamColor = entity.team === 0 ? 0x9aa1a5 : entity.team === 2 ? 0x5d91d8 : 0xd56542;
  const item = catalogFor(entity);
  const radius = Math.max(0.3, (item?.footprint ?? 8) * scale * 0.45);
  let geometry: THREE.BufferGeometry;
  if (entity.token === 'e') geometry = new THREE.CylinderGeometry(radius, radius * 1.1, radius * 0.9, 10);
  else if (entity.token === 'u') geometry = new THREE.ConeGeometry(radius, radius * 2.2, 6);
  else geometry = new THREE.BoxGeometry(radius * 1.5, radius, radius * 1.5);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.68, metalness: 0.28 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

function stylePlacementGhost(root: THREE.Object3D, team: number) {
  const accent = new THREE.Color(team === 0 ? 0xd8dcde : team === 2 ? 0x6eafff : 0xff8b68);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = 0.62;
      material.depthWrite = false;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.lerp(accent, 0.42);
        material.emissive.copy(accent);
        material.emissiveIntensity = 0.22;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
      }
    }
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 12;
    mesh.raycast = () => undefined;
  });
}

interface PlacementHolderParts {
  holder: THREE.Group;
  modelHolder: THREE.Group;
  footprint: THREE.Mesh;
}

function positionPlacementGhosts(
  root: THREE.Group,
  holders: Map<string, PlacementHolderParts>,
  preview: StateEntity[],
  terrain: TerrainData,
  mode: EditorMode,
  scale: number,
) {
  root.position.set(0, 0, 0);
  const activeIds = new Set(preview.map((entity) => entity.id));
  for (const [id, parts] of holders) parts.holder.visible = activeIds.has(id);
  for (const entity of preview) {
    const parts = holders.get(entity.id);
    if (!parts) continue;
    parts.holder.position.set(
      (entity.position[0] - terrain.worldWidth / 2) * scale,
      entity.position[2] * scale,
      (entity.position[1] - terrain.worldHeight / 2) * scale,
    );
    parts.modelHolder.rotation.set(-entity.rotation[0], -entity.rotation[2], -entity.rotation[1], 'YXZ');
    parts.footprint.position.y = (sampleHeight(terrain, entity.position[0], entity.position[1]) - entity.position[2]) * scale + 0.04;
  }
  root.visible = mode === 'base' && preview.length > 0;
}

async function originalUnit(
  entity: StateEntity,
  manifest: AssetManifest,
  scale: number,
  invalidate: () => void,
): Promise<THREE.Group | undefined> {
  const name = modelNameFor(entity);
  const asset = name ? manifest.models[name] : undefined;
  if (!asset) return undefined;
  const shape = await loadShape(asset.url);
  const group = new THREE.Group();
  const modelScale = scale * 2.1;
  for (const part of shape.meshes) {
    const positions = new Float32Array(part.positions.length);
    for (let index = 0; index < part.positions.length; index += 3) {
      positions[index] = part.positions[index] * modelScale;
      positions[index + 1] = part.positions[index + 2] * modelScale;
      positions[index + 2] = -part.positions[index + 1] * modelScale;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (part.uvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
    geometry.computeVertexNormals();
    const materialName = shape.materials[part.materialIndex];
    const materialAsset = manifest.materials[materialName];
    const material = new THREE.MeshStandardMaterial({
      color: materialAsset ? (entity.team === 0 ? 0xb8b8b8 : 0xffffff) : entity.team === 0 ? 0x9ca3a6 : entity.team === 2 ? 0x688fcb : 0xc56b4c,
      roughness: 0.72,
      metalness: 0.2,
    });
    if (materialAsset) {
      material.map = materialTexture(materialAsset.url, invalidate);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function TerrainViewport({
  terrain,
  entities,
  manifest,
  mode,
  terrainTool,
  brushRadius,
  textureBlend,
  placementPreview,
  placementPreviewAnchor,
  selectedEntityId,
  selectedPlacementKey,
  serviceRadius,
  backupRadius,
  showGrid,
  onTerrainStroke,
  onPlace,
  onSelectEntity,
  onCursor,
}: TerrainViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const terrainRootRef = useRef(new THREE.Group());
  const entityRootRef = useRef(new THREE.Group());
  const placementRootRef = useRef(new THREE.Group());
  const placementHoldersRef = useRef(new Map<string, PlacementHolderParts>());
  const placementPreviewRef = useRef(placementPreview);
  const placementPreviewAnchorRef = useRef(placementPreviewAnchor);
  const terrainMeshRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const terrainTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const gridRef = useRef<THREE.Mesh | null>(null);
  const brushRef = useRef<THREE.Mesh | null>(null);
  const invalidateRef = useRef<(updateShadows?: boolean) => void>(() => undefined);
  const scaleRef = useRef(160 / Math.max(terrain.worldWidth, terrain.worldHeight));
  const propsRef = useRef({ mode, terrainTool, selectedPlacementKey, onTerrainStroke, onPlace, onSelectEntity, onCursor });
  const entitiesRef = useRef(entities);
  const terrainRef = useRef(terrain);
  const strokeRef = useRef(false);
  const entitySceneKey = useMemo(
    () => entities.map((entity) => `${entity.id}:${entity.token}:${entity.subtype ?? ''}:${entity.team}:${entity.position.join(',')}:${entity.rotation.join(',')}:${entity.active}`).join('|'),
    [entities],
  );
  const placementModelKey = useMemo(
    () => placementPreview.map((entity) => `${entity.id}:${entity.token}:${entity.subtype ?? ''}:${entity.team}`).join('|'),
    [placementPreview],
  );

  useEffect(() => {
    entitiesRef.current = entities;
    terrainRef.current = terrain;
  }, [entities, terrain]);

  useEffect(() => {
    placementPreviewRef.current = placementPreview;
    placementPreviewAnchorRef.current = placementPreviewAnchor;
  }, [placementPreview, placementPreviewAnchor]);

  useEffect(() => {
    propsRef.current = { mode, terrainTool, selectedPlacementKey, onTerrainStroke, onPlace, onSelectEntity, onCursor };
  }, [mode, onCursor, onPlace, onSelectEntity, onTerrainStroke, selectedPlacementKey, terrainTool]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const placementRoot = placementRootRef.current;
    const placementHolders = placementHoldersRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0e10);
    scene.fog = new THREE.Fog(0x0c0e10, 145, 270);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 500);
    camera.position.set(102, 84, 108);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D map viewport. Use W A S D to pan, arrow keys to turn and tilt, Q and E or plus and minus to zoom, and Home to reset the camera.');
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 0;
    controls.maxDistance = 260;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;

    scene.add(new THREE.HemisphereLight(0xd9e7ee, 0x382619, 1.7));
    const sun = new THREE.DirectionalLight(0xffd2a1, 2.2);
    sun.position.set(-70, 110, -45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -110;
    sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 110;
    sun.shadow.camera.bottom = -110;
    scene.add(sun);
    scene.add(terrainRootRef.current, entityRootRef.current, placementRoot);

    const brush = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffa15f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
    brush.rotation.x = -Math.PI / 2;
    brush.renderOrder = 20;
    brush.visible = false;
    scene.add(brush);
    brushRef.current = brush;

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const pressedCodes = new Set<string>();
    let interacting = false;
    let frame = 0;
    let previousFrameTime = performance.now();
    const initialPosition = new THREE.Vector3(102, 84, 108);
    const initialTarget = new THREE.Vector3(0, 0, 0);

    const moveKeyboardCamera = (deltaSeconds: number) => {
      const input = cameraInputFromCodes(pressedCodes);
      if (!input.panForward && !input.panRight && !input.yaw && !input.tilt && !input.zoom) return false;
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.max(controls.minDistance, offset.length());
      if (input.panForward || input.panRight) {
        const forward = controls.target.clone().sub(camera.position).setY(0);
        if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        const direction = forward.multiplyScalar(input.panForward).add(right.multiplyScalar(input.panRight));
        if (direction.lengthSq() > 1) direction.normalize();
        const movement = direction.multiplyScalar(Math.max(8, distance * 0.72) * deltaSeconds);
        camera.position.add(movement);
        controls.target.add(movement);
      }
      if (input.yaw) offset.applyAxisAngle(camera.up, -input.yaw * 1.25 * deltaSeconds);
      if (input.tilt) {
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.phi = THREE.MathUtils.clamp(
          spherical.phi - input.tilt * 0.95 * deltaSeconds,
          0.12,
          controls.maxPolarAngle,
        );
        offset.setFromSpherical(spherical);
      }
      if (input.zoom) {
        const nextDistance = THREE.MathUtils.clamp(
          offset.length() * Math.exp(-input.zoom * 1.5 * deltaSeconds),
          controls.minDistance,
          controls.maxDistance,
        );
        offset.setLength(nextDistance);
      }
      camera.position.copy(controls.target).add(offset);
      return true;
    };

    const renderFrame = (time: number) => {
      frame = 0;
      const deltaSeconds = Math.min(0.05, Math.max(0.001, (time - previousFrameTime) / 1000));
      previousFrameTime = time;
      const keyboardMoved = moveKeyboardCamera(deltaSeconds);
      const controlsMoved = controls.update();
      renderer.render(scene, camera);
      if (keyboardMoved || pressedCodes.size > 0 || interacting || controlsMoved) requestRender();
    };
    const requestRender = (updateShadows = false) => {
      if (updateShadows) renderer.shadowMap.needsUpdate = true;
      if (!frame) {
        previousFrameTime = performance.now();
        frame = requestAnimationFrame(renderFrame);
      }
    };
    invalidateRef.current = requestRender;

    const controlsChanged = () => requestRender();
    const controlsStarted = () => { interacting = true; requestRender(); };
    const controlsEnded = () => { interacting = false; requestRender(); };
    controls.addEventListener('change', controlsChanged);
    controls.addEventListener('start', controlsStarted);
    controls.addEventListener('end', controlsEnded);

    const keyboardEnabled = () => document.activeElement === renderer.domElement || renderer.domElement.matches(':hover');
    const editingText = (target: EventTarget | null) => target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]');
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingText(event.target) || event.ctrlKey || event.metaKey || event.altKey || !keyboardEnabled()) return;
      if (event.code === 'Home') {
        event.preventDefault();
        camera.position.copy(initialPosition);
        controls.target.copy(initialTarget);
        controls.update();
        requestRender();
        return;
      }
      if (!isCameraControlCode(event.code)) return;
      event.preventDefault();
      pressedCodes.add(event.code);
      requestRender();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!pressedCodes.delete(event.code)) return;
      event.preventDefault();
      requestRender();
    };
    const clearPressedCodes = () => pressedCodes.clear();
    const focusViewport = () => renderer.domElement.focus({ preventScroll: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearPressedCodes);
    renderer.domElement.addEventListener('pointerdown', focusViewport);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    requestRender(true);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', controlsChanged);
      controls.removeEventListener('start', controlsStarted);
      controls.removeEventListener('end', controlsEnded);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearPressedCodes);
      renderer.domElement.removeEventListener('pointerdown', focusViewport);
      controls.dispose();
      disposeTree(placementRoot);
      placementHolders.clear();
      renderer.dispose();
      brush.geometry.dispose();
      (brush.material as THREE.Material).dispose();
      renderer.domElement.remove();
      invalidateRef.current = () => undefined;
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const root = terrainRootRef.current;
    const currentTerrain = terrainRef.current;
    terrainTextureRef.current?.dispose();
    disposeTree(root);
    const scale = 160 / Math.max(currentTerrain.worldWidth, currentTerrain.worldHeight);
    scaleRef.current = scale;
    const geometry = terrainGeometry(currentTerrain, scale);
    const canvas = document.createElement('canvas');
    const textureDimensions = terrainTextureDimensions(currentTerrain);
    canvas.width = textureDimensions.width;
    canvas.height = textureDimensions.height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    const material = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData.terrain = true;
    root.add(mesh);
    terrainMeshRef.current = mesh;
    terrainCanvasRef.current = canvas;
    terrainTextureRef.current = texture;
    invalidateRef.current(true);
    return () => {
      if (terrainMeshRef.current === mesh) {
        terrainMeshRef.current = null;
        terrainCanvasRef.current = null;
        terrainTextureRef.current = null;
      }
      texture.dispose();
      disposeTree(root);
    };
  }, [terrain.height, terrain.width, terrain.worldHeight, terrain.worldWidth]);

  useEffect(() => {
    const mesh = terrainMeshRef.current;
    if (!mesh) return;
    updateTerrainHeights(mesh.geometry, terrainRef.current, scaleRef.current);
    invalidateRef.current(!strokeRef.current);
  }, [terrain.height, terrain.heights, terrain.width, terrain.worldHeight, terrain.worldWidth]);

  useEffect(() => {
    const root = terrainRootRef.current;
    const previous = gridRef.current;
    if (previous) {
      root.remove(previous);
      (previous.material as THREE.Material).dispose();
      gridRef.current = null;
    }
    const mesh = terrainMeshRef.current;
    if (!showGrid || !mesh) {
      invalidateRef.current();
      return;
    }
    const wire = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({ color: 0xffd0a0, wireframe: true, transparent: true, opacity: 0.075, depthWrite: false }),
    );
    wire.position.y = 0.012;
    wire.raycast = () => undefined;
    root.add(wire);
    gridRef.current = wire;
    invalidateRef.current();
    return () => {
      if (gridRef.current === wire) gridRef.current = null;
      root.remove(wire);
      (wire.material as THREE.Material).dispose();
    };
  }, [showGrid, terrain.height, terrain.width, terrain.worldHeight, terrain.worldWidth]);

  useEffect(() => {
    const canvas = terrainCanvasRef.current;
    const texture = terrainTextureRef.current;
    if (!canvas || !texture) return;
    const currentTerrain = terrainRef.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void paintTerrainCanvas(
        canvas,
        currentTerrain,
        manifest,
        texture,
        textureBlend,
        () => cancelled,
        () => invalidateRef.current(),
      );
    }, 42);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [manifest, terrain.height, terrain.tagmap2, terrain.textureIds, terrain.width, textureBlend]);

  useEffect(() => {
    const root = entityRootRef.current;
    disposeTree(root);
    let cancelled = false;
    const scale = scaleRef.current;
    for (const entity of entitiesRef.current.filter((item) => item.token !== '*')) {
      const holder = new THREE.Group();
      holder.userData.entityId = entity.id;
      holder.position.set(
        (entity.position[0] - terrain.worldWidth / 2) * scale,
        entity.position[2] * scale,
        (entity.position[1] - terrain.worldHeight / 2) * scale,
      );
      root.add(holder);
      const modelHolder = new THREE.Group();
      modelHolder.userData.entityId = entity.id;
      modelHolder.rotation.set(-entity.rotation[0], -entity.rotation[2], -entity.rotation[1], 'YXZ');
      holder.add(modelHolder);
      const placeholder = fallbackUnit(entity, scale);
      placeholder.userData.entityId = entity.id;
      modelHolder.add(placeholder);
      void originalUnit(entity, manifest, scale, () => invalidateRef.current()).then((model) => {
        if (!model) return;
        if (cancelled || !modelHolder.parent) {
          disposeTree(model);
          return;
        }
        disposeTree(placeholder);
        modelHolder.remove(placeholder);
        model.userData.entityId = entity.id;
        model.traverse((part) => { part.userData.entityId = entity.id; });
        modelHolder.add(model);
        invalidateRef.current(true);
      }).catch(() => undefined);

      if (entity.id === selectedEntityId) {
        const footprint = catalogFor(entity)?.footprint ?? 10;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(footprint * scale * 0.9, footprint * scale, 48),
          new THREE.MeshBasicMaterial({ color: 0xffb169, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }),
        );
        ring.raycast = () => undefined;
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -entity.position[2] * scale + 0.025;
        ring.renderOrder = 30;
        holder.add(ring);
      }
      if (entity.token === 'e' && (entity.id === selectedEntityId || mode === 'base')) {
        const radius = serviceRadius * scale;
        const rangeColor = entity.team === 0 ? 0xaeb5b9 : entity.team === 2 ? 0x65a6ff : 0xff7659;
        const range = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0, radius - 0.08), radius, 96),
          new THREE.MeshBasicMaterial({ color: rangeColor, transparent: true, opacity: entity.id === selectedEntityId ? 0.45 : 0.16, side: THREE.DoubleSide, depthWrite: false }),
        );
        range.raycast = () => undefined;
        range.rotation.x = -Math.PI / 2;
        range.position.y = -entity.position[2] * scale + 0.018;
        holder.add(range);
        const backup = backupRadius * scale;
        const backupRange = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0, backup - 0.06), backup, 64),
          new THREE.MeshBasicMaterial({ color: 0xf6c16f, transparent: true, opacity: entity.id === selectedEntityId ? 0.7 : 0.22, side: THREE.DoubleSide, depthWrite: false }),
        );
        backupRange.raycast = () => undefined;
        backupRange.rotation.x = -Math.PI / 2;
        backupRange.position.y = -entity.position[2] * scale + 0.022;
        holder.add(backupRange);
      }
    }
    invalidateRef.current(true);
    return () => { cancelled = true; };
  }, [backupRadius, entitySceneKey, manifest, mode, selectedEntityId, serviceRadius, terrain.worldHeight, terrain.worldWidth]);

  useEffect(() => {
    const root = placementRootRef.current;
    const holders = placementHoldersRef.current;
    disposeTree(root);
    holders.clear();
    root.position.set(0, 0, 0);
    const blueprints = placementPreviewRef.current;
    if (mode !== 'base' || !blueprints.length) {
      root.visible = false;
      invalidateRef.current();
      return;
    }

    let cancelled = false;
    const scale = scaleRef.current;
    root.visible = true;
    for (const entity of blueprints) {
      const holder = new THREE.Group();
      const modelHolder = new THREE.Group();
      const placeholder = fallbackUnit(entity, scale);
      stylePlacementGhost(placeholder, entity.team);
      modelHolder.add(placeholder);
      holder.add(modelHolder);

      const footprintRadius = Math.max(0.25, (catalogFor(entity)?.footprint ?? 10) * scale * 0.5);
      const footprint = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0, footprintRadius - 0.055), footprintRadius, 40),
        new THREE.MeshBasicMaterial({
          color: entity.team === 0 ? 0xd8dcde : entity.team === 2 ? 0x6eafff : 0xff8b68,
          transparent: true,
          opacity: 0.68,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      footprint.rotation.x = -Math.PI / 2;
      footprint.renderOrder = 13;
      footprint.raycast = () => undefined;
      holder.add(footprint);
      root.add(holder);
      holders.set(entity.id, { holder, modelHolder, footprint });

      void originalUnit(entity, manifest, scale, () => invalidateRef.current()).then((model) => {
        if (!model) return;
        if (cancelled || !modelHolder.parent) {
          disposeTree(model);
          return;
        }
        stylePlacementGhost(model, entity.team);
        disposeTree(placeholder);
        modelHolder.remove(placeholder);
        modelHolder.add(model);
        invalidateRef.current();
      }).catch(() => undefined);
    }
    invalidateRef.current();
    return () => { cancelled = true; };
  }, [manifest, mode, placementModelKey]);

  useEffect(() => {
    const root = placementRootRef.current;
    const holders = placementHoldersRef.current;
    placementPreviewAnchorRef.current = placementPreviewAnchor;
    positionPlacementGhosts(root, holders, placementPreview, terrain, mode, scaleRef.current);
    invalidateRef.current();
  }, [mode, placementPreview, placementPreviewAnchor, terrain]);

  useEffect(() => {
    const brush = brushRef.current;
    if (!brush) return;
    const diameter = brushRadius * scaleRef.current;
    brush.scale.set(diameter, diameter, diameter);
    invalidateRef.current();
  }, [brushRadius]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const container = containerRef.current;
    if (!renderer || !camera || !controls || !container) return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const hit = (clientX: number, clientY: number, includeEntities = false) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const terrainMesh = terrainMeshRef.current;
      const targets: THREE.Object3D[] = includeEntities ? [entityRootRef.current] : [];
      if (terrainMesh) targets.push(terrainMesh);
      return raycaster.intersectObjects(targets, true);
    };
    const terrainPoint = (intersections: THREE.Intersection[]) => intersections.find((result) => {
      let object: THREE.Object3D | null = result.object;
      while (object) {
        if (object.userData.terrain) return true;
        object = object.parent;
      }
      return false;
    });
    const entityId = (object: THREE.Object3D): string | undefined => {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (typeof current.userData.entityId === 'string') return current.userData.entityId;
        current = current.parent;
      }
      return undefined;
    };
    const toWorld = (point: THREE.Vector3): [number, number, number] => {
      const scale = scaleRef.current;
      return [
        point.x / scale + terrain.worldWidth / 2,
        point.z / scale + terrain.worldHeight / 2,
        point.y / scale,
      ];
    };
    let lastCursorUpdate = 0;
    let cursorVisible = false;
    const publishCursor = (point?: [number, number, number]) => {
      if (!point) {
        if (cursorVisible) propsRef.current.onCursor(undefined);
        cursorVisible = false;
        return;
      }
      const now = performance.now();
      if (!cursorVisible || now - lastCursorUpdate >= 75) {
        propsRef.current.onCursor(point);
        lastCursorUpdate = now;
      }
      cursorVisible = true;
    };
    const moveBrush = (result?: THREE.Intersection) => {
      const brush = brushRef.current;
      if (!brush) return;
      brush.visible = Boolean(result) && propsRef.current.mode === 'terrain';
      if (result) {
        brush.position.copy(result.point);
        brush.position.y += 0.08;
        const world = toWorld(result.point);
        publishCursor(world);
        const previewAnchor = placementPreviewAnchorRef.current;
        if (propsRef.current.mode === 'base' && previewAnchor) {
          placementRootRef.current.position.set(
            (world[0] - previewAnchor[0]) * scaleRef.current,
            0,
            (world[1] - previewAnchor[1]) * scaleRef.current,
          );
          placementRootRef.current.visible = placementHoldersRef.current.size > 0;
        }
      } else {
        publishCursor(undefined);
        placementRootRef.current.visible = false;
      }
      invalidateRef.current();
    };
    let pointerFrame = 0;
    let latestPointer: { clientX: number; clientY: number } | undefined;
    const processPointerMove = () => {
      pointerFrame = 0;
      if (!latestPointer) return;
      const intersections = hit(latestPointer.clientX, latestPointer.clientY);
      const ground = terrainPoint(intersections);
      moveBrush(ground);
      if (strokeRef.current && ground) {
        const [x, y] = toWorld(ground.point);
        propsRef.current.onTerrainStroke(x, y, 'move');
      }
    };
    const flushPointerMove = () => {
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      processPointerMove();
      latestPointer = undefined;
    };
    const onPointerMove = (event: PointerEvent) => {
      if ((event.buttons & 2) !== 0) return;
      latestPointer = { clientX: event.clientX, clientY: event.clientY };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(processPointerMove);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      renderer.domElement.focus({ preventScroll: true });
      const intersections = hit(event.clientX, event.clientY, propsRef.current.mode === 'base');
      const unitHit = intersections.find((result) => entityId(result.object));
      if (propsRef.current.mode === 'base' && unitHit) {
        propsRef.current.onSelectEntity(entityId(unitHit.object));
        return;
      }
      const ground = terrainPoint(intersections);
      if (!ground) return;
      const [x, y] = toWorld(ground.point);
      if (propsRef.current.mode === 'base') {
        if (propsRef.current.selectedPlacementKey) propsRef.current.onPlace(x, y);
        else propsRef.current.onSelectEntity(undefined);
      } else {
        strokeRef.current = true;
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        propsRef.current.onTerrainStroke(x, y, 'start');
      }
    };
    const endStroke = (event: PointerEvent) => {
      if (!strokeRef.current) return;
      flushPointerMove();
      strokeRef.current = false;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      propsRef.current.onTerrainStroke(0, 0, 'end');
      invalidateRef.current(true);
    };
    const onLeave = () => {
      if (brushRef.current) brushRef.current.visible = false;
      placementRootRef.current.visible = false;
      publishCursor(undefined);
      invalidateRef.current();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    renderer.domElement.addEventListener('pointerup', endStroke);
    renderer.domElement.addEventListener('pointercancel', endStroke);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    return () => {
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('pointerup', endStroke);
      renderer.domElement.removeEventListener('pointercancel', endStroke);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
    };
  }, [terrain.worldHeight, terrain.worldWidth]);

  return (
    <div className="terrain-viewport" ref={containerRef}>
      <div className="viewport-badges" aria-hidden="true">
        <span>3D PERSPECTIVE</span>
        <span>ORIGINAL TEXTURES</span>
        {mode === 'base' && placementPreview.length > 0 && (
          <span className="placement-preview-badge">PLACEMENT PREVIEW · {placementPreview.length} {placementPreview.length === 1 ? 'UNIT' : 'UNITS'}</span>
        )}
      </div>
      <div className="viewport-help">
        <span>Mouse · Left edit/place · Right orbit · Wheel zoom</span>
        <span>Keys · WASD pan · Arrows turn/tilt · Q/E or +/− zoom · Home reset</span>
      </div>
    </div>
  );
}
