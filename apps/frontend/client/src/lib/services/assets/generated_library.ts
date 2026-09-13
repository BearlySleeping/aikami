// apps/frontend/client/src/lib/services/assets/generated_library.ts
//
// C-512: the studio library's projection over the C-510 `generated` pack.
//
// `LibraryEntry` is a *projection*, not a table: the registry has no
// `created_at` and no recipe id, so `createdAt` comes from
// `install_state.downloaded_at` (the cache write) and `ext` from the category's
// recipe in the shared recipe registry. Both fallbacks are documented here
// because they are the only places that know about them.
//
// Mutations (rename / delete) go through `AssetRegistryRepository` — never raw
// SQL in a service or a ViewModel (C-512 Architecture Directives).
//
// Contract: C-512 AC-4 / AC-6

import type { AssetRegistryRepository, GeneratedAssetRow } from '@aikami/frontend/storage';
import { listRecipes } from '@aikami/local-ai';
import type { LibraryEntry } from '@aikami/types';
import { logger } from '$logger';
import type { GeneratedAssetDeleteOutcome } from '$types';
import type { AssetCacheBackend } from './cache_backend.ts';

/** Fallback extension when no recipe declares the row's category. */
const FALLBACK_EXT = '.bin';

/** The seams the library needs — supplied by the AssetManager. */
type GeneratedLibraryDeps = {
  registry: AssetRegistryRepository | null;
  backend: AssetCacheBackend | null;
  /** Releases the cached blob URL for a tag (the manager's URL registry). */
  releaseTagUrl(tag: string): void;
};

/**
 * The extension a category's recipe emits.
 *
 * `LibraryEntry.ext` is display metadata and the registry stores no extension,
 * so it is derived from the recipe registry by category. Categories with more
 * than one recipe (today: none with differing extensions) resolve to the first
 * match; a category no recipe declares falls back to {@link FALLBACK_EXT}.
 */
const extForCategory = (category: string): string => {
  const recipe = listRecipes().find((entry) => entry.category === category);
  return recipe?.output.ext ?? FALLBACK_EXT;
};

/** Maps a `generated`-pack registry row to a `LibraryEntry`. */
const toLibraryEntry = (row: GeneratedAssetRow): LibraryEntry => ({
  tag: row.tag,
  // `assets.category` is free text in the schema; the studio only ever writes
  // recipe categories, and the schema's union is validated on the read path by
  // the consumers that care.
  category: row.category as LibraryEntry['category'],
  sha256: row.sha256,
  sizeBytes: row.sizeBytes,
  ext: extForCategory(row.category),
  provenance: {
    source: row.provenanceSource.length > 0 ? row.provenanceSource : 'generated:unknown',
  },
  createdAt: row.createdAt ?? '',
  localGenerated: row.localGenerated,
});

/**
 * Lists every locally generated asset as a library entry.
 *
 * @throws Error when the manager is not initialised (no registry).
 */
export const listGeneratedLibrary = async (deps: GeneratedLibraryDeps): Promise<LibraryEntry[]> => {
  const { registry } = deps;
  if (!registry) {
    throw new Error('AssetManager is not initialised — the studio library is unavailable');
  }
  const rows = await registry.listGenerated();
  return rows.map(toLibraryEntry);
};

/**
 * Renames a locally generated asset.
 *
 * @throws Error when the row is missing, seed-owned, or the target exists.
 */
export const renameGeneratedLibraryEntry = async (
  deps: GeneratedLibraryDeps,
  options: { from: string; to: string },
): Promise<LibraryEntry> => {
  const { registry } = deps;
  if (!registry) {
    throw new Error('AssetManager is not initialised — cannot rename a local asset');
  }
  const row = await registry.renameGenerated(options);
  // The old tag's blob URL is keyed on the old tag; drop it so the new tag
  // resolves from the cache rather than a stale URL.
  deps.releaseTagUrl(options.from);
  logger.debug('generated_library:renamed', { from: options.from, to: options.to });
  return toLibraryEntry(row);
};

/**
 * Deletes a locally generated asset, its source row, its install state and its
 * cached bytes.
 *
 * Refuses when the tag is seed-owned, and refuses when a save payload mentions
 * the tag unless `force` is set — the reference check is a substring scan over
 * `saves.payload` (there is no reference index), so a hit is a prompt for
 * confirmation, not proof of a dependency.
 *
 * @returns The outcome; `deleted: false` with a `reason` is not an error.
 */
export const deleteGeneratedLibraryEntry = async (
  deps: GeneratedLibraryDeps,
  options: { tag: string; force?: boolean },
): Promise<GeneratedAssetDeleteOutcome> => {
  const { registry, backend } = deps;
  const { tag } = options;
  if (!registry) {
    throw new Error('AssetManager is not initialised — cannot delete a local asset');
  }

  const references = await registry.findSaveReferences(tag);
  if (references.length > 0 && options.force !== true) {
    logger.info('generated_library:delete-refused-save-reference', {
      tag,
      references: references.length,
    });
    return { deleted: false, tag, reason: 'save_reference', references };
  }

  const result = await registry.deleteGenerated(tag);
  if (!result.deleted) {
    return { deleted: false, tag, reason: result.reason, references };
  }

  deps.releaseTagUrl(tag);

  const hash = result.hash;
  if (hash && backend) {
    // Only drop the bytes when no other row still points at them — two
    // generated tags can legitimately share identical content.
    const remaining = await registry.findIdsByHashes([hash]).catch(() => [tag]);
    if (remaining.length === 0) {
      await backend.remove(hash).catch((error: unknown) => {
        logger.warn('generated_library:cache-remove-failed', { tag, hash, error: String(error) });
      });
    }
  }

  logger.info('generated_library:deleted', { tag, hash, references: references.length });
  return { deleted: true, tag, references, ...(hash === undefined ? {} : { hash }) };
};
