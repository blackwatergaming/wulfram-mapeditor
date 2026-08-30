import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readMapArchive } from '../lib/map-package.ts';
import {
  MAP_BASE_SOURCE_FILES,
  MAP_SOURCE_FILES,
  MAP_TERRAIN_SOURCE_FILES,
} from '../lib/map-source.ts';
import {
  activateBaseLayout,
  createBlankProject,
  synchronizeActiveBaseLayout,
} from '../lib/wulfram.ts';
import {
  buildReleaseArtifacts,
  compileRepositoryMap,
  listRepositoryMaps,
  loadRepositoryMap,
  publishRepositoryMaps,
  repositoryDiagnostics,
  repositoryGitInfo,
  saveRepositoryMap,
  switchRepositoryBranch,
} from '../tools/map-repository-lib.mjs';
import { startRepositoryServer } from '../tools/maps-repository-server.mjs';

function fixtureProject() {
  const project = createBlankProject('Git Diff Test', 3);
  project.updatedAt = '2000-01-01T00:00:00.000Z';
  project.baseLayouts[0].updatedAt = project.updatedAt;
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

function git(repository, ...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
}

function realRepository(context) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wulfram-map-git-test-'));
  const repository = path.join(temporary, 'checkout');
  const remote = path.join(temporary, 'remote.git');
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['init', '--initial-branch=main', repository], { stdio: 'ignore' });
  git(repository, 'config', 'user.name', 'Wulfram Test');
  git(repository, 'config', 'user.email', 'wulfram-test@example.invalid');
  saveRepositoryMap(repository, 'git-diff-test', fixtureProject());
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'Initial maps');
  git(repository, 'remote', 'add', 'origin', remote);
  git(repository, 'push', '--set-upstream', 'origin', 'main');
  return { repository, remote };
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
      'base-layouts.json',
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

void test('base-only saves persist multiple named layouts and never rewrite terrain files', (context) => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'wulfram-layout-save-test-'));
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repository, '.git'));
  saveRepositoryMap(repository, 'git-diff-test', fixtureProject());
  const directory = path.join(repository, 'maps', 'git-diff-test');
  const terrainBefore = Object.fromEntries(MAP_TERRAIN_SOURCE_FILES.map((fileName) => [
    fileName,
    fs.readFileSync(path.join(directory, fileName)),
  ]));
  const baseBefore = Object.fromEntries(MAP_BASE_SOURCE_FILES.map((fileName) => [
    fileName,
    fs.readFileSync(path.join(directory, fileName)),
  ]));

  const changed = loadRepositoryMap(repository, 'git-diff-test');
  changed.name = 'This map-name change must stay unsaved';
  changed.terrain.heights[4] = 999;
  changed.terrain.textureIds[4] = 17;
  changed.terrain.tagmap2.push('must-not-save');
  changed.baseLayouts[0].name = 'Competitive';
  changed.baseLayouts[0].metadata = { author: 'Blackwater', ruleset: 'ranked' };
  changed.entities.push({
    id: 'gun-a', token: 'g', team: 1,
    position: [80, 70, 13], rotation: [0, 0, 0], active: 1,
  });
  synchronizeActiveBaseLayout(changed, '2026-08-30T21:00:00.000Z');
  changed.baseLayouts.push({
    id: 'night-raid',
    name: 'Night Raid',
    metadata: { lighting: 'night', objective: 'uplink' },
    entities: [{
      id: 'uplink-b', token: 'u', team: 0,
      position: [120, 90, 11], rotation: [0, 0, 1.5], active: 1,
    }],
    validation: { ...changed.validation, minSpacing: 12 },
    updatedAt: '2026-08-30T21:01:00.000Z',
  });
  activateBaseLayout(changed, 'night-raid');

  const saved = saveRepositoryMap(repository, 'git-diff-test', changed, { scope: 'base' });
  assert.deepEqual(saved.writtenFiles, [...MAP_BASE_SOURCE_FILES]);
  for (const fileName of MAP_TERRAIN_SOURCE_FILES) {
    assert.deepEqual(
      fs.readFileSync(path.join(directory, fileName)),
      terrainBefore[fileName],
      `${fileName} is byte-identical after a base-only save`,
    );
  }
  assert.ok(MAP_BASE_SOURCE_FILES.some((fileName) =>
    !fs.readFileSync(path.join(directory, fileName)).equals(baseBefore[fileName])));

  const loaded = loadRepositoryMap(repository, 'git-diff-test');
  assert.equal(loaded.name, 'Git Diff Test');
  assert.equal(loaded.terrain.heights[4], 12.345678);
  assert.equal(loaded.baseLayouts.length, 2);
  assert.equal(loaded.activeBaseLayoutId, 'night-raid');
  assert.equal(loaded.baseLayouts[0].name, 'Competitive');
  assert.deepEqual(loaded.baseLayouts[0].metadata, { author: 'Blackwater', ruleset: 'ranked' });
  assert.deepEqual(loaded.baseLayouts[1].metadata, { lighting: 'night', objective: 'uplink' });
  assert.deepEqual(loaded.entities.map((entity) => entity.id), ['uplink-b']);
  assert.equal(loaded.validation.minSpacing, 12);
});

