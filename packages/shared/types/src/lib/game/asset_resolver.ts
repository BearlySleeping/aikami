// packages/shared/types/src/lib/game/asset_resolver.ts
//
// Asset resolution seam (C-444): a tag → URL resolver that every preview
// component and engine loader accepts as a parameter.
//
// Two implementations exist and must stay behaviourally interchangeable
// from the caller's point of view:
//   - client: registry → OPFS/Tauri cache → refcounted blob URL → origin
//   - hub:    content-addressed CDN URL, no cache, no state

/**
 * Resolves a catalog tag to a URL a loader can fetch.
 */
export type AssetResolver = {
  /**
   * @param tag - Canonical catalog tag, e.g. "lpc:body:bodies_male:walk".
   * @returns A loadable URL, or null when the tag is unknown.
   */
  readonly resolve: (tag: string) => string | null;
  /**
   * Releases a URL previously returned by `resolve`.
   * A no-op for resolvers that do not hold refcounts.
   */
  readonly release: (url: string) => void;
  /** Identifies the strategy in logs and tests. */
  readonly kind: 'registry' | 'cdn' | 'fixture';
};
