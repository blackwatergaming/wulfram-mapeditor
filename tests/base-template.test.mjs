import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CATALOG,
  MODEL_WORLD_SCALE,
  STRUCTURE_BOTTOM_MARGIN,
  catalogFor,
  catalogItemHasModel,
  createBlankProject,
  instantiateBaseTemplate,
  parseLand,
  parseState,
  sampleHeight,
  snapStructureToTerrain,
  structureTerrainClearance,
  usesFootprintTerrainSnap,
} from '../lib/wulfram.ts';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'assets', 'base-templates.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'public', 'assets', 'manifest.json'), 'utf8'));
const sourceMaps = path.resolve(workspace, '..', 'wulfram-debug', 'data', 'maps');

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function circularDistance(left, right) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

void test('generated library contains every discovered powered base component', () => {
  assert.equal(library.format, 'wulfram-base-template-library');
  assert.equal(library.version, 1);
  assert.equal(library.templates.length, manifest.baseTemplates.count);
  assert.ok(library.templates.length >= 70, 'Expected powered bases from the shipped state maps.');
  assert.ok(new Set(library.templates.map((template) => template.sourceMap)).size >= 19);
  assert.equal(new Set(library.templates.map((template) => template.id)).size, library.templates.length, 'Template IDs must be unique.');

  let units = 0;
  for (const template of library.templates) {
    assert.equal(template.unitCount, template.units.length, `${template.id}: unit count`);
    assert.ok(template.units.some((unit) => unit.token === 'e'), `${template.id}: powered anchor`);
    assert.ok(template.footprint.width >= 0 && template.footprint.height >= 0, `${template.id}: footprint`);
    for (const unit of template.units) {
      assert.equal(unit.offset.length, 2, `${template.id}: XY offset`);
      assert.equal(unit.rotation.length, 3, `${template.id}: rotation`);
      assert.ok([...unit.offset, unit.groundOffset, ...unit.rotation].every(Number.isFinite), `${template.id}: finite placement values`);
      if (unit.token === 'c') assert.ok(unit.subtype, `${template.id}: cargo subtype`);
    }
    units += template.units.length;
  }
  assert.ok(units >= 800, 'The extracted library should include complete base formations and their nearby logistics.');
  console.log(`Verified ${library.templates.length} shipped base templates containing ${units} terrain-relative units.`);
});

void test('template records reconstruct units from their original maps', { skip: !fs.existsSync(sourceMaps) }, () => {
  const terrainCache = new Map();
  const stateCache = new Map();
  let reconstructed = 0;

  for (const template of library.templates) {
    const mapDirectory = path.join(sourceMaps, template.sourceMap);
    let terrain = terrainCache.get(template.sourceMap);
    if (!terrain) {
      terrain = parseLand(fs.readFileSync(path.join(mapDirectory, 'land'), 'utf8'));
      terrainCache.set(template.sourceMap, terrain);
    }
    const stateKey = `${template.sourceMap}/${template.sourceState}`;
    let sourceEntities = stateCache.get(stateKey);
    if (!sourceEntities) {
      sourceEntities = parseState(fs.readFileSync(path.join(mapDirectory, template.sourceState), 'utf8'));
      stateCache.set(stateKey, sourceEntities);
    }

    const reconstructedEntities = template.units.map((unit) => {
      const x = template.sourceAnchor[0] + unit.offset[0];
      const y = template.sourceAnchor[1] + unit.offset[1];
      return {
        token: unit.token,
        subtype: unit.subtype,
        team: template.sourceTeam,
        position: [x, y, sampleHeight(terrain, x, y) + unit.groundOffset],
        rotation: unit.rotation,
        active: unit.active,
      };
    });
    const used = new Set();
    for (const entity of reconstructedEntities) {
      const match = sourceEntities.findIndex((candidate, index) => {
        if (used.has(index)) return false;
        if (candidate.token !== entity.token || candidate.subtype !== entity.subtype || candidate.team !== entity.team || candidate.active !== entity.active) return false;
        if (Math.hypot(candidate.position[0] - entity.position[0], candidate.position[1] - entity.position[1]) > 2e-5) return false;
        if (Math.abs(candidate.position[2] - entity.position[2]) > 2e-4) return false;
        if (Math.abs(candidate.rotation[0] - entity.rotation[0]) > 5e-12 || Math.abs(candidate.rotation[1] - entity.rotation[1]) > 5e-12) return false;
        return circularDistance(candidate.rotation[2], entity.rotation[2]) <= 5e-12;
      });
      assert.notEqual(match, -1, `${template.id}: reconstructed ${entity.token} at ${entity.position.slice(0, 2).join(', ')}`);
      used.add(match);
      reconstructed += 1;
    }
  }
  console.log(`Matched ${reconstructed} template units back to their original state rows and terrain heights.`);
});

