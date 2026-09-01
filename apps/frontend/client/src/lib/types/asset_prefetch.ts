// apps/frontend/client/src/lib/types/asset_prefetch.ts

/** Phase of the shared asset-prefetch pipeline — drives the start-menu indicator. */
export type AssetPrefetchPhase =
  | 'idle'
  | 'preparing'
  | 'prefetching-core'
  | 'warming'
  | 'ready'
  | 'degraded';
