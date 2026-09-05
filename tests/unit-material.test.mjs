import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { createUnitMaterial } from '../lib/unit-material.ts';
import { modelNameFor } from '../lib/wulfram.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
const textures = new Map();
function loadTexture(url) {
  if (!textures.has(url)) {
    const texture = new THREE.Texture();
    texture.name = url;
    textures.set(url, texture);
  }
  return textures.get(url);
}
function fragment(material) {
  const shader = { fragmentShader: '#include <map_fragment>' };
  material.onBeforeCompile(shader, null);
  return shader.fragmentShader;
}

void test('power teams select the archived red/blue models, including their distinct core art', () => {
  for (const [team, name, core] of [[1, 'energy_2', 'top'], [2, 'energy_1', 'e2top'], [0, 'energy_1', 'e2top']]) {
    assert.equal(modelNameFor({ token: 'e', team }), name);
    const shape = JSON.parse(fs.readFileSync(new URL(`../public${manifest.models[name].url}`, import.meta.url), 'utf8'));
    assert.ok(shape.materials.includes(core));
    const material = createUnitMaterial(core, team, manifest, loadTexture);
    assert.equal(material.map.name, manifest.materials[core].url);
    assert.equal(fragment(material).includes('dot(diffuseColor'), team === 0);
    material.dispose();
  }
});

void test('cargo sides and lids use red or blue art and a neutral fallback without changing shared textures', () => {
  for (const name of ['cargosd', 'cargotops']) {
    const materials = [1, 0, 2, 1].map((team) => createUnitMaterial(name, team, manifest, loadTexture));
    assert.equal(materials[0].map.name, manifest.materials[`${name}R`].url);
    assert.equal(materials[2].map.name, manifest.materials[name].url);
    assert.notEqual(materials[0].map, materials[2].map);
    assert.equal(materials[0].map, materials[3].map);
    assert.equal(materials[1].map, materials[2].map);
    assert.ok(fragment(materials[1]).includes('dot(diffuseColor'));
    assert.ok(!fragment(materials[2]).includes('dot(diffuseColor'));
    assert.notEqual(materials[1].customProgramCacheKey(), materials[2].customProgramCacheKey());
    for (const material of materials) material.dispose();
  }
});

void test('all supplied neutral variants resolve from every team member and keep the original bitmap colors', () => {
  for (const [source, variants] of Object.entries(manifest.materialVariants)) {
    if (!manifest.materials[variants.neutral]) {
      assert.match(source, /^cargo/);
      continue;
    }
    const material = createUnitMaterial(source, 0, manifest, loadTexture);
    assert.equal(material.name, variants.neutral, source);
    assert.equal(material.map.name, manifest.materials[variants.neutral].url, source);
    assert.ok(!fragment(material).includes('dot(diffuseColor'), source);
    assert.equal(material.color.getHex(), 0xffffff, source);
    material.dispose();
  }
});
