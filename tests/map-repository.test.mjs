import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readMapArchive } from '../lib/map-package.ts';
import { MAP_SOURCE_FILES } from '../lib/map-source.ts';
import { createBlankProject } from '../lib/wulfram.ts';
import {
  buildReleaseArtifacts,
  compileRepositoryMap,
  listRepositoryMaps,
  loadRepositoryMap,
  saveRepositoryMap,
} from '../tools/map-repository-lib.mjs';

function fixtureProject() {
  const project = createBlankProject('Git Diff Test', 3);
  project.updatedAt = '2000-01-01T00:00:00.000Z';
  project.terrain.worldWidth = 200;
  project.terrain.worldHeight = 160;
  project.terrain.textureIds[4] = 3;
  project.terrain.heights[4] = 12.345678;
  project.terrain.tagmap = ['0:10martian001', '3:1ice001'];
  project.terrain.tagmap2 = ['10martian001', 'unused', 'unused2', '1ice001'];
  project.entities = [
    {
      id: 'power-1',
      token: 'e',
      team: 0,
      position: [100, 80, 15.328],
      rotation: [0.01, -0.02, 1.570796326795],
      active: 1,
    },
  ];
  return project;
}

void test('repository source save, list, load, compile, and release bundle form one deterministic lifecycle', async (context) => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wulfram-map-repository-test-'),
  );
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repository, '.git'));
  const project = fixtureProject();
  const saved = saveRepositoryMap(repository, 'git-diff-test', project);
  assert.equal(saved.slug, 'git-diff-test');
  for (const fileName of MAP_SOURCE_FILES) {
    const value = fs.readFileSync(
      path.join(repository, 'maps', saved.slug, fileName),
      'utf8',
    );
    assert.ok(
      !value.includes('\r'),
      `${fileName} uses Git-friendly LF line endings`,
    );
  }

  const catalog = listRepositoryMaps(repository);
  assert.deepEqual(
    catalog.map((map) => map.slug),
    ['git-diff-test'],
  );
  assert.equal(catalog[0].entities, 1);
  assert.deepEqual(loadRepositoryMap(repository, saved.slug), saved.project);

  const firstOutput = path.join(repository, 'first');
  const secondOutput = path.join(repository, 'second');
  const first = await compileRepositoryMap(repository, saved.slug, firstOutput);
  const second = await compileRepositoryMap(
    repository,
    saved.slug,
    secondOutput,
  );
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(
    fs.readFileSync(first.output),
    fs.readFileSync(second.output),
  );
  const packageEntries = await readMapArchive(fs.readFileSync(first.output));
  assert.deepEqual(
    new Set(packageEntries.map((entry) => path.posix.basename(entry.name))),
    new Set([
      'land',
      'state',
      'tagmap',
      'tagmap2',
      'base-layout.json',
      'wulfram-project.json',
    ]),
  );

  const release = await buildReleaseArtifacts(
    repository,
    'v1.2.3',
    path.join(repository, 'release'),
  );
  assert.equal(release.compiled.length, 1);
  assert.ok(fs.existsSync(release.collectionPath));
  assert.ok(
    fs.readFileSync(release.checksumPath, 'utf8').includes('git-diff-test.zip'),
  );
  assert.deepEqual(
    release.manifest.maps.map((map) => map.slug),
    ['git-diff-test'],
  );
});

void test('repository map slugs cannot escape maps/', () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wulfram-map-repository-safety-'),
  );
  try {
    fs.mkdirSync(path.join(repository, '.git'));
    assert.throws(
      () => saveRepositoryMap(repository, '../outside', fixtureProject()),
      /slug/i,
    );
    assert.throws(
      () => saveRepositoryMap(repository, 'UPPERCASE', fixtureProject()),
      /slug/i,
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});
