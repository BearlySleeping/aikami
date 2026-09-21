// apps/frontend/client/src/lib/services/expression/expression_asset_resolver.ts

import { expressionAssetTag } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { getExpressionEntry } from '$lib/data/expression_catalog';
import { logger } from '$logger';
import type { ExpressionId, ExpressionOverlay } from '$types';
import { assetStore } from '../assets/asset_store.svelte.ts';

// ---------------------------------------------------------------------------
// ExpressionAssetResolver — checks for pre-generated static expression assets
//
// Takes an npcId and emotion, checks a configurable manifest (or predictable
// folder structure) for a pre-existing static image path. Used by the hybrid
// trigger pipeline to bypass ComfyUI generation when a static asset exists.
// ---------------------------------------------------------------------------

/**
 * Manifest entry for a single NPC emotion asset.
 *
 * Maps an `npcId` + `emotion` pair to a URL path for a pre-generated
 * static image (e.g. WebP, PNG).
 */
export type ExpressionAssetEntry = {
  npcId: string;
  emotion: string;
  /** URL path relative to the app's static directory. */
  imagePath: string;
};

/**
 * Synchronous registry seam (C-510).
 *
 * `resolve()` cannot await `assetManager.resolve()` — it is called from the
 * combat and dev composition roots on a synchronous render path — so the
 * registry path goes through the same synchronous lookup
 * `registry_asset_resolver.ts` uses.
 */
export type ExpressionRegistrySeam = {
  /** Whether the catalog has loaded. An unloaded registry is not a miss. */
  isLoaded(): boolean;
  /**
   * Synchronous tag → URL. Returns the registered asset (cached blob URL or
   * origin URL) or `null` when the tag has no registry row.
   */
  resolveUrl(tag: string): string | null;
};

export type ExpressionAssetResolverOptions = BaseFrontendClassOptions & {
  /**
   * Predefined manifest of static expression assets.
   *
   * Each entry maps an npcId + emotion to an image path. If omitted,
   * resolution always returns undefined (no static assets configured).
   */
  manifest?: ExpressionAssetEntry[];

  /**
   * Base path prefix for predictable folder structure resolution.
   *
   * When set, the resolver also checks `/images/npc/{npcId}/{emotion}.webp`
   * in addition to the manifest. Set to undefined to disable path-based
   * resolution.
   *
   * @default '/images/npc'
   */
  basePath?: string;

  /**
   * Synchronous registry seam (C-510). Defaults to the shared AssetStore, so
   * a generated expression registered under an NPC/emotion tag resolves
   * through the registry ahead of the fabricated-path fallback. Pass `null`
   * to disable registry resolution entirely.
   */
  registry?: ExpressionRegistrySeam | null;
};

export type ExpressionAssetResolverInterface = BaseFrontendClassInterface & {
  /**
   * Resolves a static expression asset path for the given NPC and emotion.
   *
   * Checks the manifest first, then falls back to predictable path
   * resolution if `basePath` is configured.
   *
   * @param options.npcId — The NPC identifier.
   * @param options.emotion — The emotion name (e.g. 'joy', 'anger').
   * @returns The image path if a static asset exists, or `undefined`.
   */
  resolve(options: { npcId: string; emotion: string }): string | undefined;

  /**
   * Resolves LPC sprite overlay asset paths for a given expression ID.
   *
   * Reads from the expression catalog to return overlay paths for eyes,
   * eyebrows, and mouth. Each field is optional — missing overlays should
   * be gracefully skipped by the renderer.
   *
   * @param expressionId - Canonical expression identifier.
   * @returns LPC overlay asset paths (may have missing keys).
   */
  resolveLpcOverlays(expressionId: ExpressionId): ExpressionOverlay;
};

