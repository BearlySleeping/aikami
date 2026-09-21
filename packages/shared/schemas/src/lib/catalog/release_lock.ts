// packages/shared/schemas/src/lib/catalog/release_lock.ts
//
// Versioned release pointer + installed pack lock (C-496 AC-4).
//
// A catalog publish is revision-consistent only if readers can never observe
// a mixture of old and new objects. The pipeline advances a single release
// pointer document that names the exact manifest/shard revisions and required
// seed dependencies of a complete release; it is written ONLY after every
// required object, shard and seed file has been confirmed uploaded, so the
// previous complete release stays readable until then.
//
// `InstalledPackLockSchema` pins image and definition content hashes for an
// offline install: repacking an atlas cannot change logical frame identity or
// reskin a save, and an offline client validates its local bytes against the
// pinned hashes. The existing `index/v1/` path remains the read-compatible
// legacy surface for old clients.
//
// Contract: C-496

import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import type { PackAudioBindings } from '../media/audio_cue_binding.ts';
import { CATALOG_SHA256_PATTERN } from './hash.ts';

/**
 * Catalog key of the installed pack lock document (C-523).
 *
 * Shared so the publish/origin side that *writes* the lock and the client that
 * *reads* it cannot drift apart on the path.
 */
export const PACK_LOCK_KEY = 'index/v1/pack_lock.json';

/**
 * The current release-pointer schema version.
 */
export const RELEASE_POINTER_SCHEMA_VERSION = 'catalog.release.v1' as const;

/**
 * A pinned dependency required by a release (e.g. a seed/metadata file).
 */
export const ReleaseDependencySchema = Type.Object(
  {
    /** Immutable key, e.g. `seed/<sha256>/asset_seed.json`. */
    key: Type.String({ minLength: 1 }),
    /** Immutable content hash of the dependency bytes. */
    hash: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
  },
  { additionalProperties: false },
);

export type ReleaseDependency = Static<typeof ReleaseDependencySchema>;

/**
 * A shard object included in a release.
 */
export const ReleaseShardSchema = Type.Object(
  {
    /** Category id, e.g. `lpc`. */
    category: Type.String({ minLength: 1 }),
    /** Content-addressed shard key, e.g. `index/v1/revisions/<sha256>/lpc.json`. */
    key: Type.String({ minLength: 1 }),
    /** Content hash of the shard bytes. */
    hash: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
  },
  { additionalProperties: false },
);

export type ReleaseShard = Static<typeof ReleaseShardSchema>;

/**
 * The versioned release pointer document.
 *
 * Consumers fetch this to learn which immutable manifest/shard revisions and
 * required dependencies constitute the current complete release. It is
 * written atomically last, so readers always see the old complete release or
 * the new complete release — never mixed revisions.
 */
export const ReleasePointerSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RELEASE_POINTER_SCHEMA_VERSION),
    /** Release id (e.g. a timestamp or monotonic sequence). */
    releaseId: Type.String({ minLength: 1 }),
    /** Root index key this release points at. */
    rootKey: Type.String({ minLength: 1 }),
    /** Content hash of the root index bytes. */
    rootHash: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
    /** Shard revisions included in this release. */
    shards: Type.Array(ReleaseShardSchema, { minItems: 1 }),
    /** Required dependencies (seed/metadata) pinned for offline install. */
    dependencies: Type.Array(ReleaseDependencySchema, { minItems: 1 }),
    /** UTC ISO timestamp of the publish. */
    publishedAt: Type.String(),
  },
  { additionalProperties: false },
);

export type ReleasePointer = Static<typeof ReleasePointerSchema>;

// ---------------------------------------------------------------------------
// Release-graph resolution (shared by the client boot path and tooling)
// ---------------------------------------------------------------------------

/** A document reader that returns raw bytes, or `undefined` for a 404. */
export type ReleaseDocumentReader = (key: string) => Promise<Uint8Array | undefined>;

/** Why a release-graph resolution failed. */
export type ReleaseGraphFailureCode =
  | 'corrupt-pointer'
  | 'missing-object'
  | 'integrity-failure'
  | 'missing-seed';

/** A typed release-graph resolution failure. */
export class ReleaseGraphError extends Error {
  readonly code: ReleaseGraphFailureCode;

  constructor(code: ReleaseGraphFailureCode, message: string) {
    super(message);
    this.name = 'ReleaseGraphError';
    this.code = code;
  }
}

