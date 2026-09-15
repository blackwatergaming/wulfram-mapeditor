import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { applyMcpEdit, object, requireRevision, type ConformEntity } from './mcp-commands.ts';
import { cloneProject, validateProject, type AssetManifest, type WulframProject } from './wulfram.ts';

interface BridgeState {
  project?: WulframProject;
  manifest?: AssetManifest;
  selectedEntityId?: string;
  undoCount: number;
  redoCount: number;
  dirty: boolean;
  busy: boolean;
  commit: (project: WulframProject, terrain: boolean) => void;
  undo: () => void;
  conform: ConformEntity;
}
declare global {
  interface Window {
    wulframMcpEnabled?: boolean;
    wulframMcp?: (command: unknown) => unknown;
  }
}

export function useMcpBridge(state: BridgeState) {
  const live = useRef(state);
  const revision = useRef('');
  const previous = useRef<WulframProject | undefined>(undefined);
  useLayoutEffect(() => {
    if (previous.current !== state.project) {
      previous.current = state.project;
      revision.current = crypto.randomUUID();
    }
    live.current = state;
  });
  useLayoutEffect(() => {
    if (!window.wulframMcpEnabled) return;
    const inspect = () => {
      const s = live.current;
      return { ready: Boolean(s.project && s.manifest), name: s.project?.name, revision: revision.current, selection: s.selectedEntityId, undoCount: s.undoCount, redoCount: s.redoCount, dirty: s.dirty };
    };
    const execute = (raw: unknown) => {
      try {
        const command = object(raw, ['action', 'expectedRevision', 'edits', 'brush']);
        const s = live.current;
        if (command.action === 'get_editor_state') return { ok: true, result: inspect() };
        if (!s.project || !s.manifest) throw new Error('Editor is not ready.');
        if (command.action === 'inspect_map') return { ok: true, result: { ...inspect(), terrain: s.project.terrain, entities: s.project.entities, activeBaseLayoutId: s.project.activeBaseLayoutId, baseLayouts: s.project.baseLayouts } };
        if (command.action === 'validate_map') return { ok: true, result: { ...inspect(), issues: validateProject(s.project) } };
        requireRevision(command.expectedRevision, revision.current);
        if (s.busy) throw new Error('Editor operation in progress. Inspect again after it finishes.');
        if (command.action === 'get_snapshot') return { ok: true, result: { revision: revision.current, project: cloneProject(s.project) } };
        let vertices = 0;
        if (command.action === 'undo') {
          object(command, ['action', 'expectedRevision']);
          if (!s.undoCount) throw new Error('There is no edit to undo.');
          flushSync(s.undo);
        } else {
          const result = applyMcpEdit(s.project, command, s.manifest, s.conform);
          vertices = result.vertices;
          flushSync(() => s.commit(result.project, command.action === 'edit_terrain'));
        }
        return { ok: true, result: { ...inspect(), vertices } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Editor command failed.' };
      }
    };
    window.wulframMcp = execute;
    return () => { if (window.wulframMcp === execute) delete window.wulframMcp; };
  }, []);
}
