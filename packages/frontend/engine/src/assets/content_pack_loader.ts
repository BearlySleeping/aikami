// packages/frontend/engine/src/assets/content_pack_loader.ts
//
// Content Pack Loader — loads, validates, and provides access to versioned
// content pack manifests. Module-level factory function (NOT a class) with
// in-memory caching, following the same pattern as map_loader.ts.
//
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader

import { ContentPackManifestSchema, normaliseLegacyStep } from '@aikami/schemas';
import type {
  AssetResolver,
  ContentPackCredits,
  ContentPackEncounterEntry,
  ContentPackItemEntry,
  ContentPackManifest,
  ContentPackMapEntry,
  ContentPackNpcEntry,
  ContentPackQuestEntry,
  FactionDefinition,
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

  /**
   * Resolves a map URL back to its map ID, or undefined if no match.
   * Uses suffix matching against each map entry's `.file` path.
   */
  resolveMapId(mapUrl: string): string | undefined;

  /** Looks up a dialogue fallback string by key */
  getDialogue(dialogueKey: string): string | undefined;

  /** Returns the starting map entry */
  getStartingMap(): ContentPackMapEntry;

  /** Returns an NPC entry by ID, or undefined if not found */
  getNpc(npcId: string): ContentPackNpcEntry | undefined;

  /** Returns an item entry by ID, or undefined if not found */
  getItem(itemId: string): ContentPackItemEntry | undefined;

  /** Returns a quest entry by ID, or undefined if not found */
  getQuest(questId: string): ContentPackQuestEntry | undefined;

  /** Returns an encounter entry by ID, or undefined if not found */
  getEncounter(encounterId: string): ContentPackEncounterEntry | undefined;

  /** Returns all quest entries in the pack */
  getAllQuests(): ContentPackQuestEntry[];

  /** Returns all encounter entries in the pack */
  getAllEncounters(): ContentPackEncounterEntry[];

  /** Returns credits or undefined if not present */
  getCredits(): ContentPackCredits | undefined;

  /** Returns a faction definition by ID, or undefined if not found (C-341) */
  getFaction(factionId: string): FactionDefinition | undefined;

  /** Returns all faction definitions from the pack (C-341) */
  getAllFactions(): FactionDefinition[];

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
    // C-434: resolveMapUrl returns the logical path — let loadTilemap/loadJtonMap
    // perform registry resolution internally.
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
  resolveMapId(mapUrl: string): string | undefined {
    this._assertNotDisposed();

    // Normalize the URL to extract a clean pathname for boundary-safe matching.
    let pathname: string;
    try {
      const url = new URL(mapUrl);
      pathname = url.pathname;
    } catch {
      // Not a valid URL — treat as relative path
      pathname = mapUrl.startsWith('/') ? mapUrl : `/${mapUrl}`;
    }

    // Require the pathname to end with "/<mapFile>" (path-boundary match).
    // This prevents a shorter filename like "road.json" from matching "maps/old_road.json".
    for (const [mapId, entry] of Object.entries(this.manifest.maps)) {
      if (pathname.endsWith(`/${entry.file}`)) {
        return mapId;
      }
    }
    return undefined;
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
  getQuest(questId: string): ContentPackQuestEntry | undefined {
    this._assertNotDisposed();
    return this.manifest.quests?.[questId];
  }

  /** @inheritdoc */
  getEncounter(encounterId: string): ContentPackEncounterEntry | undefined {
    this._assertNotDisposed();
    return this.manifest.encounters?.[encounterId];
  }

  /** @inheritdoc */
  getAllQuests(): ContentPackQuestEntry[] {
    this._assertNotDisposed();
    return Object.values(this.manifest.quests ?? {});
  }

  /** @inheritdoc */
  getAllEncounters(): ContentPackEncounterEntry[] {
    this._assertNotDisposed();
    return Object.values(this.manifest.encounters ?? {});
  }

  /** @inheritdoc */
  getCredits(): ContentPackCredits | undefined {
    this._assertNotDisposed();
    return this.manifest.credits;
  }

  /** @inheritdoc */
  getFaction(factionId: string): FactionDefinition | undefined {
    this._assertNotDisposed();
    return this.manifest.factions?.[factionId];
  }

  /** @inheritdoc */
  getAllFactions(): FactionDefinition[] {
    this._assertNotDisposed();
    return Object.values(this.manifest.factions ?? {});
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
 * C-448: the bundled-path fallback has been removed. All content packs are
 * resolved through the registry (R2) — there is no bundled copy to fall back
 * to. If the resolver returns null or the fetch fails, an AppError is thrown.
 *
 * The default `basePath` is empty — NOT '/content-packs' — because the
 * catalog seed's tags for content-pack assets are relative to `content/packs/`
 * (e.g. `emberwatch:manifest`, `emberwatch:maps:village`; see
 * generate_asset_seed.ts). `assetTagResolver` derives its lookup tag from
 * this same path via `pathToTag`, so a non-empty basePath segment (like the
 * pre-C-448 `/content-packs` bundled-fallback prefix) corrupts the tag —
 * `content-packs:emberwatch:manifest` never matches a seed row, silently
 * forcing every content-pack fetch through the (now nonexistent) local
 * fallback path.
 *
 * @param options.packId - Content pack identifier (matches Campaign.contentPackId).
 * @param options.basePath - Base path to content-pack root (default: '').
 * @param options.fetchFn - Optional fetch override for testing.
 * @param options.resolveTag - Optional registry-backed tag resolver (C-434).
 * @param options.releaseUrl - Optional blob URL release function (C-434).
 * @returns A {@link ContentPackLoaderInterface} for the loaded pack.
 * @throws If the manifest file is not found, or fails schema validation.
 */
export const loadContentPack = async (options: {
  packId: string;
  basePath?: string;
  fetchFn?: typeof fetch;
  resolveTag?: AssetResolver | ((tag: string) => string | null);
  releaseUrl?: (url: string) => void;
}): Promise<ContentPackLoaderInterface> => {
  const { packId, basePath = '', fetchFn, resolveTag } = options;

  // Derive releaseUrl from resolveTag.release for object-shaped resolvers,
  // or use the explicit releaseUrl parameter for legacy function resolvers.
  const releaseUrl =
    options.releaseUrl ??
    (resolveTag && typeof resolveTag === 'object' ? resolveTag.release : undefined);

  // Cache check
  const cached = _contentPackCache.get(packId);
  if (cached) {
    logger.debug('loadContentPack:cache-hit', { packId });
    return cached;
  }

  const fetchImpl = fetchFn ?? fetch;
  const manifestUrl = `${basePath}/${packId}/manifest.json`;

  // C-434: resolve the manifest URL through the asset registry when a
  // resolver is provided.
  const resolvedManifestUrl = resolveTag
    ? ((typeof resolveTag === 'function'
        ? resolveTag(manifestUrl)
        : resolveTag.resolve(manifestUrl)) ?? manifestUrl)
    : manifestUrl;

  logger.debug('loadContentPack:fetching', {
    packId,
    manifestUrl,
    resolvedUrl: resolvedManifestUrl !== manifestUrl ? resolvedManifestUrl : undefined,
  });

  // Fetch manifest
  let response: Response;
  try {
    response = await fetchImpl(resolvedManifestUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw toAppError({
      errorType: 'not-found',
      errorMessage: 'ContentPackLoader: failed to fetch manifest',
      details: { packId, manifestUrl: resolvedManifestUrl, cause: message },
    });
  }

  if (!response.ok) {
    throw toAppError({
      errorType: 'not-found',
      errorMessage: `ContentPackLoader: manifest not found (HTTP ${response.status})`,
      details: { packId, manifestUrl: resolvedManifestUrl, status: response.status },
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

  // Release the blob URL after parsing — the data is now in memory and the
  // URL is no longer needed.
  if (releaseUrl && resolvedManifestUrl !== manifestUrl) {
    releaseUrl(resolvedManifestUrl);
  }

  // Normalize legacy onboarding steps before schema validation so bare-string
  // actions (e.g. action: 'interact') are transformed to discriminated union
  // shape ({ kind: 'input', actionId: 'interact' }) before TypeBox checks.
  if (
    raw &&
    typeof raw === 'object' &&
    'onboarding' in raw &&
    raw.onboarding &&
    typeof raw.onboarding === 'object' &&
    'steps' in raw.onboarding &&
    Array.isArray(raw.onboarding.steps)
  ) {
    raw.onboarding.steps = raw.onboarding.steps.map((step: unknown) => {
      if (typeof step === 'object' && step !== null) {
        return normaliseLegacyStep(step as Record<string, unknown>);
      }
      return step;
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