/**
 * Resolves pre-generated static expression assets for NPC emotion rendering.
 *
 * Three resolution strategies, checked in order:
 * 1. **Manifest lookup** — exact match in a predefined `ExpressionAssetEntry` list.
 * 2. **Registry lookup** (C-510) — the NPC/emotion tag through the synchronous
 *    `AssetStore` seam, so a locally generated expression is found. Once the
 *    catalog has loaded the registry is authoritative: a tag it does not know
 *    is absent, and no path is fabricated for it.
 * 3. **Predictable path** — constructs `/images/npc/{npcId}/{emotion}.webp`
 *    while the catalog has not loaded (today's behaviour, unchanged).
 *
 * When a static asset path is found, the hybrid trigger pipeline can load it
 * directly without firing a generation request (fast-path).
 *
 * @example
 * ```typescript
 * const resolver = new ExpressionAssetResolver({
 *   className: 'NpcExpressions',
 *   manifest: [
 *     { npcId: 'blacksmith', emotion: 'joy', imagePath: '/images/npc/blacksmith/joy.webp' },
 *   ],
 * });
 *
 * resolver.resolve({ npcId: 'blacksmith', emotion: 'joy' });
 * // => '/images/npc/blacksmith/joy.webp'
 *
 * resolver.resolve({ npcId: 'blacksmith', emotion: 'sadness' });
 * // => undefined (no manifest entry, no file at predictable path)
 * ```
 */
export class ExpressionAssetResolver
  extends BaseFrontendClass<ExpressionAssetResolverOptions>
  implements ExpressionAssetResolverInterface
{
  private readonly _manifest: ExpressionAssetEntry[];
  private readonly _basePath: string | undefined;
  private readonly _registry: ExpressionRegistrySeam | null;

  constructor(options: ExpressionAssetResolverOptions) {
    super(options);
    this._manifest = options.manifest ?? [];
    // Use predictable path only when basePath is explicitly configured.
    // Default to '/images/npc' when the option is omitted entirely.
    // When explicitly passed as undefined, disable path resolution.
    this._basePath = 'basePath' in options ? (options.basePath ?? undefined) : '/images/npc';
    // Omitted → the shared AssetStore (production); `null` → disabled.
    this._registry = 'registry' in options ? (options.registry ?? null) : _defaultRegistrySeam();
  }

  resolveLpcOverlays(expressionId: ExpressionId): ExpressionOverlay {
    const entry = getExpressionEntry(expressionId);
    if (!entry) {
      logger.warn('ExpressionAssetResolver: no catalog entry for expression', { expressionId });
      return {};
    }
    this.debug('resolveLpcOverlays', { expressionId, overlays: entry.lpcOverlays });
    return entry.lpcOverlays;
  }

  resolve(options: { npcId: string; emotion: string }): string | undefined {
    const { npcId, emotion } = options;

    // 1. Check manifest for exact match
    const manifestEntry = this._manifest.find(
      (entry) => entry.npcId === npcId && entry.emotion === emotion,
    );
    if (manifestEntry) {
      this.debug('resolve:manifest-hit', { npcId, emotion, path: manifestEntry.imagePath });
      return manifestEntry.imagePath;
    }

    // 2. Registry (C-510) — a locally generated expression registered under the
    //    NPC/emotion tag resolves here, ahead of the fabricated-path fallback.
    const registry = this._registry;
    const tag = expressionAssetTag({ npcId, emotion });
    if (registry?.isLoaded()) {
      const registeredUrl = registry.resolveUrl(tag);
      if (registeredUrl) {
        this.debug('resolve:registry-hit', { npcId, emotion, tag });
        return registeredUrl;
      }
      // The catalog is loaded and has no row for this tag, so no file exists —
      // fabricating a path here would hand the renderer a guaranteed 404.
      this.debug('resolve:registry-known-absent', { npcId, emotion, tag });
      return undefined;
    }

    // 3. Predictable folder structure (catalog not loaded — unchanged).
    if (this._basePath) {
      const path = `${this._basePath}/${npcId}/${emotion}.webp`;
      this.debug('resolve:predictable-path', { npcId, emotion, path });
      return path;
    }

    this.debug('resolve:miss', { npcId, emotion });
    return undefined;
  }
}

export const getExpressionAssetResolver = (
  options: ExpressionAssetResolverOptions,
): ExpressionAssetResolverInterface => ExpressionAssetResolver.create(options);

/**
 * The production registry seam: the shared AssetStore's synchronous lookup.
 *
 * `assetStore.manifest` is null until the catalog loads — an unloaded registry
 * must not suppress the predictable-path fallback, or every NPC expression
 * would resolve to nothing during boot.
 */
const _defaultRegistrySeam = (): ExpressionRegistrySeam => ({
  isLoaded: () => assetStore.manifest !== null,
  resolveUrl: (tag) => assetStore.resolveUrl(tag),
});
