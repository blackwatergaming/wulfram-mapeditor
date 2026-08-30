import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  listRepositoryMaps,
  loadRepositoryMap,
  publishRepositoryMaps,
  repositoryDiagnostics,
  repositoryGitInfo,
  resolveMapsRepository,
  saveRepositoryMap,
  switchRepositoryBranch,
} from './map-repository-lib.mjs';

const DEFAULT_PORT = 4319;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const ALLOWED_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGIN.test(origin))
    response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
}

function json(request, response, status, value) {
  setCors(request, response);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function allowedRequest(request) {
  const origin = request.headers.origin;
  return !origin || ALLOWED_ORIGIN.test(origin);
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES)
      throw new Error('Request body exceeds the 32 MiB local-service limit.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function routeSlug(pathname) {
  const match = pathname.match(/^\/maps\/([^/]+)(?:\/(publish))?$/);
  return match
    ? { slug: decodeURIComponent(match[1]), action: match[2] }
    : undefined;
}

export async function startRepositoryServer(options = {}) {
  const repository = resolveMapsRepository(options.repository);
  const port = Number(
    options.port ?? process.env.WULFRAM_MAPS_PORT ?? DEFAULT_PORT,
  );
  const server = http.createServer(async (request, response) => {
    try {
      if (!allowedRequest(request)) {
        json(request, response, 403, {
          error: 'Only loopback editor origins may use this service.',
        });
        return;
      }
      if (request.method === 'OPTIONS') {
        setCors(request, response);
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        json(request, response, 200, {
          ok: true,
          service: 'Wulfram maps service',
          repository: path.resolve(repository),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/diagnostics') {
        json(request, response, 200, repositoryDiagnostics(repository));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/maps') {
        json(request, response, 200, {
          ...repositoryGitInfo(repository),
          maps: listRepositoryMaps(repository),
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/branches') {
        const body = await readJsonBody(request);
        switchRepositoryBranch(repository, body.branch, Boolean(body.create));
        json(request, response, 200, {
          ...repositoryGitInfo(repository),
          maps: listRepositoryMaps(repository),
        });
        return;
      }
      const route = routeSlug(url.pathname);
      if (request.method === 'GET' && route && !route.action) {
        json(request, response, 200, {
          slug: route.slug,
          project: loadRepositoryMap(repository, route.slug),
        });
        return;
      }
      if (request.method === 'PUT' && route && !route.action) {
        const body = await readJsonBody(request);
        const saved = saveRepositoryMap(repository, route.slug, body.project);
        json(request, response, 200, {
          slug: saved.slug,
          project: saved.project,
          ...repositoryGitInfo(repository),
        });
        return;
      }
      if (request.method === 'POST' && route?.action === 'publish') {
        const result = publishRepositoryMaps(repository, [route.slug]);
        json(request, response, 200, {
          ...result,
          ...repositoryGitInfo(repository),
          maps: listRepositoryMaps(repository),
        });
        return;
      }
      json(request, response, 404, { error: 'Unknown local maps endpoint.' });
    } catch (error) {
      json(request, response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  console.log(
    `Wulfram maps service: http://127.0.0.1:${boundPort} (${path.resolve(repository)})`,
  );
  console.log(`Diagnostics: http://127.0.0.1:${boundPort}/diagnostics`);
  const startup = repositoryDiagnostics(repository);
  for (const check of startup.checks.filter((entry) => entry.status === 'fail')) {
    console.warn(`[setup] ${check.label}: ${check.detail}${check.fix ? ` Fix: ${check.fix}` : ''}`);
  }
  return server;
}

const entry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (entry === import.meta.url) {
  startRepositoryServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