void test('template placement rotates, auto-fits, clamps, remaps, and terrain-conforms a formation', () => {
  const template = library.templates.reduce((largest, candidate) => (
    candidate.footprint.width * candidate.footprint.height > largest.footprint.width * largest.footprint.height
      ? candidate
      : largest
  ));
  const terrain = createBlankProject('Template fit', 9).terrain;
  terrain.worldWidth = 120;
  terrain.worldHeight = 90;
  terrain.heights = Array.from({ length: terrain.width * terrain.height }, (_, index) => {
    const x = index % terrain.width;
    const y = Math.floor(index / terrain.width);
    return x * 7 + y * 11;
  });

  const modeledUnits = template.units.filter((unit) => {
    const item = CATALOG.find((candidate) => candidate.token === unit.token && (unit.token !== 'c' || candidate.subtype === unit.subtype));
    return item ? catalogItemHasModel(item, 2, manifest) : false;
  });
  const placement = instantiateBaseTemplate(template, terrain, [-500, 900], 2, 1.5, Math.PI / 2, manifest);
  assert.equal(placement.entities.length, modeledUnits.length);
  assert.ok(placement.scale < 1.5, 'Oversized formation should auto-fit the destination terrain.');
  for (let index = 0; index < placement.entities.length; index += 1) {
    const entity = placement.entities[index];
    const source = modeledUnits[index];
    assert.equal(entity.team, 2, `unit ${index}: team remap`);
    assert.ok(entity.position[0] >= 10 - 1e-9 && entity.position[0] <= terrain.worldWidth - 10 + 1e-9, `unit ${index}: X bounds`);
    assert.ok(entity.position[1] >= 10 - 1e-9 && entity.position[1] <= terrain.worldHeight - 10 + 1e-9, `unit ${index}: Y bounds`);
    if (usesFootprintTerrainSnap(entity.token)) {
      const clearance = structureTerrainClearance(
        entity,
        manifest,
        (catalogFor(entity)?.footprint ?? 10) * placement.scale,
        source.groundOffset,
      );
      const expected = snapStructureToTerrain(
        terrain,
        entity.position[0],
        entity.position[1],
        clearance.footprint,
        entity.rotation[2],
        clearance.groundOffset,
        clearance.margin,
      );
      close(entity.position[2], expected.height, 1e-9, `unit ${index}: footprint-conformed Z`);
      close(entity.rotation[0], expected.pitch, 1e-12, `unit ${index}: slope pitch`);
      close(entity.rotation[1], expected.roll, 1e-12, `unit ${index}: slope roll`);
    } else {
      close(entity.position[2], sampleHeight(terrain, entity.position[0], entity.position[1]) + source.groundOffset, 1e-9, `unit ${index}: terrain-conformed Z`);
    }
    assert.ok(entity.rotation[2] >= 0 && entity.rotation[2] < Math.PI * 2, `unit ${index}: normalized yaw`);
    close(circularDistance(entity.rotation[2], source.rotation[2] + Math.PI / 2), 0, 1e-12, `unit ${index}: formation yaw`);
  }
});

void test('footprint snapping clears a sloped surface with an explicit safety margin', () => {
  const terrain = createBlankProject('Slope snap', 9).terrain;
  terrain.worldWidth = 80;
  terrain.worldHeight = 80;
  terrain.heights = Array.from({ length: 81 }, (_, index) => {
    const x = index % 9;
    const y = Math.floor(index / 9);
    return x * 3 + y * 5 + (x === 5 && y === 5 ? 7 : 0);
  });
  const result = snapStructureToTerrain(terrain, 40, 40, 24, Math.PI / 3, 3.8, 0.75);
  assert.ok(Number.isFinite(result.height) && Number.isFinite(result.pitch) && Number.isFinite(result.roll));
  assert.ok(result.safetyLift >= 0.75, 'The snap must retain its anti-clipping margin.');
  assert.notEqual(result.pitch, 0);
  assert.notEqual(result.roll, 0);
});

