import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAP_SOURCE_FILES,
  parseMapSourceFiles,
  readMapSourceArchive,
} from '../lib/map-source.ts';
import { safeMapName } from '../lib/map-package.ts';
import {
  DEFAULT_VALIDATION,
  parseLand,
  parseLines,
  parseState,
} from '../lib/wulfram.ts';
import {
  MAPS_REPOSITORY_NAME,
  buildReleaseArtifacts,
  compileRepository,
  listRepositoryMaps,
  publishRepositoryMaps,
  repositoryDiagnostics,
  resolveMapsRepository,
  runGit,
  saveRepositoryMap,
  switchRepositoryBranch,
} from './map-repository-lib.mjs';

function usage() {
  console.log(`Wulfram maps repository tools

Usage:
  npm run maps:list
  npm run maps:import -- <source.zip|source-directory|project.json> [slug]
  npm run maps:seed-original -- [original-maps-directory]
  npm run maps:compile -- [slug ...|--all] [--out <directory>]
  npm run maps:doctor
  npm run maps:branch -- <branch> [--create]
  npm run maps:publish -- [slug ...|--all]
  npm run maps:release -- <tag>

Options:
  --repo <directory>  Override the sibling wulfram-maps checkout
  --out <directory>   Compilation output (default: <repo>/dist)
`);
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`${name} requires a value.`);
  return args.splice(index, 2)[1];
}

async function importSource(repository, input, requestedSlug) {
  const resolved = path.resolve(input);
  let project;
  let suggestedSlug;
  if (fs.statSync(resolved).isDirectory()) {
    project = parseMapSourceFiles(
      Object.fromEntries(
        MAP_SOURCE_FILES.map((fileName) => [
          fileName,
          fs.readFileSync(path.join(resolved, fileName), 'utf8'),
        ]),
      ),
    );
    suggestedSlug = path.basename(resolved);
  } else if (/\.zip$/i.test(resolved)) {
    const archive = await readMapSourceArchive(fs.readFileSync(resolved));
    if (!archive)
      throw new Error(
        'The ZIP does not contain a complete wulfram-map-source v1 directory.',
      );
    project = archive.project;
    suggestedSlug = path.basename(archive.root);
  } else if (/\.json$/i.test(resolved)) {
    project = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (project?.format !== 'wulfram-map-project' || project?.version !== 1) {
      throw new Error(
        'JSON imports must be a wulfram-map-project v1 browser backup.',
      );
    }
    suggestedSlug = safeMapName(project.name);
  } else {
    throw new Error(
      'Import a Git source ZIP/directory or wulfram-project JSON backup.',
    );
  }
  const slug = requestedSlug || safeMapName(suggestedSlug || project.name);
  const saved = saveRepositoryMap(repository, slug, project);
  console.log(
    `Saved ${saved.project.name} to ${path.relative(repository, saved.directory)}.`,
  );
}

function findOriginalMapDirectories(root) {
  const found = [];
  const pending = [path.resolve(root)];
  while (pending.length) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    if (
      entries.some(
        (entry) => entry.isFile() && entry.name.toLowerCase() === 'land',
      )
    )
      found.push(current);
    for (const entry of entries)
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
  }
  return found.sort((left, right) => left.localeCompare(right));
}

