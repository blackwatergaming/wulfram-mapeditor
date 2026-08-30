import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

import { createDesktopAssets } from './create-desktop-assets.mjs';

const ARCHIVE_DATE = new Date('2000-01-01T00:00:00.000Z');
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: workspace, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} exited with code ${result.status}.`);
}

function safeEmpty(directory) {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(`${workspace}${path.sep}`) || path.basename(resolved) !== 'win-x64') {
    throw new Error(`Refusing to clear unexpected desktop output: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function addDirectory(zip, source, prefix) {
  const pending = [source];
  const files = [];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  for (const file of files.sort()) {
    const relative = path.relative(source, file).replaceAll(path.sep, '/');
    zip.file(`${prefix}/${relative}`, fs.readFileSync(file), { date: ARCHIVE_DATE, unixPermissions: 0o644 });
  }
}

async function main() {
  const versionOption = process.argv.indexOf('--version');
  const version = versionOption >= 0 ? process.argv[versionOption + 1] : '0.2.0';
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Use --version with a semantic version such as 0.2.0.');

  run(process.execPath, [path.join(workspace, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.desktop.config.ts']);
  await createDesktopAssets();

  const bundledDotnet = path.join(workspace, '.dotnet-sdk', 'dotnet.exe');
  const dotnet = process.env.DOTNET_HOST_PATH || (fs.existsSync(bundledDotnet) ? bundledDotnet : 'dotnet');
  const publishDirectory = path.join(workspace, 'dist', 'desktop', 'win-x64');
  safeEmpty(publishDirectory);
  run(dotnet, [
    'publish',
    path.join('desktop', 'WulframForge', 'WulframForge.csproj'),
    '--configuration', 'Release',
    '--runtime', 'win-x64',
    '--self-contained', 'true',
    '--output', publishDirectory,
    `/p:Version=${version}`,
  ]);

  const zip = new JSZip();
  addDirectory(zip, publishDirectory, 'WulframForge');
  const fixedRuntime = process.env.WEBVIEW2_FIXED_RUNTIME_DIR;
  let suffix = 'self-contained';
  if (fixedRuntime) {
    const runtime = path.resolve(fixedRuntime);
    if (!fs.existsSync(path.join(runtime, 'msedgewebview2.exe'))) throw new Error('WEBVIEW2_FIXED_RUNTIME_DIR does not contain msedgewebview2.exe.');
    addDirectory(zip, runtime, 'WulframForge/WebView2Runtime');
    suffix = 'offline-fixed-webview2';
  }
  zip.file('README.txt', [
    'Wulfram Forge',
    '',
    'Run WulframForge/WulframForge.exe.',
    'The .NET runtime and editor assets are included; Node.js is not required.',
    fixedRuntime
      ? 'A fixed Edge WebView2 runtime is included for offline use.'
      : 'Microsoft Edge WebView2 Evergreen Runtime is required (included with current Windows 11 installations).',
    'Set WULFRAM_MAPS_REPO or use the in-app folder button if your wulfram-maps checkout is not discovered automatically.',
    '',
  ].join('\r\n'), { date: ARCHIVE_DATE, unixPermissions: 0o644 });
  const artifact = path.join(workspace, 'dist', 'desktop', `WulframForge-${version}-win-x64-${suffix}.zip`);
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  fs.writeFileSync(artifact, buffer);
  console.log(`Desktop release: ${artifact} (${(buffer.length / 1024 / 1024).toFixed(1)} MiB)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
