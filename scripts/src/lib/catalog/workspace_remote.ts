// scripts/src/lib/catalog/workspace_remote.ts
import {
  CatalogCategorySchema,
  CatalogIndexRootSchema,
  CatalogIndexShardSchema,
  ReleasePointerSchema,
} from '@aikami/schemas';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import type { CatalogConfig } from './config.ts';
import { createR2Client, type R2ClientLike } from './upload.ts';
import { checkRelativePath, digestBytes, entryWorkingPath } from './workspace_files.ts';

const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const EntrySchema = Type.Object({
  tag: Type.String({ minLength: 1 }),
  hash: HashSchema,
  sizeBytes: Type.Integer({ minimum: 0, maximum: 512 * 1024 * 1024 }),
  ext: Type.String({ pattern: '^\\.[a-z0-9]+$' }),
  category: CatalogCategorySchema,
});
const CompactSeedSchema = Type.Object({
  sv: Type.Literal(1),
  r: Type.Array(
    Type.Object({
      t: EntrySchema.properties.tag,
      h: HashSchema,
      s: EntrySchema.properties.sizeBytes,
      e: EntrySchema.properties.ext,
      c: CatalogCategorySchema,
    }),
    { maxItems: 100_000 },
  ),
});

/** Local-only tooling state; raw upstream documents retain all attribution and provenance. */
export const WorkspaceSnapshotSchema = Type.Object({
  version: Type.Literal(1),
  mode: Type.Union([Type.Literal('staging'), Type.Literal('production')]),
  bucket: Type.String({ minLength: 1 }),
  originUrl: Type.String({ minLength: 1 }),
  consistency: Type.Union([Type.Literal('release'), Type.Literal('legacy-observed')]),
  documents: Type.Array(Type.Object({ key: Type.String(), hash: HashSchema })),
  entries: Type.Array(EntrySchema, { maxItems: 100_000 }),
  warnings: Type.Array(Type.String()),
});

/** A snapshot is a complete observed inventory, not a promise that every object is downloaded. */
export type WorkspaceSnapshot = Static<typeof WorkspaceSnapshotSchema>;
/** Minimal logical identity from either a compact seed or a category shard. */
export type WorkspaceEntry = WorkspaceSnapshot['entries'][number];
/** Missing means exactly NoSuchKey; authentication and transport failures must fail closed. */
export type WorkspaceRemote = Pick<R2ClientLike, 'putObject'> & {
  readObject(key: string): Promise<Uint8Array | undefined>;
};

/** Bound downloads and retries without leaking presigned URLs or credentials to logs. */
export const createWorkspaceRemote = (config: CatalogConfig): WorkspaceRemote => {
  logger.debug('createWorkspaceRemote', { bucket: config.bucket });
  const s3 = new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    endpoint: config.endpoint,
    bucket: config.bucket,
    region: 'auto',
  });
  const uploader = createR2Client(config);
  return {
    putObject: (options) => uploader.putObject(options),
    async readObject(key) {
      checkRelativePath(key);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(s3.file(key).presign({ method: 'GET', expiresIn: 120 }), {
            signal: AbortSignal.timeout(60_000),
          });
          if (response.status === 404) {
            return undefined;
          }
          if (!response.ok) {
            await response.body?.cancel();
            if ((response.status === 429 || response.status >= 500) && attempt < 2) {
              await Bun.sleep(250 * 2 ** attempt);
              continue;
            }
            throw new Error(`R2 GET ${key}: HTTP ${response.status}`);
          }
          const maximum = key.startsWith('assets/') ? 512 * 1024 * 1024 : 32 * 1024 * 1024;
          if (Number(response.headers.get('content-length')) > maximum) {
            await response.body?.cancel();
            throw new Error(`R2 object exceeds download budget: ${key}`);
          }
          if (!response.body) {
            throw new Error(`R2 GET ${key}: empty response stream`);
          }
          const chunks: Uint8Array[] = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maximum) {
              throw new Error(`R2 object exceeds download budget: ${key}`);
            }
            chunks.push(chunk);
          }
          return new Uint8Array(Buffer.concat(chunks));
        } catch (error) {
          if ((error instanceof TypeError || error instanceof DOMException) && attempt < 2) {
            await Bun.sleep(250 * 2 ** attempt);
            continue;
          }
          // Transport exceptions can contain signed URLs. Never expose their raw message.
          if (error instanceof TypeError || error instanceof DOMException) {
            throw new Error(`R2 GET ${key}: transport failure after retries`);
          }
          throw error;
        }
      }
      throw new Error(`R2 GET ${key}: exhausted retries`);
    },
  };
};

