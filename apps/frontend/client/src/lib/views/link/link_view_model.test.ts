// apps/frontend/client/src/lib/views/link/link_view_model.test.ts
//
// Unit tests for LinkViewModel — the device-link handoff states. This suite
// exercises the ViewModel through feature-owned auth fixtures; it never mocks
// the global `$services` barrel. `$app/state` is supplied by the shared
// preload, and sessionStorage gets a small polyfill because Bun's test env
// does not provide it.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { page } from '$app/state';
import {
  type AuthCapabilities,
  createLinkViewModel,
  type LinkViewModelInterface,
} from './link_view_model.svelte';

/** Must match the private CODE_STORAGE_KEY in link_view_model.svelte.ts. */
const CODE_STORAGE_KEY = 'aikami-device-link-code';

// Bun's test env has no sessionStorage; the ViewModel persists the link code
// there. Install a Map-backed polyfill once for this file.
if (typeof (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key: (index: number): string | null => [...store.keys()][index] ?? null,
  };
}

const createAuth = (overrides: Partial<AuthCapabilities> = {}): AuthCapabilities => ({
  initialize: async () => {},
  currentUser: undefined,
  isLoggedIn: false,
  isAuthReady: true,
  uid: undefined,
  completeDeviceHandoff: async () => {},
  ...overrides,
});

const createSignedInAuth = (overrides: Partial<AuthCapabilities> = {}): AuthCapabilities =>
  createAuth({
    currentUser: { displayName: 'Test User', email: 'test@example.com' },
    isLoggedIn: true,
    uid: 'test-uid',
    ...overrides,
  });

const createViewModel = (auth: AuthCapabilities): LinkViewModelInterface =>
  createLinkViewModel({
    className: 'LinkViewModelTest',
    startWithLoadingView: true,
    auth,
  });

const setUrl = (url: string): void => {
  page.url = new URL(url);
};

/** Yields until the fire-and-forget `_completeLink()` settles. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('LinkViewModel — missing-code path', () => {
  test('reports missing-code and clears the loading view when no code is present', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link');
    const initialize = mock(async () => {});
    const viewModel = createViewModel(createAuth({ initialize }));

    await viewModel.initialize();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(viewModel.status).toBe('missing-code');
    expect(viewModel.showLoadingView).toBe(false);
    expect(viewModel.code).toBeUndefined();
  });
});

describe('LinkViewModel — signed-out path', () => {
  test('stays signed-out with a code but no session', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link?code=code-abc');
    const viewModel = createViewModel(createAuth());

    await viewModel.initialize();

    expect(viewModel.status).toBe('signed-out');
    expect(viewModel.code).toBe('code-abc');
    expect(viewModel.handoffUrl).toBe('aikami://auth-callback?code=code-abc');
  });
});

describe('LinkViewModel — confirm path', () => {
  test('transitions to confirm when a session is already signed in', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link?code=code-1');
    const viewModel = createViewModel(createSignedInAuth());

    await viewModel.initialize();

    expect(viewModel.status).toBe('confirm');
    expect(viewModel.playerDisplayName).toBe('Test User');
    expect(viewModel.code).toBe('code-1');
    expect(viewModel.showLoadingView).toBe(false);
  });

  test('never auto-completes the handoff', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link?code=code-1');
    const completeDeviceHandoff = mock(async () => {});
    const viewModel = createViewModel(createSignedInAuth({ completeDeviceHandoff }));

    await viewModel.initialize();

    expect(viewModel.status).toBe('confirm');
    expect(completeDeviceHandoff).not.toHaveBeenCalled();
  });
});

describe('LinkViewModel — confirmLink', () => {
  test('completes the handoff and clears the persisted code on success', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link?code=code-42');
    const completeDeviceHandoff = mock(async () => {});
    const viewModel = createViewModel(createSignedInAuth({ completeDeviceHandoff }));

    await viewModel.initialize();
    expect(sessionStorage.getItem(CODE_STORAGE_KEY)).not.toBeNull();

    viewModel.confirmLink();
    await flush();

    expect(completeDeviceHandoff).toHaveBeenCalledTimes(1);
    expect(completeDeviceHandoff).toHaveBeenCalledWith({ code: 'code-42', uid: 'test-uid' });
    expect(viewModel.status).toBe('linked');
    expect(sessionStorage.getItem(CODE_STORAGE_KEY)).toBeNull();
    expect(viewModel.handoffUrl).toBe('aikami://auth-callback?code=code-42');
  });

  test('runs the handoff at most once per confirmation', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link?code=code-42');
    const completeDeviceHandoff = mock(async () => {});
    const viewModel = createViewModel(createSignedInAuth({ completeDeviceHandoff }));

    await viewModel.initialize();

    viewModel.confirmLink();
    viewModel.confirmLink();
    await flush();

    expect(completeDeviceHandoff).toHaveBeenCalledTimes(1);
  });
});

describe('LinkViewModel — error path', () => {
  test('surfaces the failure, clears storage, and permits a retry', async () => {
    sessionStorage.clear();
    setUrl('http://localhost/link?code=code-err');
    const completeDeviceHandoff = mock(async () => {
      throw new Error('handoff exploded');
    });
    const viewModel = createViewModel(createSignedInAuth({ completeDeviceHandoff }));

    await viewModel.initialize();
    viewModel.confirmLink();
    await flush();

    expect(viewModel.status).toBe('error');
    expect(viewModel.errorMessage).toBe('handoff exploded');
    expect(sessionStorage.getItem(CODE_STORAGE_KEY)).toBeNull();

    // The guard resets on failure, so "Link this device" works again.
    viewModel.confirmLink();
    await flush();

    expect(completeDeviceHandoff).toHaveBeenCalledTimes(2);
  });
});

describe('LinkViewModel — real base class', () => {
  test('extends the production BaseViewModel, not a shared fake', () => {
    const viewModel = createViewModel(createAuth());

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    expect('registerEffectRoot' in viewModel).toBe(true);
  });
});
