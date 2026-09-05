import * as THREE from 'three';

import type { AssetManifest, Vec3 } from './wulfram.ts';

const BASE_UVS = [[0, 1], [0, 0], [1, 0], [1, 1]] as const;

/** Original 16 wall strips and 4×4 roof, in the client's world/UV orientation. */
export function createSkyboxGeometry(worldWidth: number, worldHeight: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const minX = -worldWidth * 1.5;
  const maxX = worldWidth * 1.5;
  const minY = -worldHeight * 1.5;
  const maxY = worldHeight * 1.5;
  const bottom = -10;
  const top = 3990;
  const quad = (tile: number, rotation: number, vertices: Vec3[]) => {
    const offset = positions.length / 3;
    const column = (tile - 1) % 4;
    const row = Math.floor((tile - 1) / 4);
    for (let index = 0; index < 4; index += 1) {
      const [x, y, z] = vertices[index];
      positions.push(x, z, -y);
      const [u, v] = BASE_UVS[(index - rotation + 4) % 4];
      uvs.push((column * 130 + 1 + u * 128) / 520, (row * 130 + 1 + v * 128) / 1040);
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      const x0 = minX + (maxX - minX) * x / 4;
      const x1 = minX + (maxX - minX) * (x + 1) / 4;
      const y0 = minY + (maxY - minY) * y / 4;
      const y1 = minY + (maxY - minY) * (y + 1) / 4;
      quad(29 + x - 4 * y, 0, [[x0, y0, top], [x0, y1, top], [x1, y1, top], [x1, y0, top]]);
    }
  }
  const wall = (x0: number, y0: number, x1: number, y1: number, firstTile: number, rotation: number) => {
    for (let index = 0; index < 4; index += 1) {
      const ax = x0 + (x1 - x0) * index / 4;
      const ay = y0 + (y1 - y0) * index / 4;
      const bx = x0 + (x1 - x0) * (index + 1) / 4;
      const by = y0 + (y1 - y0) * (index + 1) / 4;
      quad(firstTile - index, rotation, [[ax, ay, bottom], [ax, ay, top], [bx, by, top], [bx, by, bottom]]);
    }
  };
  wall(maxX, minY, maxX, maxY, 8, 1);
  wall(minX, maxY, minX, minY, 16, 3);
  wall(minX, minY, maxX, minY, 12, 0);
  wall(maxX, maxY, minX, maxY, 4, 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function createSkybox(
  asset: NonNullable<AssetManifest['skyboxes']>[string],
  worldWidth: number,
  worldHeight: number,
  loadImage: (url: string) => Promise<HTMLImageElement>,
  invalidate: () => void,
) {
  const texture = new THREE.Texture();
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    // Camera rotation only, with the far-plane depth: exploration cannot exit the sky.
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 skyClip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
      gl_Position = skyClip.xyww;
    `);
  };
  material.customProgramCacheKey = () => 'wulfram-sky-v1';
  const mesh = new THREE.Mesh(createSkyboxGeometry(worldWidth, worldHeight), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.visible = false;
  let disposed = false;
  void loadImage(asset.url).then((image) => {
    if (disposed) return;
    texture.image = image;
    texture.needsUpdate = true;
    mesh.visible = true;
    invalidate();
  }).catch((error: unknown) => console.warn('Unable to load Wulfram sky:', error));
  return {
    mesh,
    dispose() {
      disposed = true;
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
