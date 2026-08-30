import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

import { createMapArchive } from '../lib/map-package.ts';
import {
  MAP_SOURCE_FILES,
  createMapSourceFiles,
  parseMapSourceFiles,
} from '../lib/map-source.ts';

const ARCHIVE_DATE = new Date('2000-01-01T00:00:00.000Z');
const EDITOR_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,79})$/;

export const MAPS_REPOSITORY_NAME = 'blackwatergaming/wulfram-maps';
export const DEFAULT_MAPS_REPOSITORY = path.resolve(
  EDITOR_ROOT,
  '..',
  'wulfram-maps',
);

export function resolveMapsRepository(value = process.env.WULFRAM_MAPS_REPO) {
  return value ? path.resolve(value) : DEFAULT_MAPS_REPOSITORY;
}

export function assertMapSlug(slug) {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      'Map slug must be 1–80 lowercase letters, numbers, dashes, or underscores.',
    );
  }
  return slug;
}

export function assertMapsRepository(repository) {
  const resolved = path.resolve(repository);
  if (!fs.existsSync(path.join(resolved, '.git'))) {
    throw new Error(
      `${resolved} is not a Git checkout. Clone ${MAPS_REPOSITORY_NAME} beside the editor first.`,
    );
  }
  return resolved;
}

function sourceDirectory(repository, slug) {
  const root = path.join(assertMapsRepository(repository), 'maps');
  const target = path.resolve(root, assertMapSlug(slug));
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`))
    throw new Error('Map path escapes the repository.');
  return target;
}

export function readMapSourceDirectory(repository, slug) {
  const directory = sourceDirectory(repository, slug);
  const files = {};
  for (const fileName of MAP_SOURCE_FILES) {
    const file = path.join(directory, fileName);
    if (!fs.existsSync(file))
      throw new Error(`${slug} is missing ${fileName}.`);
    files[fileName] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

export function loadRepositoryMap(repository, slug) {
  return parseMapSourceFiles(readMapSourceDirectory(repository, slug));
}

export function listRepositoryMaps(repository) {
  const resolved = assertMapsRepository(repository);
  const mapsRoot = path.join(resolved, 'maps');
  if (!fs.existsSync(mapsRoot)) return [];
  return fs
    .readdirSync(mapsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SLUG_PATTERN.test(entry.name))
    .map((entry) => {
      const project = loadRepositoryMap(resolved, entry.name);
      return {
        slug: entry.name,
        name: project.name,
        updatedAt: project.updatedAt,
        width: project.terrain.width,
        height: project.terrain.height,
        entities: project.entities.length,
      };
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.slug.localeCompare(right.slug),
    );
}

export function repositoryGitInfo(repository) {
  const resolved = assertMapsRepository(repository);
  const branch =
    runGit(resolved, ['branch', '--show-current'], { allowEmpty: true }) ||
    '(detached)';
  const remote = runGit(resolved, ['remote', 'get-url', 'origin'], {
    allowEmpty: true,
  });
  const changes = runGit(resolved, ['status', '--porcelain', '--', 'maps'], {
    allowEmpty: true,
  })
    .split(/\r?\n/)
    .filter(Boolean).length;
  return { repository: resolved, branch, remote, changes };
}

export function saveRepositoryMap(repository, requestedSlug, project) {
  const resolved = assertMapsRepository(repository);
  const slug = assertMapSlug(requestedSlug);
  const canonicalFiles = createMapSourceFiles(project);
  const canonicalProject = parseMapSourceFiles(canonicalFiles);
  const directory = sourceDirectory(resolved, slug);
  fs.mkdirSync(directory, { recursive: true });
  for (const fileName of MAP_SOURCE_FILES) {
    fs.writeFileSync(
      path.join(directory, fileName),
      canonicalFiles[fileName],
      'utf8',
    );
  }
  return { slug, project: canonicalProject, directory };
}

export async function compileRepositoryMap(repository, slug, outputDirectory) {
  const project = loadRepositoryMap(repository, assertMapSlug(slug));
  const archive = Buffer.from(await createMapArchive(project));
  const output = path.resolve(outputDirectory, `${slug}.zip`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, archive);
  return {
    slug,
    name: project.name,
    output,
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
    archive,
  };
}

export async function compileRepository(repository, slugs, outputDirectory) {
  const available = listRepositoryMaps(repository);
  const selected = slugs?.length
    ? slugs.map(assertMapSlug)
    : available.map((entry) => entry.slug);
  if (!selected.length)
    throw new Error('The maps repository does not contain any map sources.');
  const known = new Set(available.map((entry) => entry.slug));
  for (const slug of selected) {
    if (!known.has(slug)) throw new Error(`Unknown repository map: ${slug}`);
  }
  const compiled = [];
  for (const slug of selected)
    compiled.push(
      await compileRepositoryMap(repository, slug, outputDirectory),
    );
  return compiled;
}

export async function buildReleaseArtifacts(repository, tag, outputDirectory) {
  const safeTag = tag.replace(/[^a-z0-9._-]+/gi, '-');
  if (!safeTag) throw new Error('A release tag is required.');
  const compiled = await compileRepository(
    repository,
    undefined,
    outputDirectory,
  );
  const collection = new JSZip();
  const manifest = {
    format: 'wulfram-map-release',
    version: 1,
    tag,
    maps: compiled.map(({ slug, name, bytes, sha256 }) => ({
      slug,
      name,
      file: `${slug}.zip`,
      bytes,
      sha256,
    })),
  };
  collection.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, {
    date: ARCHIVE_DATE,
    unixPermissions: 0o644,
  });
  for (const artifact of compiled) {
    collection.file(`maps/${artifact.slug}.zip`, artifact.archive, {
      date: ARCHIVE_DATE,
      unixPermissions: 0o644,
    });
  }
  const collectionBuffer = await collection.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  const collectionName = `wulfram-maps-${safeTag}.zip`;
  const collectionPath = path.resolve(outputDirectory, collectionName);
  fs.writeFileSync(collectionPath, collectionBuffer);
  const releaseFiles = compiled.map((artifact) => artifact.output);
  releaseFiles.push(collectionPath);
  const checksums = releaseFiles
    .map(
      (file) =>
        `${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`,
    )
    .join('\n');
  const checksumPath = path.resolve(outputDirectory, 'SHA256SUMS.txt');
  fs.writeFileSync(checksumPath, `${checksums}\n`, 'utf8');
  releaseFiles.push(checksumPath);
  return { compiled, collectionPath, checksumPath, releaseFiles, manifest };
}

export function runGit(repository, args, options = {}) {
  try {
    return execFileSync(
      'git',
      ['-C', assertMapsRepository(repository), ...args],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch (error) {
    if (options.allowEmpty && error?.status === 0) return '';
    const detail =
      error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

export function publishRepositoryMaps(repository, slugs) {
  const resolved = assertMapsRepository(repository);
  const selected = slugs?.length
    ? [...new Set(slugs.map(assertMapSlug))]
    : listRepositoryMaps(resolved).map((map) => map.slug);
  if (!selected.length)
    throw new Error('No maps were selected for publishing.');
  const alreadyStaged = runGit(resolved, ['diff', '--cached', '--name-only'], {
    allowEmpty: true,
  });
  if (alreadyStaged)
    throw new Error(
      'The maps checkout already has staged changes. Commit or unstage them before publishing.',
    );
  const paths = selected.map((slug) => `maps/${slug}`);
  runGit(resolved, ['add', '--', ...paths]);
  const staged = runGit(
    resolved,
    ['diff', '--cached', '--name-only', '--', ...paths],
    { allowEmpty: true },
  );
  if (!staged)
    return {
      committed: false,
      pushed: false,
      slugs: selected,
      message: 'Sources already match Git.',
    };
  const label =
    selected.length === 1
      ? loadRepositoryMap(resolved, selected[0]).name
      : `${selected.length} maps`;
  runGit(resolved, ['commit', '-m', `Update ${label}`]);
  runGit(resolved, ['push', 'origin', 'HEAD']);
  return {
    committed: true,
    pushed: true,
    slugs: selected,
    message: `Published ${label}.`,
  };
}