/** A reader/transport failure the caller must not mistake for "absent". */
export class ReleaseReadError extends Error {
  constructor(key: string, cause: unknown) {
    super(
      `Release document read failed for ${key}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ReleaseReadError';
  }
}

/** The resolved, hash-verified release graph. */
export type ResolvedReleaseGraph = {
  releaseId: string;
  /** The parsed release pointer (already schema-validated). */
  pointer: ReleasePointer;
  /** Raw bytes of the pinned boot seed (`asset_seed.json`). */
  seedBytes: Uint8Array;
  /** Raw bytes of the pinned offline-core declaration, when present. */
  offlineCoreBytes: Uint8Array | undefined;
  /** Every verified document, keyed by catalog key. */
  documents: Map<string, Uint8Array>;
};

/** Lowercase hex SHA-256, via WebCrypto (present in Bun and the browser). */
const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // Copy into a fresh ArrayBuffer-backed view: WebCrypto's DOM typings require
  // `Uint8Array<ArrayBuffer>`, while callers may hand back a `Buffer`-backed
  // view typed as `Uint8Array<ArrayBufferLike>`.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Resolves a published release graph through a document reader.
 *
 * Shared by the production client boot path and the release tooling so the two
 * cannot drift: both validate the pointer with `ReleasePointerSchema`, verify
 * the root, every shard and the pinned seed/offline-core dependencies by
 * SHA-256, and fail closed on any mismatch. An absent pointer returns
 * `undefined` so the caller can take an explicit compatibility path; a corrupt
 * pointer or an integrity failure throws — it is never silently treated as
 * "no release".
 *
 * @param options.reader - Returns bytes for a key, or `undefined` for a 404.
 * @returns The verified graph, or `undefined` when no pointer exists.
 * @throws {ReleaseReadError | Error} On transport failure, corrupt metadata or
 *   an integrity mismatch.
 */
export const resolveReleaseGraph = async (options: {
  reader: ReleaseDocumentReader;
}): Promise<ResolvedReleaseGraph | undefined> => {
  const { reader } = options;
  const read = async (key: string): Promise<Uint8Array | undefined> => {
    try {
      return await reader(key);
    } catch (error) {
      // A transport failure must never look like an absent object.
      throw new ReleaseReadError(key, error);
    }
  };

  const pointerBytes = await read('index/v1/release.json');
  if (!pointerBytes) {
    return undefined;
  }

  let pointerValue: unknown;
  try {
    pointerValue = JSON.parse(new TextDecoder().decode(pointerBytes));
  } catch (error) {
    throw new ReleaseGraphError(
      'corrupt-pointer',
      `Release pointer is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Value.Check(ReleasePointerSchema, pointerValue)) {
    throw new ReleaseGraphError(
      'corrupt-pointer',
      'Malformed release pointer; refusing legacy fallback',
    );
  }
  const pointer = pointerValue as ReleasePointer;

  const documents = new Map<string, Uint8Array>();
  documents.set('index/v1/release.json', pointerBytes);

  /** Reads and hash-verifies one pinned object. */
  const readVerified = async (reference: { key: string; hash: string }): Promise<Uint8Array> => {
    const bytes = await read(reference.key);
    if (!bytes) {
      throw new ReleaseGraphError('missing-object', `Release dependency missing: ${reference.key}`);
    }
    const digest = await sha256Hex(bytes);
    if (digest !== reference.hash) {
      throw new ReleaseGraphError(
        'integrity-failure',
        `Release integrity failure: ${reference.key}`,
      );
    }
    documents.set(reference.key, bytes);
    return bytes;
  };

  await readVerified({ key: pointer.rootKey, hash: pointer.rootHash });
  for (const shard of pointer.shards) {
    await readVerified({ key: shard.key, hash: shard.hash });
  }
  for (const dependency of pointer.dependencies) {
    await readVerified(dependency);
  }

  const seedDependency = pointer.dependencies.find((dependency) =>
    dependency.key.endsWith('/asset_seed.json'),
  );
  if (!seedDependency) {
    throw new ReleaseGraphError('missing-seed', 'Release pins no asset_seed.json dependency');
  }
  const seedBytes = documents.get(seedDependency.key);
  if (!seedBytes) {
    throw new ReleaseGraphError(
      'missing-object',
      `Release dependency missing: ${seedDependency.key}`,
    );
  }

  const coreDependency = pointer.dependencies.find((dependency) =>
    dependency.key.endsWith('/offline_core.json'),
  );
  const offlineCoreBytes = coreDependency ? documents.get(coreDependency.key) : undefined;

  return {
    releaseId: pointer.releaseId,
    pointer,
    seedBytes,
    offlineCoreBytes,
    documents,
  };
};

/**
 * A pinned image/definition hash in an installed pack lock.
 */
export const PackLockedAssetSchema = Type.Object(
  {
    /** Stable asset id. */
    id: Type.String({ minLength: 1 }),
    /** Content hash of the image bytes (immutable). */
    imageHash: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
    /** Content hash of the visual definition (immutable). */
    definitionHash: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
  },
  { additionalProperties: false },
);

export type PackLockedAsset = Static<typeof PackLockedAssetSchema>;

/**
 * A pinned audio rendition hash in an installed pack lock (C-523).
 *
 * `PackLockedAssetSchema` pins image and definition hashes only, and is
 * `additionalProperties: false` — audio therefore needs its own optional
 * array rather than extra keys on the visual record. `id` is the authored
 * cue id; `renditionHash` is the SHA-256 of the installed rendition bytes.
 */
export const PackLockedAudioAssetSchema = Type.Object(
  {
    /** Authored cue id this pin covers. */
    id: Type.String({ minLength: 1 }),
    /** Content hash of the installed audio rendition bytes (immutable). */
    renditionHash: Type.String({ pattern: CATALOG_SHA256_PATTERN }),
  },
  { additionalProperties: false },
);

export type PackLockedAudioAsset = Static<typeof PackLockedAudioAssetSchema>;

/**
 * Installed pack lock — pins image and definition content hashes so an
 * offline install resolves the exact bytes a release was published against.
 *
 * Repacking an atlas cannot change logical frame identity or reskin a save
 * because logical frame identity is pinned to these hashes.
 *
 * C-523: `audioAssets` is optional and additive, so a lock written before
 * audio pins existed still validates and still pins its image/definition
 * hashes. Audio is hash-verified only when the pack actually declares it.
 */
export const InstalledPackLockSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RELEASE_POINTER_SCHEMA_VERSION),
    /** The release this lock was installed from. */
    releaseId: Type.String({ minLength: 1 }),
    /** Pinned image/definition hashes for the installed assets. */
    assets: Type.Array(PackLockedAssetSchema, { minItems: 1 }),
    /**
     * Pinned audio rendition hashes (C-523). Absent on a lock written before
     * the audio binding section existed — old locks keep validating.
     */
    audioAssets: Type.Optional(
      Type.Array(PackLockedAudioAssetSchema, {
        minItems: 1,
        description: 'Pinned audio rendition hashes keyed by authored cue id (C-523)',
      }),
    ),
  },
  { additionalProperties: false },
);

