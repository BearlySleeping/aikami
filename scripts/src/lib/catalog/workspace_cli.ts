// scripts/src/lib/catalog/workspace_cli.ts
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { logger } from '$logger';
import { REPO_ROOT, resolveCatalogConfig } from './config.ts';
import {
  pullWorkspace,
  readWorkspaceSnapshot,
  selectWorkspaceEntries,
  snapshotWorkspace,
  syncWorkspace,
  workspaceStatus,
} from './workspace.ts';
import { atomicWrite, jsonBytes, withWorkspaceLock } from './workspace_files.ts';
import { inspectWorkspaceImage, optimizeWorkspaceImage } from './workspace_image.ts';
import { createWorkspaceRemote } from './workspace_remote.ts';

const HELP = `Catalog authoring workspace (never publishes or deletes remotely)

bun run --cwd scripts catalog:workspace <command> --mode production|staging

  snapshot                         Pin inventory + raw metadata from R2
  pull --tag emberwatch            Download an exact tag or namespace
  pull --category tilesets         Download a category (repeatable selectors)
  pull --all                       Download the complete seed/index union
  status                           Offline three-way diff (writes status.json)
  inspect-image --input X           working/X → alpha report + checkerboard PNG
  sync                             Offline upload plan only (dry-run default)
  sync --apply --confirm-bucket X  Upload immutable objects, NOT a release
  optimize --input X --output Y    imports/X → working/Y (lossless WebP)
           --kind prop|terrain|portrait (default prop; real alpha required)

Workspace: .local/catalog/<mode>/
Run snapshot before pull. No overwriting dirty files, no implicit deletions.
Uploads do not change the checkout baseline: only a later published snapshot does.
See docs/guides/catalog_workspace.md for review, debugging and recovery.
`;

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      mode: { type: 'string' },
      tag: { type: 'string', multiple: true },
      category: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      apply: { type: 'boolean' },
      'confirm-bucket': { type: 'string' },
      input: { type: 'string' },
      output: { type: 'string' },
      kind: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || positionals.length === 0) {
    logger.info(HELP);
    return;
  }
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !command ||
    !['snapshot', 'pull', 'status', 'sync', 'optimize', 'inspect-image'].includes(command)
  ) {
    throw new Error('Unknown command. Use --help.');
  }
  const mode = values.mode;
  if (mode !== 'staging' && mode !== 'production') {
    throw new Error(
      'Explicit --mode staging|production is required. Ambient emulator mode is never a remote target.',
    );
  }
  const allowed: Record<string, readonly string[]> = {
    snapshot: ['mode'],
    pull: ['mode', 'tag', 'category', 'all'],
    status: ['mode'],
    sync: ['mode', 'apply', 'confirm-bucket'],
    optimize: ['mode', 'input', 'output', 'kind'],
    'inspect-image': ['mode', 'input'],
  };
  for (const name of Object.keys(values)) {
    if (!allowed[command]?.includes(name)) {
      throw new Error(`--${name} is not supported by ${command}`);
    }
  }
  const root = join(REPO_ROOT, '.local/catalog', mode);
  await withWorkspaceLock({
    root,
    run: async () => {
      if (command === 'inspect-image') {
        if (!values.input) {
          throw new Error('inspect-image requires --input relative to working/');
        }
        logger.info('Image inspection', await inspectWorkspaceImage({ root, input: values.input }));
        return;
      }
      if (command === 'optimize') {
        const kind = values.kind ?? 'prop';
        if (!values.input || !values.output || !['prop', 'terrain', 'portrait'].includes(kind)) {
          throw new Error('optimize requires --input, --output and a valid --kind');
        }
        if (kind !== 'prop' && kind !== 'terrain' && kind !== 'portrait') {
          throw new Error('Invalid image kind');
        }
        logger.info(
          'Image optimized',
          await optimizeWorkspaceImage({ root, input: values.input, output: values.output, kind }),
        );
        return;
      }
      if (command === 'snapshot') {
        const config = resolveCatalogConfig(mode);
        const snapshot = await snapshotWorkspace({
          root,
          mode,
          bucket: config.bucket,
          originUrl: config.originUrl,
          remote: createWorkspaceRemote(config),
        });
        logger.info('Snapshot ready', {
          root,
          entries: snapshot.entries.length,
          warnings: snapshot.warnings,
        });
        return;
      }
      const snapshot = await readWorkspaceSnapshot(root);
      if (snapshot.mode !== mode) {
        throw new Error('Snapshot mode mismatch');
      }
      const connect = () => {
        const config = resolveCatalogConfig(mode);
        if (config.bucket !== snapshot.bucket || config.originUrl !== snapshot.originUrl) {
          throw new Error('Configured bucket/origin differs from snapshot; refusing remote access');
        }
        return createWorkspaceRemote(config);
      };
      if (command === 'pull') {
        const entries = selectWorkspaceEntries({
          entries: snapshot.entries,
          tags: values.tag ?? [],
          categories: values.category ?? [],
          all: values.all ?? false,
        });
        const report = await pullWorkspace({ root, entries, remote: connect() });
        logger.info('Pull complete', report);
        if (report.conflicts.length > 0) {
          process.exitCode = 1;
        }
        return;
      }
      if (command === 'status') {
        const changes = await workspaceStatus({ root, snapshot });
        await atomicWrite({ root, path: 'status.json', bytes: jsonBytes(changes) });
        const counts: Record<string, number> = {};
        for (const change of changes) {
          counts[change.state] = (counts[change.state] ?? 0) + 1;
        }
        logger.info('Workspace status', {
          root,
          counts,
          details: 'status.json',
          warnings: snapshot.warnings,
        });
        return;
      }
      const result = await syncWorkspace({
        root,
        snapshot,
        apply: values.apply ?? false,
        confirmBucket: values['confirm-bucket'],
        remote: values.apply ? connect() : undefined,
      });
      logger.info('Unpublished sync plan', {
        root,
        plan: result.planPath,
        uploaded: result.uploaded,
        skipped: result.skipped,
        published: false,
      });
    },
  });
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : 'Catalog workspace failed');
    process.exitCode = 1;
  });
}
