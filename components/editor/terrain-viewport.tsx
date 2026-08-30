'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { textureBlendContributions } from '@/lib/terrain-blend';
import type { AssetManifest, ShapeModel, StateEntity, TerrainData } from '@/lib/wulfram';
import { catalogFor, modelNameFor, resolveTextureName } from '@/lib/wulfram';

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

async function paintTerrainCanvas(
  canvas: HTMLCanvasElement,
  terrain: TerrainData,
  manifest: AssetManifest,
  texture: THREE.CanvasTexture,
  blendStrength: number,
  cancelled: () => boolean,
) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  const tile = Math.max(2, Math.min(7, Math.floor(896 / Math.max(terrain.width, terrain.height))));
  canvas.width = terrain.width * tile;
  canvas.height = terrain.height * tile;
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
      const ids: [number, number, number, number] = [
        terrain.textureIds[y0 * terrain.width + x0] ?? 0,
        terrain.textureIds[y0 * terrain.width + x1] ?? 0,
        terrain.textureIds[y1 * terrain.width + x0] ?? 0,
        terrain.textureIds[y1 * terrain.width + x1] ?? 0,
      ];
      const contributions = textureBlendContributions(ids, fractionX, fractionY, softness, ((x0 ^ y0) & 1) === 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const contribution of contributions) {
        const pixels = loaded.get(contribution.textureId);
        if (pixels) {
          const sourceX = Math.floor(pixelX % repeatPixels / repeatPixels * pixels.width) % pixels.width;
          const sourceY = Math.floor(pixelY % repeatPixels / repeatPixels * pixels.height) % pixels.height;
          const sourceIndex = (sourceY * pixels.width + sourceX) * 4;
          red += pixels.data[sourceIndex] * contribution.weight;
          green += pixels.data[sourceIndex + 1] * contribution.weight;
          blue += pixels.data[sourceIndex + 2] * contribution.weight;
        } else {
          const fallback = fallbackById.get(contribution.textureId) ?? [91, 70, 56];
          red += fallback[0] * contribution.weight;
          green += fallback[1] * contribution.weight;
          blue += fallback[2] * contribution.weight;
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
  context.putImageData(output, 0, 0);
  texture.needsUpdate = true;
}

function fallbackUnit(entity: StateEntity, scale: number): THREE.Group {
  const group = new THREE.Group();
  const teamColor = entity.team === 2 ? 0x5d91d8 : 0xd56542;
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

async function originalUnit(
  entity: StateEntity,
  manifest: AssetManifest,
  scale: number,
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
      color: materialAsset ? 0xffffff : entity.team === 2 ? 0x688fcb : 0xc56b4c,
      roughness: 0.72,
      metalness: 0.2,
    });
    if (materialAsset) {
      const map = new THREE.TextureLoader().load(materialAsset.url);
      map.colorSpace = THREE.SRGBColorSpace;
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapLinearFilter;
      material.map = map;
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
  const brushRef = useRef<THREE.Mesh | null>(null);
  const scaleRef = useRef(160 / Math.max(terrain.worldWidth, terrain.worldHeight));
  const propsRef = useRef({ mode, terrainTool, selectedPlacementKey, onTerrainStroke, onPlace, onSelectEntity, onCursor });
  const strokeRef = useRef(false);

  useEffect(() => {
    propsRef.current = { mode, terrainTool, selectedPlacementKey, onTerrainStroke, onPlace, onSelectEntity, onCursor };
  }, [mode, onCursor, onPlace, onSelectEntity, onTerrainStroke, selectedPlacementKey, terrainTool]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0e10);
    scene.fog = new THREE.Fog(0x0c0e10, 145, 270);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
    camera.position.set(102, 84, 108);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 12;
    controls.maxDistance = 260;

    scene.add(new THREE.HemisphereLight(0xd9e7ee, 0x382619, 1.7));
    const sun = new THREE.DirectionalLight(0xffd2a1, 2.2);
    sun.position.set(-70, 110, -45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -110;
    sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 110;
    sun.shadow.camera.bottom = -110;
    scene.add(sun);
    scene.add(terrainRootRef.current, entityRootRef.current);

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

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      brush.geometry.dispose();
      (brush.material as THREE.Material).dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const root = terrainRootRef.current;
    disposeTree(root);
    const scale = 160 / Math.max(terrain.worldWidth, terrain.worldHeight);
    scaleRef.current = scale;
    const geometry = terrainGeometry(terrain, scale);
    const canvas = document.createElement('canvas');
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
    if (showGrid) {
      const wire = new THREE.Mesh(
        geometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0xffd0a0, wireframe: true, transparent: true, opacity: 0.075, depthWrite: false }),
      );
      wire.position.y = 0.012;
      root.add(wire);
    }
    let disposed = false;
    void paintTerrainCanvas(canvas, terrain, manifest, texture, textureBlend, () => disposed);
    return () => {
      disposed = true;
      texture.dispose();
    };
  }, [terrain, manifest, showGrid, textureBlend]);

  useEffect(() => {
    const root = entityRootRef.current;
    disposeTree(root);
    let cancelled = false;
    const scale = scaleRef.current;
    for (const entity of entities.filter((item) => item.token !== '*')) {
      const holder = new THREE.Group();
      holder.userData.entityId = entity.id;
      holder.position.set(
        (entity.position[0] - terrain.worldWidth / 2) * scale,
        entity.position[2] * scale,
        (entity.position[1] - terrain.worldHeight / 2) * scale,
      );
      holder.rotation.y = -entity.rotation[2];
      root.add(holder);
      const placeholder = fallbackUnit(entity, scale);
      placeholder.userData.entityId = entity.id;
      holder.add(placeholder);
      void originalUnit(entity, manifest, scale).then((model) => {
        if (!model || cancelled || !holder.parent) return;
        disposeTree(placeholder);
        holder.remove(placeholder);
        model.userData.entityId = entity.id;
        model.traverse((part) => { part.userData.entityId = entity.id; });
        holder.add(model);
      }).catch(() => undefined);

      if (entity.id === selectedEntityId) {
        const footprint = catalogFor(entity)?.footprint ?? 10;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(footprint * scale * 0.9, footprint * scale, 48),
          new THREE.MeshBasicMaterial({ color: 0xffb169, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -entity.position[2] * scale + 0.025;
        ring.renderOrder = 30;
        holder.add(ring);
      }
      if (entity.token === 'e' && (entity.id === selectedEntityId || mode === 'base')) {
        const radius = serviceRadius * scale;
        const range = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0, radius - 0.08), radius, 96),
          new THREE.MeshBasicMaterial({ color: entity.team === 2 ? 0x65a6ff : 0xff7659, transparent: true, opacity: entity.id === selectedEntityId ? 0.45 : 0.16, side: THREE.DoubleSide, depthWrite: false }),
        );
        range.rotation.x = -Math.PI / 2;
        range.position.y = -entity.position[2] * scale + 0.018;
        holder.add(range);
        const backup = backupRadius * scale;
        const backupRange = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0, backup - 0.06), backup, 64),
          new THREE.MeshBasicMaterial({ color: 0xf6c16f, transparent: true, opacity: entity.id === selectedEntityId ? 0.7 : 0.22, side: THREE.DoubleSide, depthWrite: false }),
        );
        backupRange.rotation.x = -Math.PI / 2;
        backupRange.position.y = -entity.position[2] * scale + 0.022;
        holder.add(backupRange);
      }
    }
    return () => { cancelled = true; };
  }, [backupRadius, entities, manifest, mode, selectedEntityId, serviceRadius, terrain.worldHeight, terrain.worldWidth]);

  useEffect(() => {
    const brush = brushRef.current;
    if (!brush) return;
    const diameter = brushRadius * scaleRef.current;
    brush.scale.set(diameter, diameter, diameter);
  }, [brushRadius]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const container = containerRef.current;
    if (!renderer || !camera || !controls || !container) return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const hit = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects([entityRootRef.current, terrainRootRef.current], true);
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
    const moveBrush = (result?: THREE.Intersection) => {
      const brush = brushRef.current;
      if (!brush) return;
      brush.visible = Boolean(result) && propsRef.current.mode === 'terrain';
      if (result) {
        brush.position.copy(result.point);
        brush.position.y += 0.08;
        propsRef.current.onCursor(toWorld(result.point));
      } else propsRef.current.onCursor(undefined);
    };
    const onPointerMove = (event: PointerEvent) => {
      const intersections = hit(event);
      const ground = terrainPoint(intersections);
      moveBrush(ground);
      if (strokeRef.current && ground) {
        const [x, y] = toWorld(ground.point);
        propsRef.current.onTerrainStroke(x, y, 'move');
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const intersections = hit(event);
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
      strokeRef.current = false;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      propsRef.current.onTerrainStroke(0, 0, 'end');
    };
    const onLeave = () => {
      if (brushRef.current) brushRef.current.visible = false;
      propsRef.current.onCursor(undefined);
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', endStroke);
    renderer.domElement.addEventListener('pointercancel', endStroke);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    return () => {
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', endStroke);
      renderer.domElement.removeEventListener('pointercancel', endStroke);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
    };
  }, [terrain.worldHeight, terrain.worldWidth]);

  return (
    <div className="terrain-viewport" ref={containerRef}>
      <div className="viewport-badges" aria-hidden="true">
        <span>3D PERSPECTIVE</span>
        <span>ORIGINAL TEXTURES</span>
      </div>
      <div className="viewport-help">Left drag edits · Right drag orbits · Wheel zooms</div>
    </div>
  );
}
