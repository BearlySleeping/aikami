// apps/frontend/pwa/src/lib/services/media/expression_asset_resolver.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';

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

export type ExpressionAssetResolverOptions = BaseClassOptions & {
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
};

export type ExpressionAssetResolverInterface = BaseClassInterface & {
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
};

/**
 * Resolves pre-generated static expression assets for NPC emotion rendering.
 *
 * Two resolution strategies, checked in order:
 * 1. **Manifest lookup** — exact match in a predefined `ExpressionAssetEntry` list.
 * 2. **Predictable path** — constructs `/images/npc/{npcId}/{emotion}.webp`.
 *
 * When a static asset path is found, the hybrid trigger pipeline can load it
 * directly without firing a ComfyUI generation request (fast-path).
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
  extends BaseClass<ExpressionAssetResolverOptions>
  implements ExpressionAssetResolverInterface
{
  private readonly _manifest: ExpressionAssetEntry[];
  private readonly _basePath: string | undefined;

  constructor(options: ExpressionAssetResolverOptions) {
    super(options);
    this._manifest = options.manifest ?? [];
    // Use predictable path only when basePath is explicitly configured.
    // Default to '/images/npc' when the option is omitted entirely.
    // When explicitly passed as undefined, disable path resolution.
    this._basePath = 'basePath' in options ? (options.basePath ?? undefined) : '/images/npc';
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

    // 2. Predictable folder structure
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
): ExpressionAssetResolverInterface => new ExpressionAssetResolver(options);
