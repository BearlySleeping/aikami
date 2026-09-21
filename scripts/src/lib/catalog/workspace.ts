// scripts/src/lib/catalog/workspace.ts
import { mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { ASSET_CACHE_CONTROL } from '@aikami/schemas';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import { contentTypeForExt } from './config.ts';
import { assetKey } from './content_address.ts';
import {
  atomicWrite,
  digestBytes,
  entryWorkingPath,
  jsonBytes,
  listWorkingFiles,
  readOptional,
  workspacePath,
} from './workspace_files.ts';
import {
  fetchWorkspaceSnapshot,
  type WorkspaceEntry,
  type WorkspaceRemote,
  type WorkspaceSnapshot,
  WorkspaceSnapshotSchema,
} from './workspace_remote.ts';

const CheckoutSchema = Type.Record(Type.String(), Type.String({ pattern: '^[a-f0-9]{64}$' }));

const readState = async (options: { root: string; path: string }): Promise<unknown> => {
  const bytes = await readOptional(await workspacePath(options));
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
};

/** Read local state offline; malformed state is not silently replaced. */
export const readWorkspaceSnapshot = async (root: string): Promise<WorkspaceSnapshot> => {
  const value = await readState({ root, path: 'current.json' });
  if (!Value.Check(WorkspaceSnapshotSchema, value)) {
    throw new Error('No valid workspace snapshot. Run snapshot first.');
  }
  return value;
};

const readCheckout = async (root: string): Promise<Record<string, string>> => {
  const value = await readState({ root, path: 'checkout.json' });
  if (value === undefined) {
    return {};
  }
  if (!Value.Check(CheckoutSchema, value)) {
    throw new Error('Invalid checkout baseline');
  }
  return value;
};

/** Store raw source metadata and a complete inventory before advancing the local pointer. */
export const snapshotWorkspace = async (options: {
  root: string;
  remote: WorkspaceRemote;
  mode: WorkspaceSnapshot['mode'];
  bucket: string;
  originUrl: string;
}): Promise<WorkspaceSnapshot> => {
  logger.debug('snapshotWorkspace');
  const previous = await readState({ root: options.root, path: 'current.json' });
  if (
    previous !== undefined &&
    (!Value.Check(WorkspaceSnapshotSchema, previous) ||
      previous.mode !== options.mode ||
      previous.bucket !== options.bucket ||
      previous.originUrl !== options.originUrl)
  ) {
    throw new Error(
      'Workspace target mismatch. Use a separate workspace for another bucket/origin.',
    );
  }
  const { snapshot, documents } = await fetchWorkspaceSnapshot(options);
  const bytes = jsonBytes(snapshot);
  const revision = digestBytes(bytes);
  for (const [key, document] of documents) {
    await atomicWrite({
      root: options.root,
      path: `snapshots/${revision}/remote/${key}`,
      bytes: document,
    });
  }
  await atomicWrite({ root: options.root, path: `snapshots/${revision}/snapshot.json`, bytes });
  await atomicWrite({ root: options.root, path: 'current.json', bytes });
  for (const path of ['working', 'imports', 'previews', 'plans']) {
    await mkdir(await workspacePath({ root: options.root, path }), { recursive: true });
  }
  return snapshot;
};

/** Select explicitly; a prefix matches a namespace boundary, not unrelated similarly named tags. */
export const selectWorkspaceEntries = (options: {
  entries: readonly WorkspaceEntry[];
  tags: readonly string[];
  categories: readonly string[];
  all: boolean;
}): WorkspaceEntry[] => {
  if (!options.all && options.tags.length === 0 && options.categories.length === 0) {
    throw new Error('Select --tag <namespace>, --category <category>, or --all explicitly.');
  }
  const matchesTag = (tag: string, prefix: string): boolean =>
    tag === prefix || tag.startsWith(`${prefix}:`);
  for (const tag of options.tags) {
    if (!options.entries.some((entry) => matchesTag(entry.tag, tag))) {
      throw new Error(`Unknown tag/namespace: ${tag}`);
    }
  }
  for (const category of options.categories) {
    if (!options.entries.some((entry) => entry.category === category)) {
      throw new Error(`Unknown/empty category: ${category}`);
    }
  }
  return options.entries.filter(
    (entry) =>
      options.all ||
      options.categories.includes(entry.category) ||
      options.tags.some((tag) => matchesTag(entry.tag, tag)),
  );
};

/** Download immutable bytes once, verify hash+length, and preserve dirty working files. */
export const pullWorkspace = async (options: {
  root: string;
  remote: WorkspaceRemote;
  entries: readonly WorkspaceEntry[];
}): Promise<{ downloaded: number; cached: number; updated: number; conflicts: string[] }> => {
  logger.debug('pullWorkspace', { count: options.entries.length });
  const baseline = await readCheckout(options.root);
  const report = { downloaded: 0, cached: 0, updated: 0, conflicts: [] as string[] };
  const objects = new Map(options.entries.map((entry) => [assetKey(entry), entry]));
  // Fixed bounded workers, not one unbounded promise per LPC sheet.
  const pending = [...objects.values()];
  const worker = async (): Promise<void> => {
    while (pending.length > 0) {
      const entry = pending.pop();
      if (!entry) {
        return;
      }
      const key = assetKey(entry);
      const cachePath = `objects/${key}`;
      const existing = await readOptional(
        await workspacePath({ root: options.root, path: cachePath }),
      );
      if (existing && existing.length === entry.sizeBytes && digestBytes(existing) === entry.hash) {
        report.cached++;
        continue;
      }
      const bytes = await options.remote.readObject(key);
      if (!bytes || bytes.length !== entry.sizeBytes || digestBytes(bytes) !== entry.hash) {
        throw new Error(`Asset integrity failure: ${entry.tag} (${key})`);
      }
      await atomicWrite({ root: options.root, path: cachePath, bytes });
      report.downloaded++;
    }
  };
  // Wait for every worker even after failure, so the caller cannot release the lock early.
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => worker()));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    throw failed.reason;
  }
  const files = new Map(options.entries.map((entry) => [entryWorkingPath(entry), entry]));
  for (const [path, entry] of files) {
    const current = await readOptional(
      await workspacePath({ root: options.root, path: `working/${path}` }),
    );
    const localHash = current ? digestBytes(current) : undefined;
    if (localHash && localHash !== entry.hash && localHash !== baseline[path]) {
      report.conflicts.push(path);
      continue;
    }
    if (localHash !== entry.hash) {
      const bytes = await readOptional(
        await workspacePath({ root: options.root, path: `objects/${assetKey(entry)}` }),
      );
      if (!bytes || digestBytes(bytes) !== entry.hash) {
        throw new Error(`Cached object changed: ${entry.tag}`);
      }
      // Copy, never hardlink: editing a working image must not corrupt the immutable cache.
      await atomicWrite({ root: options.root, path: `working/${path}`, bytes });
      report.updated++;
    }
    baseline[path] = entry.hash;
  }
  await atomicWrite({ root: options.root, path: 'checkout.json', bytes: jsonBytes(baseline) });
  return report;
};