function seedOriginalMaps(repository, originalRoot) {
  const root = path.resolve(originalRoot);
  const directories = findOriginalMapDirectories(root);
  if (!directories.length)
    throw new Error(`No original land files were found under ${root}.`);
  for (const directory of directories) {
    const fileNames = fs.readdirSync(directory);
    const byLowerName = new Map(
      fileNames.map((name) => [name.toLowerCase(), name]),
    );
    const stateFile = fileNames
      .filter((name) => /^(?:state\d*|db_state|bigstate)$/i.test(name))
      .sort((left, right) =>
        left.toLowerCase() === 'state'
          ? -1
          : right.toLowerCase() === 'state'
            ? 1
            : left.localeCompare(right),
      )[0];
    const relativeName = path
      .relative(root, directory)
      .replaceAll(path.sep, '/');
    const terrain = parseLand(
      fs.readFileSync(path.join(directory, byLowerName.get('land')), 'utf8'),
    );
    terrain.tagmap = byLowerName.has('tagmap')
      ? parseLines(
          fs.readFileSync(
            path.join(directory, byLowerName.get('tagmap')),
            'utf8',
          ),
        )
      : [];
    terrain.tagmap2 = byLowerName.has('tagmap2')
      ? parseLines(
          fs.readFileSync(
            path.join(directory, byLowerName.get('tagmap2')),
            'utf8',
          ),
        )
      : [];
    const project = {
      format: 'wulfram-map-project',
      version: 1,
      name: relativeName,
      terrain,
      entities: stateFile
        ? parseState(fs.readFileSync(path.join(directory, stateFile), 'utf8'))
        : [],
      validation: { ...DEFAULT_VALIDATION },
      updatedAt: '2000-01-01T00:00:00.000Z',
    };
    const slug = safeMapName(relativeName.replaceAll('/', '-'));
    saveRepositoryMap(repository, slug, project);
    console.log(`${slug}: ${relativeName}`);
  }
  console.log(
    `Imported ${directories.length} original maps into canonical Git source.`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const repository = resolveMapsRepository(takeOption(args, '--repo'));
  const output = path.resolve(
    takeOption(args, '--out') || path.join(repository, 'dist'),
  );
  const allIndex = args.indexOf('--all');
  const all = allIndex >= 0;
  if (all) args.splice(allIndex, 1);
  const createIndex = args.indexOf('--create');
  const create = createIndex >= 0;
  if (create) args.splice(createIndex, 1);

  if (!command || command === 'help' || command === '--help') {
    usage();
    return;
  }

  if (command === 'list') {
    const maps = listRepositoryMaps(repository);
    if (!maps.length) {
      console.log('No maps are stored in the repository.');
      return;
    }
    console.table(
      maps.map(({ slug, name, width, height, entities, updatedAt }) => ({
        slug,
        name,
        terrain: `${width}x${height}`,
        entities,
        updated: updatedAt,
      })),
    );
    return;
  }

  if (command === 'doctor') {
    if (args.length || all || create) throw new Error('maps:doctor does not accept positional arguments.');
    const result = repositoryDiagnostics(repository);
    console.log(`Maps checkout: ${result.repository}`);
    for (const check of result.checks) {
      console.log(`${check.status.toUpperCase().padEnd(4)}  ${check.label}: ${check.detail}`);
      if (check.fix && check.status !== 'pass') console.log(`      ${check.fix}`);
    }
    if (!result.ok) throw new Error('Maps repository setup needs attention; follow the fixes above.');
    return;
  }

  if (command === 'branch') {
    const branch = args.shift();
    if (!branch || args.length || all) throw new Error('maps:branch requires one branch name and optional --create.');
    const result = switchRepositoryBranch(repository, branch, create);
    console.log(`Using ${result.branch}.`);
    return;
  }

  if (command === 'import') {
    const input = args.shift();
    if (!input || args.length > 1 || all)
      throw new Error('maps:import requires an input path and optional slug.');
    await importSource(repository, input, args[0]);
    return;
  }

  if (command === 'seed-original') {
    if (args.length > 1 || all)
      throw new Error(
        'maps:seed-original accepts one optional source directory.',
      );
    seedOriginalMaps(
      repository,
      args[0] ||
        path.resolve(process.cwd(), '..', 'wulfram-debug', 'data', 'maps'),
    );
    return;
  }

  if (command === 'compile') {
    const selected = all || !args.length ? undefined : args;
    const compiled = await compileRepository(repository, selected, output);
    for (const artifact of compiled) {
      console.log(
        `${artifact.slug}: ${path.relative(process.cwd(), artifact.output)} (${artifact.sha256.slice(0, 12)}…)`,
      );
    }
    return;
  }

  if (command === 'publish') {
    const selected = all || !args.length ? undefined : args;
    const result = publishRepositoryMaps(repository, selected);
    console.log(result.message);
    return;
  }

  if (command === 'release') {
    const tag = args.shift();
    if (!tag || args.length || all)
      throw new Error('maps:release requires exactly one tag, such as v1.0.0.');
    execFileSync('git', ['check-ref-format', `refs/tags/${tag}`], {
      stdio: 'ignore',
    });
    const dirty = runGit(repository, ['status', '--porcelain'], {
      allowEmpty: true,
    });
    if (dirty)
      throw new Error(
        'The maps checkout must be clean before a release. Publish or commit its changes first.',
      );
    try {
      execFileSync(
        'gh',
        ['release', 'view', tag, '--repo', MAPS_REPOSITORY_NAME],
        { stdio: 'ignore' },
      );
      throw new Error(`GitHub Release ${tag} already exists.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists'))
        throw error;
    }

    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wulfram-maps-release-'),
    );
    try {
      const artifacts = await buildReleaseArtifacts(repository, tag, temporary);
      runGit(repository, ['push', 'origin', 'HEAD']);
      const existingTag = runGit(repository, ['tag', '--list', tag], {
        allowEmpty: true,
      });
      if (!existingTag)
        runGit(repository, ['tag', '-a', tag, '-m', `Wulfram maps ${tag}`]);
      runGit(repository, ['push', 'origin', `refs/tags/${tag}`]);
      execFileSync(
        'gh',
        [
          'release',
          'create',
          tag,
          ...artifacts.releaseFiles,
          '--repo',
          MAPS_REPOSITORY_NAME,
          '--verify-tag',
          '--title',
          `Wulfram maps ${tag}`,
          '--generate-notes',
        ],
        { stdio: 'inherit' },
      );
      console.log(
        `Released ${artifacts.compiled.length} compiled maps as ${tag}.`,
      );
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    return;
  }

  usage();
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