void test('repair and refuel pads clear their complete rendered undersides and edge terrain', () => {
  const terrain = createBlankProject('Pad clearance', 17).terrain;
  terrain.worldWidth = 160;
  terrain.worldHeight = 160;
  terrain.heights.fill(20);
  terrain.heights[8 * terrain.width + 5] = 29;
  terrain.heights[8 * terrain.width + 11] = 29;

  for (const token of ['f', 'r']) {
    assert.equal(usesFootprintTerrainSnap(token), true, `${token}: must use footprint snapping`);
    const item = CATALOG.find((candidate) => candidate.token === token);
    assert.ok(item);
    for (const team of [1, 2]) {
      const clearance = structureTerrainClearance({ token, team }, manifest, item.footprint, 0, 0.75);
      const asset = manifest.models[clearance.modelName];
      const renderedWidth = (asset.bounds.max[0] - asset.bounds.min[0]) * MODEL_WORLD_SCALE;
      const renderedDepth = (asset.bounds.max[1] - asset.bounds.min[1]) * MODEL_WORLD_SCALE;
      const renderedBottom = -asset.bounds.min[2] * MODEL_WORLD_SCALE;
      assert.ok(clearance.footprint >= renderedWidth, `${token}/${team}: full model width`);
      assert.ok(clearance.footprint >= renderedDepth, `${token}/${team}: full model depth`);
      assert.ok(clearance.groundOffset >= renderedBottom, `${token}/${team}: complete underside`);
      assert.ok(clearance.margin >= STRUCTURE_BOTTOM_MARGIN, `${token}/${team}: bottom margin`);

      const snapped = snapStructureToTerrain(
        terrain,
        80,
        80,
        clearance.footprint,
        0,
        clearance.groundOffset,
        clearance.margin,
      );
      assert.ok(
        snapped.height - clearance.modelBottom >= 29 + STRUCTURE_BOTTOM_MARGIN - 1e-9,
        `${token}/${team}: terrain peaks outside the legacy 26-unit footprint must not clip`,
      );
    }
  }
});

void test('every surviving placeable model uses full-bounds terrain clearance', () => {
  for (const item of CATALOG) {
    if (!catalogItemHasModel(item, 1, manifest)) continue;
    assert.equal(usesFootprintTerrainSnap(item.token), true, `${item.key}: terrain snapping`);
    for (const team of [0, 1, 2]) {
      const clearance = structureTerrainClearance({ token: item.token, team }, manifest, item.footprint, 0);
      const asset = manifest.models[clearance.modelName];
      assert.ok(asset, `${item.key}/${team}: model`);
      assert.ok(clearance.groundOffset >= -asset.bounds.min[2] * MODEL_WORLD_SCALE, `${item.key}/${team}: underside`);
      assert.ok(clearance.footprint >= (asset.bounds.max[0] - asset.bounds.min[0]) * MODEL_WORLD_SCALE, `${item.key}/${team}: width`);
      assert.ok(clearance.footprint >= (asset.bounds.max[1] - asset.bounds.min[1]) * MODEL_WORLD_SCALE, `${item.key}/${team}: depth`);
    }
  }
});

void test('build placement omits removed types while retaining neutral modeled units', () => {
  const unsupported = CATALOG.filter((item) => !catalogItemHasModel(item, 1, manifest));
  assert.deepEqual(unsupported.map((item) => item.key), [
    'shield',
    'silo',
    'portal',
    'bug',
    'cargo-shield',
    'cargo-silo',
    'cargo-portal',
    'cargo-bug',
  ]);
  const template = library.templates.find((candidate) => candidate.units.some((unit) => unit.token === 'h'));
  assert.ok(template, 'Expected a discovered base containing a removed supply-ship type.');
  const terrain = createBlankProject('Modeled units only', 17).terrain;
  const placement = instantiateBaseTemplate(template, terrain, [terrain.worldWidth / 2, terrain.worldHeight / 2], 0, 1, 0, manifest);
  assert.ok(placement.skippedWithoutModel > 0);
  assert.ok(placement.entities.every((entity) => entity.team === 0));
  assert.ok(placement.entities.every((entity) => entity.token !== 'h'));
});
