// apps/frontend/client/src/lib/views/app/error/app-error-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { page } from '$app/state';
import type { RouterServiceInterface } from '$services';

import type { BaseMetaTags } from '../metadata/head_tags_view_model.svelte.ts';

type ErrorType = 'page-not-found' | 'access-denied' | 'server-error' | 'unknown-error';

interface CustomError extends Error {
  errorId?: string;
  type?: string;
}

/** The router operations the error view delegates to. */
export type AppErrorRouterCapabilities = Pick<RouterServiceInterface, 'goBack' | 'navigateToApp'>;

export type AppErrorViewModelOptions = BaseViewModelOptions & {
  /** Router operations. */
  router: AppErrorRouterCapabilities;
};

export type AppErrorViewModelInterface = BaseViewModelInterface & {
  /**
   * The type of the error.
   */
  readonly errorType: ErrorType;

  /**
   * The host of the page.
   */
  readonly host: string;

  /**
   * The pathname of the page.
   */
  readonly pathname: string;

  /**
   * The ID of the error.
   */
  readonly errorId: string | undefined;

  /**
   * The metadata for the page.
   */
  readonly metadata: BaseMetaTags;

  /**
   * The current error information.
   */
  readonly currentError: { title: string; description: string; icon: string };

  /**
   * Navigates to a different page based on the error.
   */
  goTo(): Promise<void>;

  /**
   * Retries the action that caused the error.
   */
  handleRetry(): Promise<void>;
};

class AppErrorViewModel
  extends BaseViewModel<AppErrorViewModelOptions>
  implements AppErrorViewModelInterface
{
  private readonly _router: AppErrorRouterCapabilities;

  constructor(options: AppErrorViewModelOptions) {
    super(options);
    this._router = options.router;
  }

  // Note: Ensure you have `import { page } from '$app/state';` at the top of your file.

  get errorType() {
    return this._getErrorType();
  }

  get host() {
    return page.url.origin;
  }

  get pathname() {
    return page.url.pathname;
  }

  get errorId() {
    return (page.error as unknown as CustomError | undefined)?.errorId; // guard-ignore lint/type-safety/casting: error data from unknown source; runtime type check precedes cast
  }

  get metadata() {
    return this._getMetadata();
  }

  /**
   * A map of error types to their corresponding messages, descriptions, and icons.
   */
  private readonly _errorMessages: Record<
    ErrorType,
    { title: string; description: string; icon: string }
  > = {
    'page-not-found': {
      title: '404 - Page Not Found',
      description: 'Sorry, the page you are looking for could not be found.',
      icon: 'M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.29-1.445-5.103-3.5',
    },
    'access-denied': {
      title: '403 - Access Denied',
      description: 'You do not have permission to access this page.',
      icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    },
    'server-error': {
      title: '500 - Server Error',
      description: 'Something went wrong on our end. Please try again later.',
      icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    },
    'unknown-error': {
      title: 'Unexpected Error',
      description: 'An unexpected error occurred. Please try again.',
      icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    },
  };

  get currentError() {
    return this._errorMessages[this.errorType] || this._errorMessages['unknown-error'];
  }

  /**
   * Gets the metadata for the page.
   * @returns The metadata for the page.
   */
  private _getMetadata(): BaseMetaTags {
    const { title, description } = this.currentError;

    return {
      title,
      description,
      type: 'website',
    };
  }

  override async initialize(): Promise<void> {
    const { error, status, url } = page;

    // Record error telemetry for debugging
    this.error('app-error-page', {
      error: error instanceof Error ? error.message : String(error),
      status,
      url: url.pathname,
    });
  }

  async handleRetry(): Promise<void> {
    const currentErrorType = this.errorType;
    if (currentErrorType === 'page-not-found') {
      await this._router.goBack();
    } else if (currentErrorType === 'access-denied') {
      await this._router.navigateToApp();
    } else {
      globalThis.window.location.reload();
    }
  }

  async goTo(): Promise<void> {
    const { status } = page;

    if (status === 403) {
      await this._router.navigateToApp();
    } else {
      await this._router.goBack();
    }
  }

  /**
   * Gets the error type from the page store.
   * @returns The error type.
   */
  private _getErrorType(): ErrorType {
    const status = page.status;
    const error = page.error as unknown as CustomError; // guard-ignore lint/type-safety/casting: error data from unknown source; runtime type check precedes cast
    const type = error?.type;
    const pathname = this.pathname;

    if (typeof type === 'string' && this._isValidErrorType(type)) {
      return type;
    }

    if (status === 403) {
      return 'access-denied';
    }
    if (status === 404) {
      return 'page-not-found';
    }
    if (status >= 500) {
      return 'server-error';
    }

    if (pathname.includes('not-found')) {
      return 'page-not-found';
    }
    if (pathname.includes('access-denied')) {
      return 'access-denied';
    }
    if (pathname.includes('server-error')) {
      return 'server-error';
    }

    return 'unknown-error';
  }

  /**
   * Checks if a string is a valid error type.
   * @param type The string to check.
   * @returns Whether the string is a valid error type.
   */
  private _isValidErrorType(type: string): type is ErrorType {
    return ['page-not-found', 'access-denied', 'server-error', 'unknown-error'].includes(
      type as ErrorType,
    );
  }
}

/**
 * Builds an app-error ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getAppErrorViewModel` in ./app_error_composition.ts.
 *
 * @param options - Construction options forwarded to the ViewModel factory.
 * @returns The initialized app-error ViewModel contract.
 */
export const createAppErrorViewModel = (options: AppErrorViewModelOptions) =>
  AppErrorViewModel.create({
    ...options,
    className: 'AppErrorViewModel',
  });