const SEED_NAMES = [
  'asset_seed.json',
  'offline_core.json',
  'asset_credits.json',
  'lpc_credits.json',
  'lpc_credits_supplement.json',
  'audio_tracks.json',
] as const;
const RELEASE_KEY = 'index/v1/release.json';

/** A divergent alias pair the merge resolved deterministically. */
export type AliasCollision = {
  /** Working path both aliases map to. */
  path: string;
  /** The tag the snapshot keeps. */
  kept: { tag: string; hash: string };
  /** The tag the snapshot drops. */
  dropped: { tag: string; hash: string };
};

/** Inputs that let the merge pick a winner for a divergent alias. */
export type MergeWorkspaceOptions = {
  /**
   * Tags the release index (`release.json` shards) references. A release-index
   * tag is authoritative over a seed-only alias, because the release is what the
   * origin actually serves.
   */
  releaseIndexTags?: ReadonlySet<string>;
  /** Called once per divergent alias that was resolved instead of throwing. */
  onAliasCollision?: (collision: AliasCollision) => void;
};

/** True when the tag's last segment already carries the entry's extension. */
const isExtensionQualified = (entry: { tag: string; ext: string }): boolean => {
  const ext = entry.ext.startsWith('.') ? entry.ext : `.${entry.ext}`;
  return entry.tag.endsWith(ext);
};

/**
 * Picks the authoritative entry of a divergent alias pair.
 *
 * Order: the release-index-referenced tag, then the extension-qualified tag
 * (`sprites:tilesets:atlas.webp` over the legacy `sprites:tilesets:atlas`).
 * `undefined` means neither rule distinguishes them, which the caller reports
 * as an unresolvable conflict rather than guessing.
 */
const aliasWinner = (
  first: WorkspaceEntry,
  second: WorkspaceEntry,
  releaseIndexTags?: ReadonlySet<string>,
): WorkspaceEntry | undefined => {
  const firstIndexed = releaseIndexTags?.has(first.tag) ?? false;
  const secondIndexed = releaseIndexTags?.has(second.tag) ?? false;
  if (firstIndexed !== secondIndexed) {
    return firstIndexed ? first : second;
  }
  const firstQualified = isExtensionQualified(first);
  const secondQualified = isExtensionQualified(second);
  if (firstQualified !== secondQualified) {
    return firstQualified ? first : second;
  }
  return undefined;
};

/** True when two entries claiming the same tag disagree on identity. */
const hasTagConflict = (old: WorkspaceEntry, entry: WorkspaceEntry): boolean =>
  old.hash !== entry.hash ||
  old.ext !== entry.ext ||
  old.sizeBytes !== entry.sizeBytes ||
  old.category !== entry.category;

/** What to do with `entry` once a same-path alias `other` is found. */
type PathAction = 'keep-both' | 'keep-entry' | 'keep-other';

/**
 * Classifies a same-path alias pair.
 *
 * Identical bytes coalesce (both tags survive); a divergent pair is resolved by
 * {@link aliasWinner} and reported through `options.onAliasCollision`. A pair no
 * rule separates — or two tags whose exact paths differ only by case — throws.
 */
