import * as THREE from 'three';

import { materialNameForTeam, type AssetManifest } from './wulfram.ts';

export function createUnitMaterial(
  sourceName: string,
  team: number,
  manifest: Pick<AssetManifest, 'materials' | 'materialVariants'>,
  loadTexture: (url: string) => THREE.Texture,
): THREE.MeshStandardMaterial {
  const name = materialNameForTeam(sourceName, team, manifest);
  const asset = manifest.materials[name];
  const neutral = team !== 1 && team !== 2;
  const material = new THREE.MeshStandardMaterial({
    color: asset ? 0xffffff : neutral ? 0x9ca3a6 : team === 2 ? 0x688fcb : 0xc56b4c,
    roughness: 0.72,
    metalness: 0.2,
  });
  material.name = name;
  if (asset) material.map = loadTexture(asset.url);

  // cargosdG/cargotopsG are named by the client but absent from base.zip.
  // Other meshes bake team colors directly into art without a remap entry.
  // Keep authentic neutral bitmaps; remove team color only from the fallback.
  const variants = manifest.materialVariants?.[sourceName];
  if (neutral && asset && (!variants || !manifest.materials[variants.neutral])) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
      `);
    };
    material.customProgramCacheKey = () => 'neutral-unit-fallback-v1';
  }
  return material;
}
