// apps/frontend/client/src/lib/views/start/start_asset_download_status.ts
//
// Presentation for the start menu's asset-download strip (C-448).
//
// Pure module: it maps the asset pipeline's observable state to the shape the
// strip renders, and knows nothing about lifecycle, storage, or routing. It
// lives beside `start_advanced_items.ts` for the same reason — the ViewModel
// keeps the *when* (probe, settle timer, retry) and this owns the *what
// does it look like right now*.

import type { AssetPrefetchServiceInterface } from '$services';

/**
 * How long the start menu waits before it is willing to talk about the asset
 * download at all. The pipeline runs idle → preparing → prefetching-core →
 * ready, and on a returning player with a warm cache that whole sequence
 * finishes in a few frames — rendering each step would flash three different
 * strings and shift the menu. Nothing is shown until the pipeline has had
 * this long to reach a state worth reporting; after that the strip tracks
 * the pipeline live.
 */
export const DOWNLOAD_STATUS_SETTLE_MS = 600;

/** What the start menu is currently saying about the asset download. */
export type AssetDownloadStatusKind =
  /** Work is in flight — starter content or the full offline catalog. */
  | 'progress'
  /** Everything required to play is cached; the full catalog is opt-in. */
  | 'offer'
  /** The full catalog is cached — the game runs with no network at all. */
  | 'complete'
  /** The pipeline degraded (network/storage); retrying is worth a shot. */
  | 'error';

/** Display-ready asset-download state for the start menu's status strip. */
export type AssetDownloadStatus = {
  /** Which of the four shapes to render. */
  readonly kind: AssetDownloadStatusKind;
  /** Sentence shown to the player. */
  readonly label: string;
  /** Completion as 0-1, or undefined while the work is indeterminate. */
  readonly fraction: number | undefined;
  /** Display-ready percentage (e.g. `"42%"`), or undefined when indeterminate. */
  readonly percentLabel: string | undefined;
};

/** The slice of the pipeline this projection reads. */
type AssetPrefetchSnapshot = Pick<
  AssetPrefetchServiceInterface,
  'phase' | 'coreProgress' | 'warmProgress' | 'prefetchError' | 'warmStarted'
>;

/** Turns a done/total pair into the display fields of an AssetDownloadStatus. */
const toProgressLabels = (
  progress: { readonly done: number; readonly total: number } | null,
): { fraction: number | undefined; percentLabel: string | undefined } => {
  if (!progress || progress.total === 0) {
    return { fraction: undefined, percentLabel: undefined };
  }
  const fraction = progress.done / progress.total;
  return { fraction, percentLabel: `${Math.round(fraction * 100)}%` };
};

/**
 * Projects the pipeline onto the strip's display shape.
 *
 * Returns `undefined` while the pipeline has nothing to report — the caller
 * is responsible for holding the strip back until the settle window has
 * passed, so a warm-cache boot never flashes through the transient phases.
 */
export const buildAssetDownloadStatus = (
  assets: AssetPrefetchSnapshot,
): AssetDownloadStatus | undefined => {
  switch (assets.phase) {
    case 'prefetching-core':
      return {
        kind: 'progress',
        label: 'Downloading starter content…',
        ...toProgressLabels(assets.coreProgress),
      };
    case 'warming':
      return {
        kind: 'progress',
        label: 'Downloading everything for offline play…',
        ...toProgressLabels(assets.warmProgress),
      };
    case 'degraded':
      return {
        kind: 'error',
        label: assets.prefetchError ?? 'Asset download paused — check your connection.',
        fraction: undefined,
        percentLabel: undefined,
      };
    case 'ready':
      // warmRemaining() flips the phase to 'warming' synchronously, so a
      // 'ready' phase with warming already requested means it finished.
      return assets.warmStarted
        ? {
            kind: 'complete',
            label: 'Ready for offline play',
            fraction: 1,
            percentLabel: undefined,
          }
        : {
            kind: 'offer',
            label: 'Download everything for offline play',
            fraction: undefined,
            percentLabel: undefined,
          };
    default:
      // 'idle' / 'preparing' — the pipeline has nothing to report yet.
      return undefined;
  }
};
