import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startRepositoryServer } from './maps-repository-server.mjs';

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const server = await startRepositoryServer();
const vinext = spawn(
  process.execPath,
  [path.join(workspace, 'node_modules', 'vinext', 'dist', 'cli.js'), 'dev'],
  {
    cwd: workspace,
    stdio: 'inherit',
  },
);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  server.close();
  if (!vinext.killed) vinext.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
vinext.on('exit', (code, signal) => {
  server.close();
  if (!stopping) process.exitCode = code ?? (signal ? 1 : 0);
});
vinext.on('error', (error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
