import { CATALOG, catalogItemHasModel, cloneProject, createId, ensureTextureTag, synchronizeActiveBaseLayout, validateProject, type AssetManifest, type StateEntity, type WulframProject } from './wulfram.ts';
import { hasLockedAltitudeAndRotation } from './model-transform.ts';

type ObjectValue = Record<string, unknown>;
export function object(value: unknown, keys: string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  const result = value as ObjectValue;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error('Unknown command field.');
  return result;
}
function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}
function flag(value: unknown): boolean {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('mirror must be boolean.');
  return value === true;
}
function ground(entity: StateEntity) {
  if (entity.token === '*' || hasLockedAltitudeAndRotation(entity)) throw new Error('Only ground structures can be edited.');
}
export function requireRevision(expected: unknown, current: string) {
  if (typeof expected !== 'string' || expected !== current) throw new Error('Stale map revision. Inspect the editor again before editing.');
}
export type ConformEntity = (entity: StateEntity, terrain: WulframProject['terrain']) => void;

function rejectNewErrors(before: WulframProject, after: WulframProject) {
  const key = (issue: ReturnType<typeof validateProject>[number]) => `${issue.entityId}:${issue.code}:${issue.message}`;
  const existing = new Set(validateProject(before).filter(i => i.severity === 'error').map(key));
  const added = validateProject(after).filter(i => i.severity === 'error' && !existing.has(key(i)));
  if (added.length) throw new Error(`New validation errors: ${added.map(i => `${i.entityId}: ${i.message}`).join('; ')}`);
}

