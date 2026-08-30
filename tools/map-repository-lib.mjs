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
export const DEFAULT_MAPS_BRANCH = 'main';
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

export function assertBranchName(branch) {
  if (typeof branch !== 'string' || !branch || branch !== branch.trim() || branch.length > 120) {
    throw new Error('Branch names must be 1–120 characters without surrounding whitespace.');
  }
  try {
    execFileSync('git', ['check-ref-format', '--branch', branch], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch {
    throw new Error(`Invalid Git branch name: ${branch}`);
  }
  return branch;
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
  const branches = runGit(
    resolved,
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    { allowEmpty: true },
  ).split(/\r?\n/).filter(Boolean).sort((left, right) => left.localeCompare(right));
  return {
    repository: resolved,
    branch,
    remote,
    changes,
    branches,
    defaultBranch: DEFAULT_MAPS_BRANCH,
  };
}

function tryExecutable(command, args, options = {}) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
      error: '',
    };
  } catch (error) {
    return {
      ok: false,
      output: error?.stdout?.toString().trim() || '',
      error: error?.stderr?.toString().trim() || error?.message || String(error),
    };
  }
}

function diagnostic(id, label, status, detail, fix = '') {
  return { id, label, status, detail, fix };
}

export function repositoryDiagnostics(repository) {
  const resolved = path.resolve(repository);
  const checks = [];
  checks.push(diagnostic(
    'repository',
    'Maps checkout',
    fs.existsSync(path.join(resolved, '.git')) ? 'pass' : 'fail',
    fs.existsSync(path.join(resolved, '.git'))
      ? resolved
      : `No Git checkout was found at ${resolved}.`,
    `gh repo clone ${MAPS_REPOSITORY_NAME} "${resolved}"`,
  ));
  const gitVersion = tryExecutable('git', ['--version']);
  checks.push(diagnostic(
    'git',
    'Git command',
    gitVersion.ok ? 'pass' : 'fail',
    gitVersion.ok ? gitVersion.output : 'Git is not available on PATH.',
    'Install Git for Windows and restart Wulfram Forge.',
  ));
  const ghVersion = tryExecutable('gh', ['--version']);
  checks.push(diagnostic(
    'github-cli',
    'GitHub CLI',
    ghVersion.ok ? 'pass' : 'fail',
    ghVersion.ok ? ghVersion.output.split(/\r?\n/)[0] : 'GitHub CLI is not available on PATH.',
    'Install GitHub CLI, then run: gh auth login',
  ));
  const ghAuth = ghVersion.ok
    ? tryExecutable('gh', ['auth', 'status', '--hostname', 'github.com'])
    : { ok: false, output: '', error: '' };
  checks.push(diagnostic(
    'github-auth',
    'GitHub authentication',
    ghAuth.ok ? 'pass' : 'fail',
    ghAuth.ok ? 'Authenticated with github.com.' : 'GitHub CLI is not authenticated.',
    'Run: gh auth login',
  ));

  let gitInfo;
  if (fs.existsSync(path.join(resolved, '.git')) && gitVersion.ok) {
    try {
      gitInfo = repositoryGitInfo(resolved);
      const correctRemote = /(?:github\.com[/:])blackwatergaming\/wulfram-maps(?:\.git)?$/i.test(gitInfo.remote);
      checks.push(diagnostic(
        'origin',
        'Origin remote',
        correctRemote ? 'pass' : 'warn',
        gitInfo.remote || 'No origin remote is configured.',
        `git remote set-url origin https://github.com/${MAPS_REPOSITORY_NAME}.git`,
      ));
      const hasMain = gitInfo.branches.includes(DEFAULT_MAPS_BRANCH)
        || tryExecutable('git', ['-C', resolved, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${DEFAULT_MAPS_BRANCH}`]).ok;
      checks.push(diagnostic(
        'main',
        'PR target branch',
        hasMain ? 'pass' : 'fail',
        hasMain ? `${DEFAULT_MAPS_BRANCH} is available.` : `${DEFAULT_MAPS_BRANCH} is missing locally and from origin.`,
        `git fetch origin ${DEFAULT_MAPS_BRANCH}:${DEFAULT_MAPS_BRANCH}`,
      ));
      checks.push(diagnostic(
        'branch',
        'Working branch',
        gitInfo.branch === '(detached)' ? 'fail' : gitInfo.branch === DEFAULT_MAPS_BRANCH ? 'warn' : 'pass',
        gitInfo.branch === DEFAULT_MAPS_BRANCH
          ? 'On main; Publish will create a feature branch automatically.'
          : `On ${gitInfo.branch}.`,
      ));
      checks.push(diagnostic(
        'worktree',
        'Map working tree',
        gitInfo.changes ? 'warn' : 'pass',
        gitInfo.changes ? `${gitInfo.changes} uncommitted map path(s).` : 'Map sources are clean.',
      ));
    } catch (error) {
      checks.push(diagnostic('git-checkout', 'Git checkout', 'fail', error instanceof Error ? error.message : String(error)));
    }
  }
  return {
    ok: checks.every((check) => check.status !== 'fail'),
    service: 'Wulfram maps service',
    repository: resolved,
    checks,
    ...gitInfo,
  };
}

export function switchRepositoryBranch(repository, requestedBranch, create = false) {
  const resolved = assertMapsRepository(repository);
  const branch = assertBranchName(requestedBranch);
  const current = repositoryGitInfo(resolved);
  if (current.branch === branch) return current;
  if (create) {
    if (current.branches.includes(branch)) throw new Error(`Branch ${branch} already exists.`);
    runGit(resolved, ['switch', '-c', branch]);
  } else {
    const dirty = runGit(resolved, ['status', '--porcelain'], { allowEmpty: true });
    if (dirty) throw new Error('Commit, publish, or discard the current checkout changes before switching branches.');
    if (!current.branches.includes(branch)) throw new Error(`Unknown local branch: ${branch}`);
    runGit(resolved, ['switch', branch]);
  }
  return repositoryGitInfo(resolved);
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

function automaticBranchName(repository, slugs, now = new Date()) {
  const label = slugs.length === 1 ? slugs[0] : 'map-batch';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const stem = `maps/${label}-${stamp}`;
  const existing = new Set(repositoryGitInfo(repository).branches);
  if (!existing.has(stem)) return stem;
  let suffix = 2;
  while (existing.has(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

function statusPath(line) {
  // runGit trims the complete output, so the first porcelain line can lose
  // its leading blank index-status column (" M path" becomes "M path").
  const value = line.slice(line[2] === ' ' ? 3 : line[1] === ' ' ? 2 : 3).trim();
  const renamed = value.includes(' -> ') ? value.split(' -> ').at(-1) : value;
  return renamed?.replace(/^"|"$/g, '').replaceAll('\\', '/') || '';
}

function publishBranchToGitHub(repository, branch, title, body) {
  const auth = tryExecutable('gh', ['auth', 'status', '--hostname', 'github.com']);
  if (!auth.ok) throw new Error('GitHub CLI is not authenticated. Run gh auth login, then retry Publish.');
  runGit(repository, ['push', '--set-upstream', 'origin', branch]);
  const viewArgs = ['pr', 'view', branch, '--repo', MAPS_REPOSITORY_NAME, '--json', 'url', '--jq', '.url'];
  let existing = tryExecutable('gh', viewArgs);
  if (existing.ok && existing.output) return { pushed: true, prCreated: false, prUrl: existing.output };
  const created = tryExecutable('gh', [
    'pr',
    'create',
    '--repo', MAPS_REPOSITORY_NAME,
    '--base', DEFAULT_MAPS_BRANCH,
    '--head', branch,
    '--title', title,
    '--body', body,
  ]);
  if (!created.ok) {
    existing = tryExecutable('gh', viewArgs);
    if (existing.ok && existing.output) return { pushed: true, prCreated: false, prUrl: existing.output };
    throw new Error(`Could not open the GitHub pull request: ${created.error}`);
  }
  return { pushed: true, prCreated: true, prUrl: created.output.split(/\r?\n/).find((line) => line.startsWith('https://')) || created.output };
}

export function publishRepositoryMaps(repository, slugs, options = {}) {
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
  let gitInfo = repositoryGitInfo(resolved);
  if (gitInfo.branch === '(detached)') throw new Error('Publishing requires a named Git branch.');
  const selectedChanges = runGit(resolved, ['status', '--porcelain', '--', ...paths], { allowEmpty: true });
  if (gitInfo.branch === DEFAULT_MAPS_BRANCH && !selectedChanges) {
    return {
      committed: false,
      pushed: false,
      prCreated: false,
      prUrl: '',
      branch: gitInfo.branch,
      baseBranch: DEFAULT_MAPS_BRANCH,
      slugs: selected,
      message: 'Sources already match Git; no pull request was needed.',
    };
  }
  if (gitInfo.branch === DEFAULT_MAPS_BRANCH) {
    const allowed = paths.map((value) => `${value}/`);
    const outsideChanges = runGit(resolved, ['status', '--porcelain'], { allowEmpty: true })
      .split(/\r?\n/)
      .filter(Boolean)
      .map(statusPath)
      .filter((changedPath) => !allowed.some((prefix) => changedPath === prefix.slice(0, -1) || changedPath.startsWith(prefix)));
    if (outsideChanges.length) {
      throw new Error(`Cannot create a publishing branch while unrelated changes exist: ${outsideChanges.join(', ')}`);
    }
    const featureBranch = automaticBranchName(resolved, selected, options.now || new Date());
    runGit(resolved, ['switch', '-c', featureBranch]);
    gitInfo = repositoryGitInfo(resolved);
  }
  runGit(resolved, ['add', '--', ...paths]);
  const staged = runGit(
    resolved,
    ['diff', '--cached', '--name-only', '--', ...paths],
    { allowEmpty: true },
  );
  const label =
    selected.length === 1
      ? loadRepositoryMap(resolved, selected[0]).name
      : `${selected.length} maps`;
  const committed = Boolean(staged);
  if (committed) runGit(resolved, ['commit', '-m', `Update ${label}`]);
  const ahead = Number(runGit(resolved, ['rev-list', '--count', `${DEFAULT_MAPS_BRANCH}..HEAD`], { allowEmpty: true })) || 0;
  if (!ahead) {
    return {
      committed,
      pushed: false,
      prCreated: false,
      prUrl: '',
      branch: gitInfo.branch,
      baseBranch: DEFAULT_MAPS_BRANCH,
      slugs: selected,
      message: 'This branch has no changes from main; no pull request was needed.',
    };
  }
  const publishBranch = options.publishBranch || publishBranchToGitHub;
  const pullRequest = publishBranch(
    resolved,
    gitInfo.branch,
    `Update ${label}`,
    `Updates canonical Wulfram map source for ${selected.map((slug) => `\`${slug}\``).join(', ')}.\n\nCreated by Wulfram Forge.`,
  );
  return {
    committed,
    pushed: pullRequest.pushed,
    prCreated: pullRequest.prCreated,
    prUrl: pullRequest.prUrl,
    branch: gitInfo.branch,
    baseBranch: DEFAULT_MAPS_BRANCH,
    slugs: selected,
    message: `${pullRequest.prCreated ? 'Opened' : 'Updated'} pull request for ${label} into ${DEFAULT_MAPS_BRANCH}: ${pullRequest.prUrl}`,
  };
}
