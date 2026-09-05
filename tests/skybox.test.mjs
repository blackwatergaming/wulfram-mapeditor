import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createMapArchive, readMapArchive } from '../lib/map-package.ts';
import { createMapSourceFiles, parseMapSourceFiles } from '../lib/map-source.ts';
import { createSkyboxGeometry } from '../lib/skybox.ts';
import { DEFAULT_SKYBOX, SKYBOX_NAMES, resolveSkyboxName, skyboxFromStartScript } from '../lib/sky-settings.ts';
import { createBlankProject } from '../lib/wulfram.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));

void test('every original sky is available and survives source and game ZIP export', async () => {
  assert.deepEqual(Object.keys(manifest.skyboxes).sort(), Array.from(SKYBOX_NAMES).sort());
  for (const name of SKYBOX_NAMES) {
    const asset = manifest.skyboxes[name];
    assert.ok(fs.existsSync(new URL(`../public${asset.url}`, import.meta.url)), name);
    assert.equal(asset.width, 520);
    assert.equal(asset.height, 1040);
    const project = createBlankProject('Sky fixture', 3);
    project.terrain.skyName = name;
    const restored = parseMapSourceFiles(createMapSourceFiles(project));
    assert.equal(restored.terrain.skyName, name);
    const entries = await readMapArchive(await createMapArchive(restored));
    const script = entries.find((entry) => entry.name.endsWith('/start_script'));
    assert.ok(script);
    assert.equal(skyboxFromStartScript(script.text), name);
    const backup = entries.find((entry) => entry.name.endsWith('/wulfram-project.json'));
    assert.equal(JSON.parse(backup.text).terrain.skyName, name);
  }
});

void test('original startup sky lists tolerate case and unsupported names; legacy projects retain defaults', () => {
  assert.equal(skyboxFromStartScript('sky_names "2starset, Aurora"\nmap_name "Crossroads"'), '2starset');
  assert.equal(skyboxFromStartScript('sky_names "missing, Aurora, Sunset"'), 'aurora');
  assert.equal(skyboxFromStartScript('map_name "No sky"'), undefined);
  const legacy = parseMapSourceFiles(createMapSourceFiles(createBlankProject('Legacy', 3)));
  assert.equal(legacy.terrain.skyName, undefined);
  assert.equal(resolveSkyboxName(legacy.terrain.skyName), DEFAULT_SKYBOX);
  const invalid = createMapSourceFiles(legacy);
  const metadata = JSON.parse(invalid['map.json']);
  metadata.terrain.skyName = 'missing';
  invalid['map.json'] = JSON.stringify(metadata);
  assert.throws(() => parseMapSourceFiles(invalid), /available Wulfram skybox/);
});

void test('sky geometry uses all 32 native tiles and the recovered roof/wall UV orientation', () => {
  const geometry = createSkyboxGeometry(5600, 4200);
  try {
    const positions = geometry.getAttribute('position');
    const uvs = geometry.getAttribute('uv');
    assert.equal(positions.count, 128);
    assert.equal(geometry.index.count, 192);
    const tiles = [];
    for (let quad = 0; quad < 32; quad += 1) {
      const index = quad * 4;
      const column = Math.floor(uvs.getX(index) * 4);
      const row = Math.floor(uvs.getY(index) * 8);
      tiles.push(row * 4 + column + 1);
    }
    assert.deepEqual(tiles.slice(0, 16), [29, 25, 21, 17, 30, 26, 22, 18, 31, 27, 23, 19, 32, 28, 24, 20]);
    assert.deepEqual(tiles.slice(16), [8, 7, 6, 5, 16, 15, 14, 13, 12, 11, 10, 9, 4, 3, 2, 1]);
    assert.equal(new Set(tiles).size, 32);
    for (const [quad, expected] of [
      [0, [[0, 1], [0, 0], [1, 0], [1, 1]]],
      [16, [[1, 1], [0, 1], [0, 0], [1, 0]]],
      [20, [[0, 0], [1, 0], [1, 1], [0, 1]]],
      [24, [[0, 1], [0, 0], [1, 0], [1, 1]]],
      [28, [[1, 0], [1, 1], [0, 1], [0, 0]]],
    ]) {
      const tile = tiles[quad] - 1;
      for (let corner = 0; corner < 4; corner += 1) {
        const u = (uvs.getX(quad * 4 + corner) * 520 - (tile % 4) * 130 - 1) / 128;
        const v = (uvs.getY(quad * 4 + corner) * 1040 - Math.floor(tile / 4) * 130 - 1) / 128;
        assert.ok(Math.abs(u - expected[corner][0]) < 1e-6);
        assert.ok(Math.abs(v - expected[corner][1]) < 1e-6);
      }
    }
    for (let index = 0; index < 64; index += 1) assert.equal(positions.getY(index), 3990);
  } finally {
    geometry.dispose();
  }
});