/** Pure transaction: never changes the source, even when the final edit fails. */
export function applyMcpEdit(source: WulframProject, command: ObjectValue, manifest: AssetManifest, conform: ConformEntity) {
  const next = cloneProject(source);
  let vertices = 0;
  if (command.action === 'edit_entities') {
    object(command, ['action', 'expectedRevision', 'edits']);
    if (!Array.isArray(command.edits) || !command.edits.length || command.edits.length > 128) throw new Error('Expected 1–128 entity edits.');
    for (const raw of command.edits) {
      const edit = object(raw, ['operation', 'id', 'token', 'subtype', 'team', 'x', 'y', 'yaw', 'mirror']);
      const mirror = flag(edit.mirror);
      if (!['add', 'move', 'remove'].includes(String(edit.operation))) throw new Error('Unknown entity operation.');
      for (const key of ['x', 'y', 'yaw']) if (edit[key] !== undefined) finite(edit[key], key);
      if (edit.id !== undefined && (typeof edit.id !== 'string' || !edit.id.length || edit.id.length > 200)) throw new Error('Invalid entity ID.');
      let entity: StateEntity;
      if (edit.operation === 'add') {
        const item = CATALOG.find(i => i.token === edit.token && i.subtype === edit.subtype);
        if (!item || ![1, 2].includes(Number(edit.team)) || typeof edit.team !== 'number' || !catalogItemHasModel(item, edit.team, manifest)) throw new Error('Choose an available ground structure and team 1 or 2.');
        entity = { id: typeof edit.id === 'string' ? edit.id : createId('mcp'), token: item.token, ...(item.subtype ? { subtype: item.subtype } : {}), team: edit.team, position: [finite(edit.x, 'x'), finite(edit.y, 'y'), 0], rotation: [0, 0, edit.yaw === undefined ? 0 : finite(edit.yaw, 'yaw')], active: 1 };
        ground(entity);
        if (next.entities.some(e => e.id === entity.id)) throw new Error('Duplicate entity ID.');
        next.entities.push(entity);
        conform(entity, next.terrain);
        if (mirror) {
          const partner: StateEntity = { ...entity, id: createId('mcp'), team: 3 - entity.team, position: [next.terrain.worldWidth - entity.position[0], next.terrain.worldHeight - entity.position[1], 0], rotation: [0, 0, entity.rotation[2] + Math.PI] };
          conform(partner, next.terrain);
          next.entities.push(partner);
        }
      } else {
        if (edit.token !== undefined || edit.subtype !== undefined || edit.team !== undefined) throw new Error('Type and team are only accepted for additions.');
        const matches = next.entities.filter(e => e.id === edit.id);
        if (matches.length !== 1) throw new Error('Entity ID must identify one structure.');
        entity = matches[0];
        ground(entity);
        let partner: StateEntity | undefined;
        if (mirror) {
          const partners = next.entities.filter(e => e.id !== entity.id && [1, 2].includes(entity.team) && e.team === 3 - entity.team && e.token === entity.token && e.subtype === entity.subtype && Math.hypot(e.position[0] + entity.position[0] - next.terrain.worldWidth, e.position[1] + entity.position[1] - next.terrain.worldHeight) < 0.1);
          if (partners.length !== 1) throw new Error('Mirroring requires a unique opposing partner.');
          partner = partners[0];
        }
        if (edit.operation === 'remove') {
          if (['x', 'y', 'yaw'].some(k => edit[k] !== undefined)) throw new Error('Remove does not accept a transform.');
          next.entities = next.entities.filter(e => e !== entity && e !== partner);
        } else {
          if (['x', 'y', 'yaw'].every(k => edit[k] === undefined)) throw new Error('Move requires a coordinate or yaw.');
          const oldYaw = entity.rotation[2];
          if (edit.x !== undefined) entity.position[0] = finite(edit.x, 'x');
          if (edit.y !== undefined) entity.position[1] = finite(edit.y, 'y');
          if (edit.yaw !== undefined) entity.rotation[2] = finite(edit.yaw, 'yaw');
          conform(entity, next.terrain);
          if (partner) {
            partner.position[0] = next.terrain.worldWidth - entity.position[0];
            partner.position[1] = next.terrain.worldHeight - entity.position[1];
            partner.rotation[2] += entity.rotation[2] - oldYaw;
            conform(partner, next.terrain);
          }
        }
      }
    }
  } else if (command.action === 'edit_terrain') {
    object(command, ['action', 'expectedRevision', 'brush']);
    const brush = object(command.brush, ['operation', 'x', 'y', 'radius', 'value', 'texture', 'mirror']);
    const operation = String(brush.operation);
    if (!['raise', 'lower', 'flatten', 'smooth', 'texture'].includes(operation)) throw new Error('Unknown terrain operation.');
    const x = finite(brush.x, 'x'), y = finite(brush.y, 'y'), radius = finite(brush.radius, 'radius');
    if (radius <= 0 || x < 0 || y < 0 || x > next.terrain.worldWidth || y > next.terrain.worldHeight) throw new Error('Brush center must be in bounds and radius positive.');
    const value = ['raise', 'lower', 'flatten'].includes(operation) ? finite(brush.value, 'value') : 0;
    if (['raise', 'lower'].includes(operation) && value < 0) throw new Error('Raise/lower amount must be nonnegative.');
    if (brush.value !== undefined) finite(brush.value, 'value');
    if (operation === 'texture' && (typeof brush.texture !== 'string' || !Object.hasOwn(manifest.terrainTextures, brush.texture))) throw new Error('Unknown terrain texture.');
    const texture = operation === 'texture' ? ensureTextureTag(next.terrain, brush.texture as string) : 0;
    const centers = [[x, y]];
    if (flag(brush.mirror)) centers.push([next.terrain.worldWidth - x, next.terrain.worldHeight - y]);
    const { width, height, worldWidth, worldHeight } = next.terrain;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const wx = col * worldWidth / (width - 1), wy = row * worldHeight / (height - 1);
      if (!centers.some(([cx, cy]) => Math.hypot(wx - cx, wy - cy) <= radius)) continue;
      const index = row * width + col, original = source.terrain.heights[index];
      // The editor pins the outer terrain ring at zero for game compatibility.
      if (operation !== 'texture' && (row === 0 || col === 0 || row === height - 1 || col === width - 1)) continue;
      if (operation === 'texture') next.terrain.textureIds[index] = texture;
      else if (operation === 'flatten') next.terrain.heights[index] = value;
      else if (operation === 'smooth') {
        let total = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nr = row + dy, nc = col + dx;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width) { total += source.terrain.heights[nr * width + nc]; count++; }
        }
        next.terrain.heights[index] = total / count;
      } else next.terrain.heights[index] = original + (operation === 'raise' ? value : -value);
      if (!Number.isFinite(next.terrain.heights[index])) throw new Error('Terrain height overflow.');
      if (next.terrain.heights[index] !== original || next.terrain.textureIds[index] !== source.terrain.textureIds[index]) vertices++;
    }
    if (!vertices) throw new Error('Brush did not change any vertices.');
    for (const entity of next.entities) conform(entity, next.terrain);
    for (const layout of next.baseLayouts) if (layout.id !== next.activeBaseLayoutId) {
      for (const entity of layout.entities) conform(entity, next.terrain);
      const previous = source.baseLayouts.find(l => l.id === layout.id)!;
      rejectNewErrors({ ...source, entities: previous.entities, validation: previous.validation }, { ...next, entities: layout.entities, validation: layout.validation });
    }
  } else throw new Error('Unknown edit action.');
  rejectNewErrors(source, next);
  next.updatedAt = new Date().toISOString();
  synchronizeActiveBaseLayout(next, next.updatedAt);
  return { project: next, vertices };
}
