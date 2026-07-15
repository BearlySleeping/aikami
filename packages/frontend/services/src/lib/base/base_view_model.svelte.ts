import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from './base_frontend_class.ts';

export type BaseViewModelOptions = BaseFrontendClassOptions & {
  startWithLoadingView?: boolean;
};

export type BaseViewModelInterface = BaseFrontendClassInterface & {
  /**
   * Only used internally for BaseViewModelContainer.svelte.
   *
   * This will help to check if onMount is called multiple times on the same
   * view model.
   */
  __mounted: boolean;

  readonly errorMessage: string | undefined;

  /** Replaces the entire view with the AppLoading component in the center. */
  readonly showLoadingView: boolean;

  /**
   * This will only run on the client, after the view model is mounted.
   *
   * If you want logic to run on server and client, use the constructor.
   */
  initialize(): Promise<void>;
};

export abstract class BaseViewModel<Options extends BaseViewModelOptions = BaseViewModelOptions>
  extends BaseFrontendClass<Options>
  implements BaseViewModelInterface
{
  __mounted = false;
  protected _showLoadingView = $state(false);

  errorMessage = $state<string | undefined>();

  /**
   * Array to hold all the $effect.root cleanup functions
   */
  private _effectCleanups: Array<() => void> = [];

  get showLoadingView(): boolean {
    return this._showLoadingView;
  }

  constructor(options: Options) {
    super(options);
    const { startWithLoadingView } = options;
    if (startWithLoadingView) {
      this._showLoadingView = true;
    }
  }

  async initialize(): Promise<void> {
    await Promise.resolve();
  }

  /**
   * Safely registers reactive $effect blocks.
   * They will be automatically destroyed when the ViewModel is disposed.
   */
  protected registerEffectRoot(fn: () => void): void {
    const cleanup = $effect.root(fn);
    this._effectCleanups.push(cleanup);
  }

  /**
   * Override the dispose method to kill all Svelte 5 reactive roots
   * before running the standard class cleanup.
   */
  override async dispose(): Promise<void> {
    this.__mounted = false;

    // Fire every cleanup function to kill the $effects and prevent memory leaks
    for (const cleanup of this._effectCleanups) {
      cleanup();
    }
    this._effectCleanups = []; // clear the array

    return await super.dispose();
  }
}
