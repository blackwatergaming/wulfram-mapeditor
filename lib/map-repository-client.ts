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
}

export interface RepositoryCatalog {
  repository: string;
  branch: string;
  remote: string;
  changes: number;
  maps: RepositoryMapSummary[];
}

interface RepositoryMapResponse extends Omit<RepositoryCatalog, 'maps'> {
  slug: string;
  project: WulframProject;
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
    return { slug: result.slug, project: parseMapSourceFiles(result.files), repository: '', branch: '', remote: '', changes: 0 };
  }
  return repositoryRequest<RepositoryMapResponse>(`/maps/${encodeURIComponent(slug)}`);
}

export async function saveLocalRepositoryMap(slug: string, project: WulframProject): Promise<RepositoryMapResponse> {
  if (hasNativeRepositoryBridge()) {
    const files = createMapSourceFiles(project);
    const result = await nativeRequest<Omit<RepositoryMapResponse, 'project'>>('save', { slug, files });
    return { ...result, project: parseMapSourceFiles(files) };
  }
  return repositoryRequest<RepositoryMapResponse>(`/maps/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body: JSON.stringify({ project }),
  }, 20_000);
}

export function publishLocalRepositoryMap(slug: string): Promise<RepositoryCatalog & { committed: boolean; pushed: boolean; message: string }> {
  if (hasNativeRepositoryBridge()) return nativeRequest('publish', { slug });
  return repositoryRequest(`/maps/${encodeURIComponent(slug)}/publish`, { method: 'POST', body: '{}' }, 60_000);
}

export function configureLocalRepository(): Promise<RepositoryCatalog> {
  if (!hasNativeRepositoryBridge()) return Promise.reject(new Error('Repository selection is available in the desktop app.'));
  return nativeRequest('configure');
}