const classifyPathCollision = (
  other: WorkspaceEntry,
  entry: WorkspaceEntry,
  path: string,
  options: MergeWorkspaceOptions,
): PathAction => {
  if (entryWorkingPath(other) !== path) {
    throw new Error(`Catalog path collision: ${other.tag} / ${entry.tag}`);
  }
  if (other.hash === entry.hash && other.sizeBytes === entry.sizeBytes) {
    return 'keep-both';
  }
  const winner = aliasWinner(other, entry, options.releaseIndexTags);
  if (!winner) {
    throw new Error(
      `Catalog alias conflict with no authority: ${other.tag} (${other.hash}) / ${entry.tag} (${entry.hash})`,
    );
  }
  const loser = winner === other ? entry : other;
  options.onAliasCollision?.({
    path,
    kept: { tag: winner.tag, hash: winner.hash },
    dropped: { tag: loser.tag, hash: loser.hash },
  });
  return winner === entry ? 'keep-entry' : 'keep-other';
};

/**
 * Merge seed and browse coverage; refuse conflicting identities or ambiguous
 * local paths.
 *
 * Two tags can legitimately map to the same working path (the legacy
 * `sprites:tilesets:atlas` alias and `sprites:tilesets:atlas.webp`). When their
 * bytes agree the alias is coalesced silently; when they diverge the release
 * index decides, then the extension-qualified tag, and the caller is told which
 * one won and which was dropped. Only a pair no rule can separate fails loudly.
 */
export const mergeWorkspaceEntries = (
  entries: readonly WorkspaceEntry[],
  options: MergeWorkspaceOptions = {},
): WorkspaceEntry[] => {
  const tags = new Map<string, WorkspaceEntry>();
  const paths = new Map<string, WorkspaceEntry>();
  for (const entry of entries) {
    if (!Value.Check(EntrySchema, entry)) {
      throw new Error('Invalid catalog workspace entry');
    }
    const old = tags.get(entry.tag);
    if (old && hasTagConflict(old, entry)) {
      throw new Error(`Seed/index conflict for ${entry.tag}`);
    }
    const path = entryWorkingPath(entry);
    const other = paths.get(path.toLowerCase());
    if (other) {
      const action = classifyPathCollision(other, entry, path, options);
      if (action === 'keep-other') {
        continue;
      }
      if (action === 'keep-entry') {
        tags.delete(other.tag);
      }
    }
    tags.set(entry.tag, entry);
    paths.set(path.toLowerCase(), entry);
  }
  return [...tags.values()].sort((left, right) => left.tag.localeCompare(right.tag));
};