void test('terrain-only saves preserve every existing base-state byte', (context) => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'wulfram-terrain-save-test-'));
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repository, '.git'));
  saveRepositoryMap(repository, 'git-diff-test', fixtureProject());
  const directory = path.join(repository, 'maps', 'git-diff-test');
  const baseBefore = Object.fromEntries(MAP_BASE_SOURCE_FILES.map((fileName) => [
    fileName,
    fs.readFileSync(path.join(directory, fileName)),
  ]));
  const changed = loadRepositoryMap(repository, 'git-diff-test');
  changed.terrain.heights[0] = 88;
  changed.entities = [];
  changed.baseLayouts[0].name = 'Must not save';
  const saved = saveRepositoryMap(repository, 'git-diff-test', changed, { scope: 'terrain' });
  assert.deepEqual(saved.writtenFiles, [...MAP_TERRAIN_SOURCE_FILES]);
  for (const fileName of MAP_BASE_SOURCE_FILES) {
    assert.deepEqual(
      fs.readFileSync(path.join(directory, fileName)),
      baseBefore[fileName],
      `${fileName} is byte-identical after a terrain-only save`,
    );
  }
  const loaded = loadRepositoryMap(repository, 'git-diff-test');
  assert.equal(loaded.terrain.heights[0], 88);
  assert.equal(loaded.baseLayouts[0].name, 'Default');
  assert.deepEqual(loaded.entities.map((entity) => entity.id), ['power-1']);
});

