// packages/frontend/engine/src/assets/content_pack_loader.ts
//
// Content Pack Loader — loads, validates, and provides access to versioned
// content pack manifests. Module-level factory function (NOT a class) with
// in-memory caching, following the same pattern as map_loader.ts.
//
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader

import { ContentPackManifestSchema } from '@aikami/schemas';
import type {
  ContentPackItemEntry,
  ContentPackManifest,
  ContentPackMapEntry,
  ContentPackNpcEntry,
} from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { Value } from 'typebox/value';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// ContentPackLoaderInterface — the loaded pack accessor
// ---------------------------------------------------------------------------

/** Interface for a loaded content pack instance. */
export type ContentPackLoaderInterface = {
  /** The loaded and validated manifest */
  readonly manifest: ContentPackManifest;

  /** The pack ID this loader was created for */
  readonly packId: string;

  /** Resolves the absolute URL for a map file within this pack */
  resolveMapUrl(mapId: string): string;

  /** Looks up a dialogue fallback string by key */
  getDialogue(dialogueKey: string): string | undefined;

  /** Returns the starting map entry */
  getStartingMap(): ContentPackMapEntry;

  /** Returns an NPC entry by ID, or undefined if not found */
  getNpc(npcId: string): ContentPackNpcEntry | undefined;

  /** Returns an item entry by ID, or undefined if not found */
  getItem(itemId: string): ContentPackItemEntry | undefined;

  /** Disposes per-instance resources (no-op if already disposed) */
  dispose(): void;
};

// ---------------------------------------------------------------------------
// ContentPackLoader — internal implementation
// ---------------------------------------------------------------------------

class ContentPackLoader implements ContentPackLoaderInterface {
  readonly manifest: ContentPackManifest;
  readonly packId: string;
  private readonly _basePath: string;
  private _disposed = false;

  constructor(manifest: ContentPackManifest, packId: string, basePath: string) {
    this.packId = packId;
    this.manifest = manifest;
    this._basePath = basePath.replace(/\/+$/, ''); // strip trailing slash
  }

