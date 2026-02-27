import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { page } from '$app/state';
import { routerService } from '$services/index.ts';

import type { BaseMetaTags } from '../metadata/head-tags-view-model.svelte.ts';

type ErrorType = 'page-not-found' | 'access-denied' | 'server-error' | 'unknown-error';

interface CustomError extends Error {
  errorId?: string;
  type?: string;
}

export type AppErrorViewModelOptions = BaseViewModelOptions;

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
  goTo(): void;

  /**
   * Retries the action that caused the error.
   */
  handleRetry(): Promise<void>;
};

class AppErrorViewModel
  extends BaseViewModel<AppErrorViewModelOptions>
  implements AppErrorViewModelInterface
{
  /**
   * The SvelteKit page store.
   */
  private _pageStore = $derived(page);

  readonly errorType = $derived(this._getErrorType());
  readonly host = $derived(this._pageStore.url.origin);
  readonly pathname = $derived(this._pageStore.url.pathname);
  readonly errorId = $derived((this._pageStore.error as CustomError)?.errorId);
  readonly metadata = $derived(this._getMetadata());

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

  readonly currentError = $derived(
    this._errorMessages[this.errorType] || this._errorMessages['unknown-error'],
  );

  /**
   * Gets the metadata for the page.
   * @returns The metadata for the page.
   */
  private _getMetadata(): BaseMetaTags {
    const { title, description } = this.currentError;

    return {
      title,
      description: description,
      type: 'website',
    };
  }

  override async initialize(): Promise<void> {
    const { error, status, url } = this._pageStore;

    if (status === 404) {
      console.warn('Page not found:', url.href);
    } else {
      console.error('Error occurred:', {
        code: status,
        message: error?.message,
      });
    }
    return await super.initialize();
  }

  async handleRetry(): Promise<void> {
    const currentErrorType = this.errorType;
    if (currentErrorType === 'page-not-found') {
      await routerService.goToRoute('dashboard', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } else if (currentErrorType === 'access-denied') {
      await routerService.goToRoute('login', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } else {
      globalThis.window.location.reload();
    }
  }

  goTo(): void {
    const { status } = this._pageStore;

    // Simple navigation fallback
    if (status === 403) {
      globalThis.window.location.href = '/personal';
    } else if (status === 404) {
      globalThis.window.location.href = '/';
    } else {
      globalThis.window.location.href = '/login';
    }
  }

  /**
   * Gets the error type from the page store.
   * @returns The error type.
   */
  private _getErrorType(): ErrorType {
    const status = this._pageStore.status;
    const error = this._pageStore.error as CustomError;
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

export const getAppErrorViewModel = (options: AppErrorViewModelOptions) =>
  new AppErrorViewModel({
    ...options,
    className: 'AppErrorViewModel',
  });
