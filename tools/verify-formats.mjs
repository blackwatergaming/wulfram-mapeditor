import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  cloneProject,
  createBlankProject,
  parseBaseLayout,
  parseLand,
  parseLines,
  parseState,
  serializeLand,
  serializeState,
  synchronizeActiveBaseLayout,
  toBaseLayout,
  validateProject,
} from '../lib/wulfram.ts';
import { createMapSourceFiles, parseMapSourceFiles } from '../lib/map-source.ts';

const workspace = process.cwd();
const demo = path.join(workspace, 'public', 'assets', 'demo', 'crossroads');
const landText = fs.readFileSync(path.join(demo, 'land'), 'utf8');
const stateText = fs.readFileSync(path.join(demo, 'state'), 'utf8');
const tagmapText = fs.readFileSync(path.join(demo, 'tagmap'), 'utf8');
const tagmap2Text = fs.readFileSync(path.join(demo, 'tagmap2'), 'utf8');

const terrain = parseLand(landText);
terrain.tagmap = parseLines(tagmapText);
terrain.tagmap2 = parseLines(tagmap2Text);
assert.equal(terrain.width, 129);
assert.equal(terrain.height, 129);
assert.equal(terrain.heights.length, 16_641);
assert.equal(terrain.textureIds.length, 16_641);
assert.deepEqual(parseLand(serializeLand(terrain)).heights, terrain.heights);

const entities = parseState(stateText);
assert.ok(entities.length > 20, 'Crossroads should contain base units');
const stateRoundTrip = parseState(serializeState(entities));
assert.equal(stateRoundTrip.length, entities.length);
for (let index = 0; index < entities.length; index += 1) {
  assert.equal(stateRoundTrip[index].token, entities[index].token);
  assert.equal(stateRoundTrip[index].subtype, entities[index].subtype);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(stateRoundTrip[index].position[axis] - entities[index].position[axis]) < 1e-10);
    assert.ok(Math.abs(stateRoundTrip[index].rotation[axis] - entities[index].rotation[axis]) < 1e-10);
  }
}

const project = {
  format: 'wulfram-map-project',
  version: 1,
  name: 'Crossroads',
  terrain,
  entities,
  validation: { serviceRadius: 300, backupRadius: 80, maxSlopeDegrees: 22, minSpacing: 8 },
  updatedAt: new Date(0).toISOString(),
};
const sourceProject = parseMapSourceFiles(createMapSourceFiles(project));
assert.deepEqual(sourceProject.terrain, project.terrain);
assert.equal(serializeState(sourceProject.entities), serializeState(project.entities));
const layout = toBaseLayout(project);
const parsedLayout = parseBaseLayout(JSON.parse(JSON.stringify(layout)));
assert.equal(parsedLayout.entities.length, entities.filter((entity) => entity.token !== '*').length);
assert.equal(parsedLayout.validation?.serviceRadius, 300);

const validationFixture = createBlankProject('Power validation');
validationFixture.entities = [
  { id: 'cell-primary', token: 'e', team: 1, position: [100, 100, 0], rotation: [0, 0, 0], active: 1 },
  { id: 'cell-backup', token: 'e', team: 1, position: [165, 100, 0], rotation: [0, 0, 0], active: 1 },
  { id: 'gun-powered', token: 'g', team: 1, position: [280, 100, 17.131], rotation: [0, 0, 0], active: 1 },
  { id: 'gun-unpowered', token: 'g', team: 2, position: [900, 900, 17.131], rotation: [0, 0, 0], active: 1 },
];
const validation = validateProject(validationFixture);
assert.ok(validation.some((issue) => issue.entityId === 'cell-backup' && issue.code === 'backup'));
assert.ok(!validation.some((issue) => issue.entityId === 'gun-powered' && issue.code === 'power'));
assert.ok(validation.some((issue) => issue.entityId === 'gun-unpowered' && issue.code === 'power'));

const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'assets', 'manifest.json'), 'utf8'));
assert.ok(Object.keys(manifest.terrainTextures).length >= 490);
assert.ok(Object.keys(manifest.models).length >= 19);
const baseTemplates = JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'assets', 'base-templates.json'), 'utf8'));
assert.equal(baseTemplates.format, 'wulfram-base-template-library');
assert.equal(baseTemplates.templates.length, manifest.baseTemplates.count);
assert.ok(baseTemplates.templates.length >= 70);
for (const asset of [...Object.values(manifest.models), ...Object.values(manifest.terrainTextures).slice(0, 5)]) {
  assert.ok(fs.existsSync(path.join(workspace, 'public', asset.url)), `Missing extracted asset ${asset.url}`);
}
JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'schemas', 'wulfram-base-layout-v1.schema.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'schemas', 'wulfram-base-layout-collection-v1.schema.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'schemas', 'wulfram-map-source-v1.schema.json'), 'utf8'));
synchronizeActiveBaseLayout(validationFixture);
assert.deepEqual(cloneProject(validationFixture), validationFixture);

console.log(`Verified ${terrain.heights.length.toLocaleString()} terrain vertices, ${entities.length} state entities, ${baseTemplates.templates.length} base templates, JSON round-trips, power rules, and extracted assets.`);
