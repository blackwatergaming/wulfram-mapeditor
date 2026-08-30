import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAP_ARCHIVE_FILES,
  createMapArchive,
  createMapArchiveFiles,
  readMapArchive,
  safeMapName,
} from '../lib/map-package.ts';
import {
  DEFAULT_VALIDATION,
  parseBaseLayout,
  parseLand,
  parseLines,
  parseState,
  serializeLand,
  serializeLines,
  serializeState,
} from '../lib/wulfram.ts';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledMapRoot = path.join(workspace, 'public', 'assets', 'demo', 'crossroads');
const configuredMapRoot = process.env.WULFRAM_MAPS_DIR
  ? path.resolve(process.env.WULFRAM_MAPS_DIR)
  : path.resolve(workspace, '..', 'wulfram-debug', 'data', 'maps');
const stateFilePattern = /^(?:state\d*|db_state|bigstate)$/i;

function findMapDirectories(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'land')) found.push(current);
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}

function discoverFixtures() {
  const originalDirectories = findMapDirectories(configuredMapRoot);
  const root = originalDirectories.length ? configuredMapRoot : path.dirname(bundledMapRoot);
  const directories = originalDirectories.length ? originalDirectories : [bundledMapRoot];
  return {
    source: originalDirectories.length ? configuredMapRoot : bundledMapRoot,
    fixtures: directories.map((directory) => {
      const files = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
      const stateFiles = files.filter((name) => stateFilePattern.test(name)).sort((left, right) => {
        if (left.toLowerCase() === 'state') return -1;
        if (right.toLowerCase() === 'state') return 1;
        return left.localeCompare(right);
      });
      const relativeName = path.relative(root, directory).replaceAll(path.sep, '/');
      return {
        directory,
        name: relativeName || path.basename(directory),
        stateFiles,
        hasTagmap: files.some((name) => name.toLowerCase() === 'tagmap'),
        hasTagmap2: files.some((name) => name.toLowerCase() === 'tagmap2'),
      };
    }),
  };
}

function readFixtureFile(fixture, name) {
  return fs.readFileSync(path.join(fixture.directory, name), 'utf8');
}

function loadFixtureProject(fixture) {
  const terrain = parseLand(readFixtureFile(fixture, 'land'));
  terrain.tagmap = fixture.hasTagmap ? parseLines(readFixtureFile(fixture, 'tagmap')) : [];
  terrain.tagmap2 = fixture.hasTagmap2 ? parseLines(readFixtureFile(fixture, 'tagmap2')) : [];
  const selectedState = fixture.stateFiles[0];
  return {
    format: 'wulfram-map-project',
    version: 1,
    name: fixture.name,
    terrain,
    entities: selectedState ? parseState(readFixtureFile(fixture, selectedState)) : [],
    validation: { ...DEFAULT_VALIDATION },
    updatedAt: '2000-01-01T00:00:00.000Z',
  };
}

