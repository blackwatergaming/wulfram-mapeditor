import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activateBaseLayout,
  cloneProject,
  createBlankProject,
  synchronizeActiveBaseLayout,
} from '../lib/wulfram.ts';

const unit = (id, x) => ({
  id,
  token: 'e',
  team: 1,
  position: [x, 200, 4],
  rotation: [0, 0, 0],
  active: 1,
});

void test('legacy single-state projects upgrade to one editable default layout', () => {
  const legacy = createBlankProject('Legacy');
  legacy.entities = [unit('legacy-cell', 100)];
  delete legacy.baseLayouts;
  delete legacy.activeBaseLayoutId;

  const upgraded = cloneProject(legacy);
  assert.equal(upgraded.activeBaseLayoutId, 'default');
  assert.equal(upgraded.baseLayouts.length, 1);
  assert.deepEqual(upgraded.baseLayouts[0].entities, upgraded.entities);
});

void test('switching layouts saves the outgoing state and restores the incoming state', () => {
  const project = createBlankProject('States');
  project.entities = [unit('day-cell', 100)];
  synchronizeActiveBaseLayout(project);
  project.baseLayouts.push({
    id: 'night',
    name: 'Night assault',
    metadata: { lighting: 'night' },
    entities: [unit('night-cell', 300)],
    validation: { ...project.validation },
    updatedAt: project.updatedAt,
  });

  activateBaseLayout(project, 'night');
  assert.equal(project.entities[0].id, 'night-cell');
  project.entities[0].position[0] = 325;
  synchronizeActiveBaseLayout(project);

  activateBaseLayout(project, 'default');
  assert.equal(project.entities[0].id, 'day-cell');
  assert.equal(project.entities[0].position[0], 100);
  activateBaseLayout(project, 'night');
  assert.equal(project.entities[0].position[0], 325);
  assert.deepEqual(project.baseLayouts[1].metadata, { lighting: 'night' });
});