/** Pin release dependencies, or explicitly snapshot the legacy surface without inventing a release. */
export const fetchWorkspaceSnapshot = async (options: {
  remote: WorkspaceRemote;
  mode: WorkspaceSnapshot['mode'];
  bucket: string;
  originUrl: string;
}): Promise<{ snapshot: WorkspaceSnapshot; documents: Map<string, Uint8Array> }> => {
  logger.debug('fetchWorkspaceSnapshot', { mode: options.mode, bucket: options.bucket });
  const documents = new Map<string, Uint8Array>();
  const get = async (reference: { key: string; hash?: string }): Promise<unknown> => {
    checkRelativePath(reference.key);
    const bytes = await options.remote.readObject(reference.key);
    if (!bytes) {
      throw new Error(`Missing catalog metadata: ${reference.key}`);
    }
    if (
      bytes.length > 32 * 1024 * 1024 ||
      (reference.hash && digestBytes(bytes) !== reference.hash)
    ) {
      throw new Error(`Metadata integrity/budget failure: ${reference.key}`);
    }
    documents.set(reference.key, bytes);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const pointerBytes = await options.remote.readObject(RELEASE_KEY);
  const pointer: unknown = pointerBytes
    ? JSON.parse(new TextDecoder().decode(pointerBytes))
    : undefined;
  if (pointerBytes && !Value.Check(ReleasePointerSchema, pointer)) {
    throw new Error('Malformed release pointer; refusing legacy fallback');
  }
  const release = Value.Check(ReleasePointerSchema, pointer) ? pointer : undefined;
  if (pointerBytes) {
    documents.set(RELEASE_KEY, pointerBytes);
  }
  const root = await get(
    release ? { key: release.rootKey, hash: release.rootHash } : { key: 'index/v1/catalog.json' },
  );
  if (!Value.Check(CatalogIndexRootSchema, root)) {
    throw new Error('Invalid catalog root');
  }
  const shardReferences =
    release?.shards ??
    root.categories.map(({ id }) => ({
      category: id,
      key: `index/v1/${checkRelativePath(id)}.json`,
    }));
  if (
    new Set(shardReferences.map((entry) => entry.category)).size !== shardReferences.length ||
    shardReferences.length !== root.categories.length
  ) {
    throw new Error('Duplicate/missing catalog shards');
  }
  const entries: WorkspaceEntry[] = [];
  for (const reference of shardReferences) {
    const shard = await get(reference);
    const summary = root.categories.find((entry) => entry.id === reference.category);
    if (
      !Value.Check(CatalogIndexShardSchema, shard) ||
      !summary ||
      shard.id !== summary.id ||
      shard.entries.length !== summary.count
    ) {
      throw new Error(`Invalid/mismatched catalog shard: ${reference.key}`);
    }
    entries.push(
      ...shard.entries.map(({ tag, hash, sizeBytes, ext, category }) => ({
        tag,
        hash,
        sizeBytes,
        ext,
        category,
      })),
    );
  }
  const browseCount = entries.length;
  if (browseCount !== root.totalCount) {
    throw new Error('Catalog totalCount does not match shards');
  }
  // The shards the release index references are the authoritative inventory; the
  // seed rows below only supplement it. A divergent alias resolves in favour of
  // the referenced tag (C-548 Item 4).
  const releaseIndexTags = new Set(entries.map((entry) => entry.tag));
  const dependencies = release?.dependencies ?? SEED_NAMES.map((name) => ({ key: `seed/${name}` }));
  const seedReferences = dependencies.filter(({ key }) => key.endsWith('/asset_seed.json'));
  if (seedReferences.length !== 1) {
    throw new Error('Exactly one pinned asset_seed.json is required');
  }
  for (const reference of dependencies) {
    const data = await get(reference);
    if (!reference.key.endsWith('/asset_seed.json')) {
      continue;
    }
    if (!Value.Check(CompactSeedSchema, data)) {
      throw new Error('Invalid compact asset seed');
    }
    entries.push(
      ...data.r.map((row) => ({
        tag: row.t,
        hash: row.h,
        sizeBytes: row.s,
        ext: row.e,
        category: row.c,
      })),
    );
  }
  // Mutable legacy metadata has no transaction boundary. Observe it twice and label the limitation.
  const probes = release ? new Map([[RELEASE_KEY, pointerBytes]]) : documents;
  for (const [key, before] of probes) {
    const after = await options.remote.readObject(key);
    if (!before || !after || digestBytes(before) !== digestBytes(after)) {
      throw new Error(`Catalog changed during snapshot: ${key}; retry`);
    }
  }
  if (!release && (await options.remote.readObject(RELEASE_KEY))) {
    throw new Error('A release appeared during legacy snapshot; retry');
  }
  const aliasCollisions: AliasCollision[] = [];
  const merged = mergeWorkspaceEntries(entries, {
    releaseIndexTags,
    onAliasCollision: (collision) => aliasCollisions.push(collision),
  });
  const warnings = release
    ? []
    : ['Legacy metadata observed twice; not an atomic published release.'];
  for (const collision of aliasCollisions) {
    warnings.push(
      `Alias collision for ${collision.path}: kept ${collision.kept.tag} (${collision.kept.hash}) ` +
        `over ${collision.dropped.tag} (${collision.dropped.hash}).`,
    );
  }
  if (merged.length !== browseCount) {
    warnings.push(
      `Browse index has ${browseCount} entries; seed/index union has ${merged.length}. Do not publish from a subset.`,
    );
  }
  return {
    snapshot: {
      version: 1,
      mode: options.mode,
      bucket: options.bucket,
      originUrl: options.originUrl,
      consistency: release ? 'release' : 'legacy-observed',
      documents: [...documents]
        .map(([key, bytes]) => ({ key, hash: digestBytes(bytes) }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      entries: merged,
      warnings,
    },
    documents,
  };
};
