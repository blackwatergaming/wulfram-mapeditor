import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activateBaseLayout,
  cloneProject,
  createBlankProject,
  synchronizeActiveBaseLayout,
  validateProject,
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

const stateUnit = (id, token, team, x, y) => ({
  id,
  token,
  team,
  position: [x, y, 4],
  rotation: [0, 0, 0],
  active: 1,
});

const stateRequirements = (project) => validateProject(project).filter((issue) => issue.code.startsWith('state-'));

void test('state validation requires an uplink and a powered repair pad for both teams', () => {
  const project = createBlankProject('Required team infrastructure');

  assert.deepEqual(stateRequirements(project).map((issue) => issue.message), [
    'Team 1 must have an uplink.',
    'Team 1 must have at least one powered repair pad.',
    'Team 2 must have an uplink.',
    'Team 2 must have at least one powered repair pad.',
  ]);

  project.entities = [
    stateUnit('team-1-cell', 'e', 1, 200, 200),
    stateUnit('team-1-repair', 'r', 1, 600, 200),
    stateUnit('team-1-uplink', 'u', 1, 200, 400),
    stateUnit('team-2-cell', 'e', 2, 1200, 200),
    stateUnit('team-2-repair', 'r', 2, 1300, 200),
    stateUnit('team-2-uplink', 'u', 2, 1200, 400),
  ];

  assert.deepEqual(stateRequirements(project).map((issue) => issue.message), [
    'Team 1 must have at least one powered repair pad.',
  ]);
  project.entities.find((entity) => entity.id === 'team-1-repair').position[0] = 300;
  assert.deepEqual(stateRequirements(project), []);
});
