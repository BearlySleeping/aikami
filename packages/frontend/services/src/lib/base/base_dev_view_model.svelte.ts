// packages/frontend/services/src/lib/base/base_dev_view_model.svelte.ts
//
// Abstract base class for dev/sandbox ViewModels that need reactive knowledge
// of whether they are running inside a visual screenshot capture harness.
// When a `?screenshot=true` search parameter is present, overlays unmount to
// provide clean canvas screenshots for VLM visual grounding pipelines.
//
// Contract: C-201

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from './base_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BaseDevViewModelInterface = BaseViewModelInterface & {
  /** True when ?screenshot=true is present in the URL search params. */
  readonly isScreenshot: boolean;
  /** Shorthand for hiding dev overlays — mirrors `isScreenshot` by default. */
  readonly hideOverlays: boolean;
};

export type BaseDevViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export abstract class BaseDevViewModel<
    Options extends BaseDevViewModelOptions = BaseDevViewModelOptions,
  >
  extends BaseViewModel<Options>
  implements BaseDevViewModelInterface
{
  /**
   * Static helper for checking screenshot mode from any context (views,
   * layouts, etc.) that doesn't have a BaseDevViewModel instance.
   *
   * SSR-safe — returns `false` when `window` is undefined.
   */
  static isScreenshot(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return new URLSearchParams(window.location.search).get('screenshot') === 'true';
  }

  readonly isScreenshot = $state<boolean>(false);
  readonly hideOverlays = $state<boolean>(false);

  constructor(options: Options) {
    super(options);

    const screenshot = BaseDevViewModel.isScreenshot();
    this.isScreenshot = screenshot;
    this.hideOverlays = screenshot;
  }
}