void test('base-only save requires an existing saved terrain', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'wulfram-base-first-test-'));
  try {
    fs.mkdirSync(path.join(repository, '.git'));
    assert.throws(
      () => saveRepositoryMap(repository, 'new-map', fixtureProject(), { scope: 'base' }),
      /save.*terrain.*before.*base layouts/i,
    );
    assert.equal(fs.existsSync(path.join(repository, 'maps', 'new-map')), false);
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

void test('publishing creates a feature branch, one map commit, a push, and a PR into main', (context) => {
  const { repository, remote } = realRepository(context);
  const changed = fixtureProject();
  changed.terrain.heights[4] = 44.5;
  changed.updatedAt = '2026-08-30T20:15:00.000Z';
  saveRepositoryMap(repository, 'git-diff-test', changed, { scope: 'terrain' });

  const calls = [];
  const result = publishRepositoryMaps(repository, ['git-diff-test'], {
    now: new Date('2026-08-30T20:15:00.000Z'),
    publishBranch(root, branch, title, body) {
      calls.push({ root, branch, title, body });
      git(root, 'push', '--set-upstream', 'origin', branch);
      return { pushed: true, prCreated: true, prUrl: 'https://github.com/blackwatergaming/wulfram-maps/pull/123' };
    },
  });

  assert.equal(result.branch, 'maps/git-diff-test-20260830-2015');
  assert.equal(result.baseBranch, 'main');
  assert.equal(result.committed, true);
  assert.equal(result.pushed, true);
  assert.equal(result.prCreated, true);
  assert.match(result.prUrl, /\/pull\/123$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'Update Git Diff Test');
  assert.match(calls[0].body, /Created by Wulfram Forge/);
  assert.deepEqual(git(repository, 'diff', '--name-only', 'main..HEAD').split(/\r?\n/), [
    'maps/git-diff-test/map.json',
    'maps/git-diff-test/terrain.tsv',
  ]);
  assert.equal(git(repository, 'log', '-1', '--pretty=%s'), 'Update Git Diff Test');
  assert.equal(
    git(repository, 'ls-remote', '--heads', remote, result.branch).split(/\s+/).at(-1),
    `refs/heads/${result.branch}`,
  );
});

void test('branch controls and setup diagnostics report a safe checkout lifecycle', (context) => {
  const { repository } = realRepository(context);
  let info = repositoryGitInfo(repository);
  assert.equal(info.branch, 'main');
  assert.deepEqual(info.branches, ['main']);
  assert.equal(info.defaultBranch, 'main');

  info = switchRepositoryBranch(repository, 'maps/manual-layout', true);
  assert.equal(info.branch, 'maps/manual-layout');
  assert.ok(info.branches.includes('maps/manual-layout'));
  info = switchRepositoryBranch(repository, 'main');
  assert.equal(info.branch, 'main');
  assert.throws(() => switchRepositoryBranch(repository, '../escape', true), /branch name/i);

  const diagnostics = repositoryDiagnostics(repository);
  assert.equal(diagnostics.repository, path.resolve(repository));
  assert.ok(diagnostics.checks.some((check) => check.id === 'repository' && check.status === 'pass'));
  assert.ok(diagnostics.checks.some((check) => check.id === 'main' && check.status === 'pass'));
  assert.ok(diagnostics.checks.some((check) => check.id === 'github-auth'));
});

void test('automatic branch creation refuses to carry unrelated checkout changes', (context) => {
  const { repository } = realRepository(context);
  const changed = fixtureProject();
  changed.terrain.heights[0] = 99;
  saveRepositoryMap(repository, 'git-diff-test', changed);
  fs.writeFileSync(path.join(repository, 'notes.txt'), 'unrelated\n');
  assert.throws(
    () => publishRepositoryMaps(repository, ['git-diff-test'], { publishBranch: () => assert.fail('must not publish') }),
    /unrelated changes.*notes\.txt/i,
  );
  assert.equal(repositoryGitInfo(repository).branch, 'main');
});

void test('loopback service exposes health, setup diagnostics, catalogs, and branch controls', async (context) => {
  const { repository } = realRepository(context);
  const server = await startRepositoryServer({ repository, port: 0 });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.repository, path.resolve(repository));
  const diagnostics = await fetch(`${base}/diagnostics`).then((response) => response.json());
  assert.ok(diagnostics.checks.some((check) => check.id === 'repository' && check.status === 'pass'));
  const catalog = await fetch(`${base}/maps`).then((response) => response.json());
  assert.equal(catalog.defaultBranch, 'main');
  assert.deepEqual(catalog.branches, ['main']);
  assert.deepEqual(catalog.maps.map((map) => map.slug), ['git-diff-test']);
  assert.equal(catalog.maps[0].layouts, 1);

  const loaded = await fetch(`${base}/maps/git-diff-test`).then((response) => response.json());
  const mapPath = path.join(repository, 'maps', 'git-diff-test', 'map.json');
  const mapBefore = fs.readFileSync(mapPath);
  loaded.project.name = 'Unsaved through base scope';
  loaded.project.baseLayouts[0].name = 'Service Layout';
  loaded.project.baseLayouts[0].metadata = { endpoint: 'loopback' };
  const saved = await fetch(`${base}/maps/git-diff-test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: loaded.project, scope: 'base' }),
  }).then((response) => response.json());
  assert.equal(saved.scope, 'base');
  assert.deepEqual(saved.writtenFiles, [...MAP_BASE_SOURCE_FILES]);
  assert.deepEqual(fs.readFileSync(mapPath), mapBefore);
  assert.equal(saved.project.name, 'Git Diff Test');
  assert.equal(saved.project.baseLayouts[0].name, 'Service Layout');
  assert.deepEqual(saved.project.baseLayouts[0].metadata, { endpoint: 'loopback' });

  const switched = await fetch(`${base}/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch: 'maps/service-test', create: true }),
  }).then((response) => response.json());
  assert.equal(switched.branch, 'maps/service-test');
  assert.ok(switched.branches.includes('maps/service-test'));
});
