// apps/frontend/client/src/lib/views/app/error/app_error_view_model.test.ts
//
// Unit tests for AppErrorViewModel — error-type resolution and router
// delegation. The router is an injected capability; `$app/state` is supplied by
// the shared preload.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { page } from '$app/state';
import {
  type AppErrorRouterCapabilities,
  createAppErrorViewModel,
} from './app_error_view_model.svelte';

const createRouter = (
  overrides: Partial<AppErrorRouterCapabilities> = {},
): AppErrorRouterCapabilities => ({
  goBack: mock(async () => {}),
  navigateToApp: mock(async () => {}),
  ...overrides,
});

const createViewModel = (router: AppErrorRouterCapabilities = createRouter()) =>
  createAppErrorViewModel({ router });

const setPage = (values: { status?: number; error?: unknown; pathname?: string }): void => {
  if (values.status !== undefined) {
    Object.assign(page, { status: values.status });
  }
  if (values.error !== undefined) {
    Object.assign(page, { error: values.error });
  }
  if (values.pathname !== undefined) {
    Object.assign(page, { url: new URL(`http://localhost${values.pathname}`) });
  }
};

describe('AppErrorViewModel — error type resolution', () => {
  test('maps HTTP status codes to error types', () => {
    setPage({ status: 404, error: null, pathname: '/' });
    expect(createViewModel().errorType).toBe('page-not-found');

    setPage({ status: 403, error: null, pathname: '/' });
    expect(createViewModel().errorType).toBe('access-denied');

    setPage({ status: 503, error: null, pathname: '/' });
    expect(createViewModel().errorType).toBe('server-error');
  });

  test('honours an explicit error type from the page error', () => {
    setPage({ status: 200, error: { type: 'server-error' }, pathname: '/' });

    expect(createViewModel().errorType).toBe('server-error');
  });

  test('falls back to the pathname hints', () => {
    setPage({ status: 200, error: null, pathname: '/not-found' });

    expect(createViewModel().errorType).toBe('page-not-found');
  });

  test('falls back to unknown-error', () => {
    setPage({ status: 200, error: null, pathname: '/somewhere' });

    expect(createViewModel().errorType).toBe('unknown-error');
  });
});

describe('AppErrorViewModel — router delegation', () => {
  test('handleRetry goes back for 404s and navigates to the app for 403s', async () => {
    const goBack = mock(async () => {});
    const navigateToApp = mock(async () => {});

    setPage({ status: 404, error: null, pathname: '/' });
    await createViewModel(createRouter({ goBack, navigateToApp })).handleRetry();
    expect(goBack).toHaveBeenCalledTimes(1);

    setPage({ status: 403, error: null, pathname: '/' });
    await createViewModel(createRouter({ goBack, navigateToApp })).handleRetry();
    expect(navigateToApp).toHaveBeenCalledTimes(1);
  });

  test('goTo navigates to the app for 403s and goes back otherwise', async () => {
    const goBack = mock(async () => {});
    const navigateToApp = mock(async () => {});

    setPage({ status: 403, error: null, pathname: '/' });
    await createViewModel(createRouter({ goBack, navigateToApp })).goTo();
    expect(navigateToApp).toHaveBeenCalledTimes(1);

    setPage({ status: 404, error: null, pathname: '/' });
    await createViewModel(createRouter({ goBack, navigateToApp })).goTo();
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});

describe('AppErrorViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