  /** @inheritdoc */
  resolveMapUrl(mapId: string): string {
    this._assertNotDisposed();

    const entry = this.manifest.maps[mapId];
    if (!entry) {
      throw toAppError({
        errorType: 'not-found',
        errorMessage: 'ContentPackLoader: map ID not found in manifest',
        details: { packId: this.packId, mapId },
      });
    }

    // If the file path is absolute (starts with /), return it directly.
    // This supports referencing files outside the pack directory (e.g. shared assets).
    if (entry.file.startsWith('/')) {
      return entry.file;
    }

    const resolved = `${this._basePath}/${this.packId}/${entry.file}`;

    // Path traversal prevention: reject paths containing `..` segments
    if (resolved.includes('..')) {
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'ContentPackLoader: path traversal blocked',
        details: {
          packId: this.packId,
          mapId,
          file: entry.file,
          resolved,
        },
      });
    }

    return resolved;
  }

  /** @inheritdoc */
  getDialogue(dialogueKey: string): string | undefined {
    this._assertNotDisposed();
    return this.manifest.dialogues[dialogueKey];
  }

  /** @inheritdoc */
  getStartingMap(): ContentPackMapEntry {
    this._assertNotDisposed();

    const entry = this.manifest.maps[this.manifest.startingMapId];
    if (!entry) {
      throw toAppError({
        errorType: 'not-found',
        errorMessage: 'ContentPackLoader: startingMapId references unknown map',
        details: {
          packId: this.packId,
          startingMapId: this.manifest.startingMapId,
        },
      });
    }

    return entry;
  }

  /** @inheritdoc */
  getNpc(npcId: string): ContentPackNpcEntry | undefined {
    this._assertNotDisposed();
    return this.manifest.npcs[npcId];
  }

  /** @inheritdoc */
  getItem(itemId: string): ContentPackItemEntry | undefined {
    this._assertNotDisposed();
    return this.manifest.items[itemId];
  }

  /** @inheritdoc */
  dispose(): void {
    this._disposed = true;
  }

  private _assertNotDisposed(): void {
    if (this._disposed) {
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'ContentPackLoader: instance is disposed',
        details: { packId: this.packId },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

let _contentPackCache = new Map<string, ContentPackLoaderInterface>();

// ---------------------------------------------------------------------------
// loadContentPack — module-level factory function
// ---------------------------------------------------------------------------

/**
 * Loads and validates a content pack manifest.
 *
 * Cached per `packId` — calling twice with the same `packId` returns the
 * cached instance without re-fetching.
 *
 * @param options.packId - Content pack identifier (matches Campaign.contentPackId).
 * @param options.basePath - Base path to content-pack root (default: '/content-packs').
 * @param options.fetchFn - Optional fetch override for testing.
 * @returns A {@link ContentPackLoaderInterface} for the loaded pack.
 * @throws If the manifest file is not found, or fails schema validation.
 */
export const loadContentPack = async (options: {
  packId: string;
  basePath?: string;
  fetchFn?: typeof fetch;
}): Promise<ContentPackLoaderInterface> => {
  const { packId, basePath = '/content-packs', fetchFn } = options;

  // Cache check
  const cached = _contentPackCache.get(packId);
  if (cached) {
    logger.debug('loadContentPack:cache-hit', { packId });
    return cached;
  }

  const fetchImpl = fetchFn ?? fetch;
  const manifestUrl = `${basePath}/${packId}/manifest.json`;

  logger.debug('loadContentPack:fetching', { packId, manifestUrl });

  // Fetch manifest
  let response: Response;
  try {
    response = await fetchImpl(manifestUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw toAppError({
      errorType: 'not-found',
      errorMessage: 'ContentPackLoader: failed to fetch manifest',
      details: { packId, manifestUrl, cause: message },
    });
  }

  if (!response.ok) {
    throw toAppError({
      errorType: 'not-found',
      errorMessage: `ContentPackLoader: manifest not found (HTTP ${response.status})`,
      details: { packId, manifestUrl, status: response.status },
    });
  }

  // Parse JSON
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'ContentPackLoader: manifest is not valid JSON',
      details: { packId, manifestUrl, cause: message },
    });
  }

  // Validate schema
  if (!Value.Check(ContentPackManifestSchema, raw)) {
    const errors = [...Value.Errors(ContentPackManifestSchema, raw)];
    const firstError = errors.length > 0 ? String(errors[0].message) : 'unknown';
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: `ContentPackLoader: manifest failed schema validation — ${firstError}`,
      details: {
        packId,
        manifestUrl,
        errorCount: errors.length,
      },
    });
  }

  const manifest = raw as ContentPackManifest;

  // Verify startingMapId references an existing map
  if (!manifest.maps[manifest.startingMapId]) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'ContentPackLoader: startingMapId references unknown map',
      details: { packId, startingMapId: manifest.startingMapId },
    });
  }

  // Create and cache loader
  const loader = new ContentPackLoader(manifest, packId, basePath);
  _contentPackCache.set(packId, loader);

  logger.debug('loadContentPack:loaded', {
    packId,
    version: manifest.version,
    mapCount: Object.keys(manifest.maps).length,
    npcCount: Object.keys(manifest.npcs).length,
    itemCount: Object.keys(manifest.items).length,
    dialogueCount: Object.keys(manifest.dialogues).length,
  });

  return loader;
};

// ---------------------------------------------------------------------------
// clearContentPackCache — reset module-level cache
// ---------------------------------------------------------------------------

/**
 * Clears the module-level content pack cache.
 *
 * Idempotent — safe to call on an empty cache. Call on campaign change
 * or engine dispose to prevent stale manifests from being returned.
 */
export const clearContentPackCache = (): void => {
  const size = _contentPackCache.size;
  if (size > 0) {
    logger.debug('clearContentPackCache', { cleared: size });
  }
  _contentPackCache = new Map<string, ContentPackLoaderInterface>();
};