/** Three-way state distinguishes a missing local file from a request to delete remotely. */
export type WorkspaceChange = {
  path: string;
  state: 'clean' | 'new' | 'modified' | 'missing-local' | 'remote-changed' | 'conflict';
  localHash?: string;
  remoteHash?: string;
  baselineHash?: string;
  sizeBytes?: number;
};

/** Offline status for checked-out files; unselected catalog assets are not false deletions. */
export const workspaceStatus = async (options: {
  root: string;
  snapshot: WorkspaceSnapshot;
}): Promise<WorkspaceChange[]> => {
  logger.debug('workspaceStatus');
  const baseline = await readCheckout(options.root);
  const working = await listWorkingFiles(options.root);
  const remote = new Map(
    options.snapshot.entries.map((entry) => [entryWorkingPath(entry), entry.hash]),
  );
  const paths = [...new Set([...Object.keys(baseline), ...working])].sort();
  const changes: WorkspaceChange[] = [];
  for (const path of paths) {
    const bytes = await readOptional(
      await workspacePath({ root: options.root, path: `working/${path}` }),
    );
    const localHash = bytes ? digestBytes(bytes) : undefined;
    const remoteHash = remote.get(path);
    const baselineHash = baseline[path];
    let state: WorkspaceChange['state'] = 'clean';
    if (!localHash) {
      state = 'missing-local';
    } else if (localHash === remoteHash) {
      state = 'clean';
    } else if (!baselineHash) {
      state = remoteHash ? 'conflict' : 'new';
    } else if (localHash === baselineHash) {
      state = 'remote-changed';
    } else {
      state = remoteHash === baselineHash ? 'modified' : 'conflict';
    }
    changes.push({ path, state, localHash, remoteHash, baselineHash, sizeBytes: bytes?.length });
  }
  return changes;
};