function assertNumberClose(actual, expected, tolerance, context) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${context}: expected ${expected}, received ${actual} (tolerance ${tolerance})`,
  );
}

function assertTerrainEqual(actual, expected, context) {
  assert.equal(actual.width, expected.width, `${context}: grid width`);
  assert.equal(actual.height, expected.height, `${context}: grid height`);
  assertNumberClose(actual.worldWidth, expected.worldWidth, 5e-7, `${context}: world width`);
  assertNumberClose(actual.worldHeight, expected.worldHeight, 5e-7, `${context}: world height`);
  assert.deepEqual(actual.textureIds, expected.textureIds, `${context}: texture indices`);
  assert.equal(actual.heights.length, expected.heights.length, `${context}: elevation count`);
  for (let index = 0; index < expected.heights.length; index += 1) {
    assertNumberClose(actual.heights[index], expected.heights[index], 5e-7, `${context}: elevation ${index}`);
  }
  assert.deepEqual(actual.tagmap, expected.tagmap, `${context}: tagmap`);
  assert.deepEqual(actual.tagmap2, expected.tagmap2, `${context}: tagmap2`);
}

function assertStateEqual(actual, expected, context) {
  assert.equal(actual.length, expected.length, `${context}: entity count`);
  for (let index = 0; index < expected.length; index += 1) {
    const actualEntity = actual[index];
    const expectedEntity = expected[index];
    assert.equal(actualEntity.token, expectedEntity.token, `${context}: entity ${index} token`);
    assert.equal(actualEntity.subtype, expectedEntity.subtype, `${context}: entity ${index} cargo subtype`);
    assert.equal(actualEntity.team, expectedEntity.team, `${context}: entity ${index} team`);
    assert.equal(actualEntity.active, expectedEntity.active, `${context}: entity ${index} active flag`);
    assert.equal(actualEntity.raw, expectedEntity.raw, `${context}: entity ${index} raw decoration`);
    for (let axis = 0; axis < 3; axis += 1) {
      assertNumberClose(actualEntity.position[axis], expectedEntity.position[axis], 5e-13, `${context}: entity ${index} position ${axis}`);
      assertNumberClose(actualEntity.rotation[axis], expectedEntity.rotation[axis], 5e-13, `${context}: entity ${index} rotation ${axis}`);
    }
  }
}

function countStateRows(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).length;
}

function archiveEntriesByBaseName(entries) {
  return new Map(entries.map((entry) => [entry.name.replace(/\\/g, '/').split('/').pop().toLowerCase(), entry]));
}

const discovered = discoverFixtures();

void test('original map readers and writers are lossless at their documented precision', () => {
  let terrainVertices = 0;
  let stateFiles = 0;
  let stateEntities = 0;

  for (const fixture of discovered.fixtures) {
    const sourceTerrain = parseLand(readFixtureFile(fixture, 'land'));
    sourceTerrain.tagmap = fixture.hasTagmap ? parseLines(readFixtureFile(fixture, 'tagmap')) : [];
    sourceTerrain.tagmap2 = fixture.hasTagmap2 ? parseLines(readFixtureFile(fixture, 'tagmap2')) : [];
    const canonicalLand = serializeLand(sourceTerrain);
    const reloadedTerrain = parseLand(canonicalLand);
    reloadedTerrain.tagmap = parseLines(serializeLines(sourceTerrain.tagmap));
    reloadedTerrain.tagmap2 = parseLines(serializeLines(sourceTerrain.tagmap2));

    assertTerrainEqual(reloadedTerrain, sourceTerrain, fixture.name);
    assert.equal(serializeLand(reloadedTerrain), canonicalLand, `${fixture.name}: land writer is idempotent`);
    assert.equal(serializeLines(reloadedTerrain.tagmap), serializeLines(sourceTerrain.tagmap), `${fixture.name}: tagmap writer is idempotent`);
    assert.equal(serializeLines(reloadedTerrain.tagmap2), serializeLines(sourceTerrain.tagmap2), `${fixture.name}: tagmap2 writer is idempotent`);
    terrainVertices += sourceTerrain.heights.length;

    for (const stateFile of fixture.stateFiles) {
      const stateText = readFixtureFile(fixture, stateFile);
      const sourceState = parseState(stateText);
      assert.equal(sourceState.length, countStateRows(stateText), `${fixture.name}/${stateFile}: every original row was loaded`);
      const canonicalState = serializeState(sourceState);
      const reloadedState = parseState(canonicalState);
      assertStateEqual(reloadedState, sourceState, `${fixture.name}/${stateFile}`);
      assert.equal(serializeState(reloadedState), canonicalState, `${fixture.name}/${stateFile}: state writer is idempotent`);
      stateFiles += 1;
      stateEntities += sourceState.length;
    }
  }

  assert.ok(discovered.fixtures.length > 0, 'At least one original map fixture is required.');
  console.log(`Round-tripped ${discovered.fixtures.length} original maps (${terrainVertices.toLocaleString()} vertices) and ${stateFiles} state files (${stateEntities.toLocaleString()} entities) from ${discovered.source}.`);
});

void test('ZIP packager reloads every original map without semantic changes', async () => {
  for (const fixture of discovered.fixtures) {
    const project = loadFixtureProject(fixture);
    const expectedFiles = createMapArchiveFiles(project);
    const archive = await createMapArchive(project);
    const entries = await readMapArchive(archive);
    const byName = archiveEntriesByBaseName(entries);
    const expectedRoot = `${safeMapName(project.name)}/`;

    assert.equal(entries.length, MAP_ARCHIVE_FILES.length, `${fixture.name}: archive file count`);
    for (const fileName of MAP_ARCHIVE_FILES) {
      const entry = byName.get(fileName);
      assert.ok(entry, `${fixture.name}: archive contains ${fileName}`);
      assert.ok(entry.name.replace(/\\/g, '/').startsWith(expectedRoot), `${fixture.name}: ${fileName} is under the canonical map folder`);
      assert.equal(entry.text, expectedFiles[fileName], `${fixture.name}: packed ${fileName} matches the writer output`);
    }

    const reloadedTerrain = parseLand(byName.get('land').text);
    reloadedTerrain.tagmap = parseLines(byName.get('tagmap').text);
    reloadedTerrain.tagmap2 = parseLines(byName.get('tagmap2').text);
    assertTerrainEqual(reloadedTerrain, project.terrain, `${fixture.name} packaged terrain`);
    assertStateEqual(parseState(byName.get('state').text), project.entities, `${fixture.name} packaged state`);

    const reloadedLayout = parseBaseLayout(JSON.parse(byName.get('base-layout.json').text));
    const layoutEntities = project.entities.filter((entity) => entity.token !== '*');
    assertStateEqual(reloadedLayout.entities, layoutEntities, `${fixture.name} packaged base layout`);
    assert.equal(reloadedLayout.name, project.name, `${fixture.name}: JSON layout map name`);
    assert.deepEqual(
      JSON.parse(byName.get('wulfram-project.json').text),
      JSON.parse(JSON.stringify(project)),
      `${fixture.name}: browser project backup`,
    );
  }

  console.log(`Packed, reopened, and compared ${discovered.fixtures.length} original map archives.`);
});

void test('ZIP output is deterministic for the same map revision', async () => {
  const project = loadFixtureProject(discovered.fixtures[0]);
  const first = Buffer.from(await createMapArchive(project));
  const second = Buffer.from(await createMapArchive(project));
  assert.deepEqual(second, first);
});
