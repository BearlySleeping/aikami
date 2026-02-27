import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from './base-frontend-class.ts';

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

  constructor(options: Options) {
    super(options);
    const { startWithLoadingView } = options;
    if (startWithLoadingView) {
      this._showLoadingView = true;
    }
  }

  async initialize(): Promise<void> {
    this.debug('initialized');
    await Promise.resolve();
  }

  get showLoadingView(): boolean {
    return this._showLoadingView;
  }
}