/** Stage changed bytes only. No tag/index/seed publication and no deletion operation exists here. */
export const syncWorkspace = async (options: {
  root: string;
  snapshot: WorkspaceSnapshot;
  remote?: WorkspaceRemote;
  apply: boolean;
  confirmBucket?: string;
}): Promise<{
  planPath: string;
  uploaded: number;
  skipped: number;
  changes: WorkspaceChange[];
}> => {
  logger.debug('syncWorkspace', { apply: options.apply });
  if (options.apply && (options.confirmBucket !== options.snapshot.bucket || !options.remote)) {
    throw new Error('Uploads require --apply and --confirm-bucket matching the snapshot target.');
  }
  const changes = await workspaceStatus(options);
  const uploads = changes.filter((change) => change.state === 'modified' || change.state === 'new');
  const items = uploads.map((change) => {
    if (!change.localHash || !/^(game-data|content-packs)\//.test(change.path)) {
      throw new Error(`Unsupported upload path: ${change.path}`);
    }
    const ext = extname(change.path);
    if (!['.json', '.jton', '.png', '.webp', '.ogg', '.mp3', '.webm', '.wav'].includes(ext)) {
      throw new Error(`Unsupported upload format: ${change.path}`);
    }
    if (change.sizeBytes === undefined || change.sizeBytes > 512 * 1024 * 1024) {
      throw new Error(`Upload exceeds per-file budget: ${change.path}`);
    }
    return {
      path: change.path,
      hash: change.localHash,
      ext,
      key: assetKey({ hash: change.localHash, ext }),
      sizeBytes: change.sizeBytes,
    };
  });
  const plan = {
    version: 1,
    bucket: options.snapshot.bucket,
    mode: options.snapshot.mode,
    snapshotHash: digestBytes(jsonBytes(options.snapshot)),
    operation: 'upload-unpublished',
    items,
    deletions: [],
    publication: false,
    blocked: changes.filter(
      (change) => change.state === 'conflict' || change.state === 'remote-changed',
    ),
    missingLocal: changes
      .filter((change) => change.state === 'missing-local')
      .map((change) => change.path),
  };
  const planPath = `plans/${digestBytes(jsonBytes(plan))}.json`;
  await atomicWrite({ root: options.root, path: planPath, bytes: jsonBytes(plan) });
  if (!options.apply) {
    return { planPath, uploaded: 0, skipped: 0, changes };
  }
  if (plan.blocked.length > 0) {
    throw new Error(
      `Resolve ${plan.blocked.length} remote changes/conflicts first; see ${planPath}`,
    );
  }
  // Check all bytes before any remote writes. Re-read immediately before each PUT as well.
  for (const item of items) {
    const bytes = await readOptional(
      await workspacePath({ root: options.root, path: `working/${item.path}` }),
    );
    if (!bytes || digestBytes(bytes) !== item.hash) {
      throw new Error(`Working file changed after planning: ${item.path}`);
    }
  }
  let uploaded = 0;
  let skipped = 0;
  const remote = options.remote;
  if (!remote) {
    throw new Error('Missing upload client');
  }
  for (const item of new Map(items.map((candidate) => [candidate.key, candidate])).values()) {
    const existing = await remote.readObject(item.key);
    if (existing) {
      if (existing.length !== item.sizeBytes || digestBytes(existing) !== item.hash) {
        throw new Error(`Remote content-address violation: ${item.key}`);
      }
      skipped++;
      continue;
    }
    const bytes = await readOptional(
      await workspacePath({ root: options.root, path: `working/${item.path}` }),
    );
    if (!bytes || digestBytes(bytes) !== item.hash) {
      throw new Error(`Working file changed after planning: ${item.path}`);
    }
    await remote.putObject({
      key: item.key,
      body: bytes,
      contentType: contentTypeForExt(item.ext),
      cacheControl: ASSET_CACHE_CONTROL,
    });
    const verified = await remote.readObject(item.key);
    if (!verified || digestBytes(verified) !== item.hash) {
      throw new Error(`Uploaded object verification failed: ${item.key}`);
    }
    uploaded++;
  }
  await atomicWrite({
    root: options.root,
    path: `${planPath}.receipt.json`,
    bytes: jsonBytes({ uploaded, skipped, published: false }),
  });
  return { planPath, uploaded, skipped, changes };
};