export type InstalledPackLock = Static<typeof InstalledPackLockSchema>;

/**
 * What went wrong for one authored audio cue during offline verification.
 *
 * C-523 AC-5. `InstalledPackLockSchema` pinned image and definition hashes
 * only, and `PackLockedAssetSchema` is `additionalProperties: false`, so audio
 * could not be hash-pinned without the optional `audioAssets` array above.
 */
export const AUDIO_LOCK_VERIFICATION_KINDS = [
  /** The cue is authored but the lock pins nothing for it. */
  'missing-pin',
  /** The lock pins a hash but no installed bytes were found. */
  'missing-bytes',
  /** The installed bytes do not hash to the pinned value. */
  'hash-mismatch',
  /** The lock pins a cue the pack does not author. */
  'orphan-pin',
] as const;

/** An audio lock verification finding kind. */
export type AudioLockVerificationKind = (typeof AUDIO_LOCK_VERIFICATION_KINDS)[number];

/** One audio lock verification finding. */
export type AudioLockVerificationIssue = {
  /** Authored cue id the finding belongs to. */
  cueId: string;
  kind: AudioLockVerificationKind;
  /** Whether the pack declares this cue as `required`. */
  required: boolean;
};

/** The result of verifying installed audio against the lock's pins. */
export type AudioLockVerification = {
  /** False only when a *required* cue failed verification. */
  ok: boolean;
  issues: AudioLockVerificationIssue[];
};

/**
 * Verifies installed audio bytes against the pack lock's optional audio pins.
 *
 * A pack that authors no audio (every pack shipped before C-523, and any pack
 * that simply does not use the feature) has nothing to verify and passes
 * unchanged — a lock written before `audioAssets` existed still validates.
 *
 * Optional cues degrade through their declared fallback, so their problems are
 * reported without failing the check; a `required` cue that cannot be verified
 * fails loudly, matching how pack validation treats an unresolvable required
 * cue. Pure — the caller reads and hashes the bytes; this decides.
 *
 * @param options.bindings - The pack's authored audio section, if any.
 * @param options.audioAssets - The installed lock's optional audio pins.
 * @param options.installedHashes - SHA-256 of installed bytes, keyed by cue id.
 * @returns Whether verification passed, plus every finding.
 */
export const verifyInstalledAudioAgainstLock = (options: {
  bindings: PackAudioBindings | undefined;
  audioAssets: readonly PackLockedAudioAsset[] | undefined;
  installedHashes: Readonly<Record<string, string>>;
}): AudioLockVerification => {
  const { bindings, audioAssets, installedHashes } = options;

  const authored = bindings?.bindings ?? [];
  const pins = audioAssets ?? [];

  if (authored.length === 0 && pins.length === 0) {
    return { ok: true, issues: [] };
  }

  const issues: AudioLockVerificationIssue[] = [];
  const authoredCueIds = new Set(authored.map((binding) => binding.cueId));

  for (const binding of authored) {
    const required = binding.resolution === 'required';
    const pin = pins.find((candidate) => candidate.id === binding.cueId);

    if (!pin) {
      issues.push({ cueId: binding.cueId, kind: 'missing-pin', required });
      continue;
    }

    const installed = installedHashes[binding.cueId];
    if (installed === undefined) {
      issues.push({ cueId: binding.cueId, kind: 'missing-bytes', required });
      continue;
    }

    if (installed !== pin.renditionHash) {
      issues.push({ cueId: binding.cueId, kind: 'hash-mismatch', required });
    }
  }

  for (const pin of pins) {
    if (!authoredCueIds.has(pin.id)) {
      issues.push({ cueId: pin.id, kind: 'orphan-pin', required: false });
    }
  }

  return { ok: !issues.some((issue) => issue.required), issues };
};
