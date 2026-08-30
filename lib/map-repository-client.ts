import { createMapSourceFiles, parseMapSourceFiles, type MapSourceFiles } from './map-source.ts';
import type { WulframProject } from './wulfram.ts';

export const MAP_REPOSITORY_SERVICE = 'http://127.0.0.1:4319';

export interface RepositoryMapSummary {
  slug: string;
  name: string;
  updatedAt: string;
  width: number;
  height: number;
  entities: number;
  layouts: number;
}

export interface RepositoryCatalog {
  repository: string;
  branch: string;
  remote: string;
  changes: number;
  branches: string[];
  defaultBranch: string;
  maps: RepositoryMapSummary[];
}

export interface RepositoryDiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

export interface RepositoryDiagnostics extends Partial<Omit<RepositoryCatalog, 'maps'>> {
  ok: boolean;
  service: string;
  repository: string;
  checks: RepositoryDiagnosticCheck[];
}

interface RepositoryMapResponse {
  slug: string;
  project: WulframProject;
  scope?: RepositorySaveScope;
  writtenFiles?: string[];
  repository?: string;
  branch?: string;
  remote?: string;
  changes?: number;
}

export type RepositorySaveScope = 'all' | 'terrain' | 'base';

export interface RepositoryPublishResult extends RepositoryCatalog {
  committed: boolean;
  pushed: boolean;
  prCreated: boolean;
  prUrl: string;
  baseBranch: string;
  message: string;
}

interface NativeWebView {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

interface NativeResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

const nativeRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
let listeningForNativeResponses = false;

function nativeWebView(): NativeWebView | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as typeof window & { chrome?: { webview?: NativeWebView } }).chrome?.webview;
}

export function hasNativeRepositoryBridge(): boolean {
  return Boolean(nativeWebView());
}

function nativeRequest<T>(action: string, payload: Record<string, unknown> = {}, timeout = 60_000): Promise<T> {
  const webview = nativeWebView();
  if (!webview) return Promise.reject(new Error('The native WebView2 repository bridge is unavailable.'));
  if (!listeningForNativeResponses) {
    listeningForNativeResponses = true;
    webview.addEventListener('message', (event) => {
      const response = event.data as NativeResponse;
      const pending = response?.id ? nativeRequests.get(response.id) : undefined;
      if (!pending) return;
      clearTimeout(pending.timer);
      nativeRequests.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || 'The native repository operation failed.'));
    });
  }
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeRequests.delete(id);
      reject(new Error(`Native repository operation ${action} timed out.`));
    }, timeout);
    nativeRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    webview.postMessage({ id, action, ...payload });
  });
}

async function repositoryRequest<T>(pathname: string, init?: RequestInit, timeout = 8000): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${MAP_REPOSITORY_SERVICE}${pathname}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `Local maps service returned HTTP ${response.status}.`);
  return value;
}

export function listLocalRepositoryMaps(timeout = 1500): Promise<RepositoryCatalog> {
  if (hasNativeRepositoryBridge()) return nativeRequest<RepositoryCatalog>('list', {}, Math.max(timeout, 8000));
  return repositoryRequest<RepositoryCatalog>('/maps', undefined, timeout);
}

export async function loadLocalRepositoryMap(slug: string): Promise<RepositoryMapResponse> {
  if (hasNativeRepositoryBridge()) {
    const result = await nativeRequest<{ slug: string; files: MapSourceFiles }>('load', { slug });
    return { slug: result.slug, project: parseMapSourceFiles(result.files) };
  }
  return repositoryRequest<RepositoryMapResponse>(`/maps/${encodeURIComponent(slug)}`);
}

export async function saveLocalRepositoryMap(
  slug: string,
  project: WulframProject,
  scope: RepositorySaveScope = 'all',
): Promise<RepositoryMapResponse> {
  if (hasNativeRepositoryBridge()) {
    const files = createMapSourceFiles(project);
    const result = await nativeRequest<Omit<RepositoryMapResponse, 'project'>>('save', { slug, files, scope });
    const loaded = await nativeRequest<{ slug: string; files: MapSourceFiles }>('load', { slug });
    return { ...result, project: parseMapSourceFiles(loaded.files) };
  }
  return repositoryRequest<RepositoryMapResponse>(`/maps/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body: JSON.stringify({ project, scope }),
  }, 20_000);
}

export function publishLocalRepositoryMap(slug: string): Promise<RepositoryPublishResult> {
  if (hasNativeRepositoryBridge()) return nativeRequest('publish', { slug }, 120_000);
  return repositoryRequest(`/maps/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: '{}' }, 120_000);
}

export function configureLocalRepository(): Promise<RepositoryCatalog> {
  if (!hasNativeRepositoryBridge()) return Promise.reject(new Error('Repository selection is available in the desktop app.'));
  return nativeRequest('configure');
}

export function diagnoseLocalRepository(timeout = 8000): Promise<RepositoryDiagnostics> {
  if (hasNativeRepositoryBridge()) return nativeRequest('diagnostics', {}, Math.max(timeout, 8000));
  return repositoryRequest('/diagnostics', undefined, timeout);
}

export function switchLocalRepositoryBranch(branch: string, create = false): Promise<RepositoryCatalog> {
  if (hasNativeRepositoryBridge()) return nativeRequest('branch', { branch, create });
  return repositoryRequest('/branches', {
    method: 'POST',
    body: JSON.stringify({ branch, create }),
  }, 20_000);
}
