// apps/frontend/client/src/lib/services/assets/asset_rehydration.ts
//
// C-373 — boot-time cache rehydration.
//
// Extracted from `asset_manager.svelte.ts` so the resolver keeps its focus (and
// its file budget). Everything it needs is passed in explicitly, so the caller
// stays the single owner of the registry, the cache backend and the blob-URL
// registry.
//
// Two passes, both batched (never a per-entry DB fan-out):
//
//   1. **install_state bookkeeping** — every row recorded as `cached` whose
//      registry hash still matches gets its verified hash noted, and (for the
//      offline-core tags only) its blob URL materialised eagerly.
//   2. **content-addressed** — hash-named files in the cache are authoritative
//      even when the bookkeeping was lost (e.g. an in-memory DB across
//      reloads). They are reverse-mapped to registry tags and the missing
//      bookkeeping is repaired.
//
// Every await is wrapped in `withStepTimeout` because both stores can block
// indefinitely in a webview (in-memory SQLite snapshotting to IndexedDB, Tauri
// FS over IPC) without ever rejecting.
//
// Non-core tags deliberately stop at "verified hash": eagerly fetching every
// cached blob costs one IPC round trip each with no aggregate cap, which blew
// the boot pipeline's 20s budget on a 12k-entry Tauri catalog (confirmed
// 2026-08-27). They materialise lazily on first access instead.
//
// Contract: C-373 Unified Asset Resolver

import type { AssetRegistryRepository } from '@aikami/frontend/storage';
import { withStepTimeout } from '$lib/utils/step_timeout';
import type { AssetCacheBackend } from './cache_backend.ts';

/** What rehydration reads and writes. */
type RehydrationDeps = {
  registry: AssetRegistryRepository;
  backend: AssetCacheBackend;
  /** Tags that must resolve synchronously from the first frame (offline core). */
  isCoreTag: (tag: string) => boolean;
  /** Where verified tag→hash pairs are recorded. */
  verifiedHashes: Map<string, string>;
  /** Whether a blob URL is already materialised for a tag. */
  hasBlobUrl: (tag: string) => boolean;
  /** Materialises and registers a blob URL for a verified cached blob. */
  registerBlobUrl: (options: { tag: string; hash: string; blob: Blob }) => void;
  /** Per-step timeout budget, owned by the caller. */
  stepTimeoutMs: number;
  /** Bounded concurrency for the per-entry loops. */
  concurrency: number;
};

/** What one rehydration pass produced. */
type RehydrationResult = {
  /** install_state rows seen (the debug signal the caller logs). */
  cachedRows: number;
  /** Blob URLs materialised eagerly. */
  registered: number;
};

/** Runs `fn` over `items` with at most `concurrency` calls in flight. */
const forEachConcurrent = async <T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> => {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++] as T;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
};

/** Rehydrates verified cached binaries so offline reloads resolve instantly. */
export const rehydrateCachedAssets = async (deps: RehydrationDeps): Promise<RehydrationResult> => {
  const { registry, backend, isCoreTag, verifiedHashes, hasBlobUrl, registerBlobUrl } = deps;
  const { stepTimeoutMs, concurrency } = deps;
  const step = <T>(name: string, run: () => Promise<T>): Promise<T> =>
    withStepTimeout({ name, timeoutMs: stepTimeoutMs, run });

  let registered = 0;

  // ── Pass 1: install_state bookkeeping ────────────────────────────────────
  const states = await step('registry.listInstallStates', () => registry.listInstallStates());
  const stateById = new Map(states.map((state) => [state.assetId, state]));
  const cachedStates = states.filter(
    (state) => state.status === 'cached' && state.cachedHash !== undefined,
  );
  const recordsById = new Map(
    (
      await step('registry.findByIds(cached)', () =>
        registry.findByIds(cachedStates.map((state) => state.assetId)),
      )
    ).map((record) => [record.id, record] as const),
  );

  // The registry hash must still match the recorded cachedHash before the
  // binary is served — stale rows are left for `reconcile()`. Blob URLs are
  // materialised eagerly for this set because the engine resolves through a
  // synchronous resolver, so offline first-access needs the URL ready before
  // the first resolveUrl() call.
  await forEachConcurrent(cachedStates, concurrency, async (state) => {
    const record = recordsById.get(state.assetId);
    if (!record || record.hash !== state.cachedHash) {
      return;
    }
    const cachedHash = state.cachedHash as string;
    verifiedHashes.set(state.assetId, cachedHash);
    if (!isCoreTag(state.assetId)) {
      return;
    }
    const blob = await step('backend.get(cachedState)', () => backend.get(cachedHash));
    if (blob) {
      registerBlobUrl({ tag: state.assetId, hash: cachedHash, blob });
      registered += 1;
    }
  });

  // ── Pass 2: content-addressed ────────────────────────────────────────────
  const cachedHashes = await step('backend.listHashes', () => backend.listHashes()).catch(
    () => [] as string[],
  );
  if (cachedHashes.length > 0) {
    const ids = await step('registry.findIdsByHashes', () =>
      registry.findIdsByHashes(cachedHashes),
    );
    const records = await step('registry.findByIds(byHash)', () => registry.findByIds(ids));
    await forEachConcurrent(records, concurrency, async (record) => {
      if (verifiedHashes.get(record.id) === record.hash) {
        // Already resolved via install_state bookkeeping above — skip the
        // redundant full-file IPC read for this blob.
        return;
      }
      verifiedHashes.set(record.id, record.hash);

      const repairInstallState = async (): Promise<void> => {
        const state = stateById.get(record.id);
        if (state?.status === 'cached') {
          return;
        }
        await step('registry.setInstallState(byHash)', () =>
          registry.setInstallState({
            assetId: record.id,
            status: 'cached',
            cachedHash: record.hash,
            localPath: record.hash,
            downloadedAt: state?.downloadedAt ?? new Date().toISOString(),
          }),
        );
      };

      if (!isCoreTag(record.id)) {
        // Non-core: repair the bookkeeping (a cheap DB write) but skip the IPC
        // blob read — lazily materialised on first actual access instead.
        await repairInstallState();
        return;
      }

      const blob = await step('backend.get(byHash)', () => backend.get(record.hash));
      if (blob) {
        if (!hasBlobUrl(record.id)) {
          registerBlobUrl({ tag: record.id, hash: record.hash, blob });
          registered += 1;
        }
        await repairInstallState();
      }
    });
  }

  return { cachedRows: states.length, registered };
};
