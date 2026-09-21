// apps/frontend/client/src/browser_tests/base_view_model_container.browser.test.ts
//
// Mounts the real BaseViewModelContainer in Chromium and proves the ownership
// contract its callers rely on: one initialize per mount, one dispose per
// mount, replaced identity handled, errors observed, and late initialization
// still torn down. Also covers the AI editor owned by a capability detail page.

import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ContainerHarness from './fixtures/container_harness.svelte';
import {
  createDetailWithEditor,
  createEditorDouble,
  createLifecycleFixture,
} from './fixtures/container_lifecycle_fixtures.svelte';

type HarnessInstance = ReturnType<typeof mount> & {
  replace(): void;
};

const openComponents: ReturnType<typeof mount>[] = [];

const mountHarness = (props: {
  initial: BaseViewModelInterface;
  replacement?: BaseViewModelInterface;
}): HarnessInstance => {
  const component = mount(ContainerHarness, { target: document.body, props });
  openComponents.push(component);
  flushSync();
  return component as unknown as HarnessInstance;
};

const unmountHarness = (component: HarnessInstance): void => {
  const index = openComponents.indexOf(component as unknown as ReturnType<typeof mount>);
  if (index >= 0) {
    openComponents.splice(index, 1);
  }
  void unmount(component as unknown as ReturnType<typeof mount>);
  flushSync();
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

afterEach(() => {
  while (openComponents.length > 0) {
    const component = openComponents.pop();
    if (component) {
      void unmount(component);
    }
  }
  flushSync();
  document.body.innerHTML = '';
});

describe('BaseViewModelContainer — lifecycle ownership', () => {
  test('mount initializes and unmount disposes exactly once', async () => {
    const viewModel = createLifecycleFixture({});

    const component = mountHarness({ initial: viewModel });

    expect(viewModel.initializeCount).toBe(1);
    expect(viewModel.__mounted).toBe(true);
    expect(document.body.textContent).toContain('LifecycleFixture');

    unmountHarness(component);
    await flushMicrotasks();

    expect(viewModel.disposeCount).toBe(1);
    expect(viewModel.__mounted).toBe(false);
  });

  test('repeated tab visits re-initialize and re-dispose the retained instance', async () => {
    const viewModel = createLifecycleFixture({});

    const first = mountHarness({ initial: viewModel });
    await flushMicrotasks();
    unmountHarness(first);
    await flushMicrotasks();
    const second = mountHarness({ initial: viewModel });
    await flushMicrotasks();
    unmountHarness(second);
    await flushMicrotasks();

    expect(viewModel.initializeCount).toBe(2);
    expect(viewModel.disposeCount).toBe(2);
    expect(viewModel.__mounted).toBe(false);
  });

  test('pending initialization at unmount is disposed after it settles, clearing late effects', async () => {
    const viewModel = createLifecycleFixture({
      pendingInitialize: true,
      registerEffectOnInitialize: true,
    });

    const component = mountHarness({ initial: viewModel });
    expect(viewModel.initializeCount).toBe(1);

    unmountHarness(component);
    // Disposal is deferred, not skipped: initialize() has not created resources yet.
    expect(viewModel.disposeCount).toBe(0);

    viewModel.resolveInitialize();
    await flushMicrotasks();

    expect(viewModel.effectCleanupCount).toBe(1);
    expect(viewModel.disposeCount).toBe(1);
    expect(viewModel.__mounted).toBe(false);
  });

  test('an initialization rejection is reported, and the instance still disposes on unmount', async () => {
    const error = new Error('initialize exploded');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const viewModel = createLifecycleFixture({ initializeError: error });

    const component = mountHarness({ initial: viewModel });
    await flushMicrotasks();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('initialize() failed'),
      error,
    );

    unmountHarness(component);
    expect(viewModel.disposeCount).toBe(1);

    consoleError.mockRestore();
  });

  test('a disposal rejection is reported instead of going unhandled', async () => {
    const error = new Error('dispose exploded');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const viewModel = createLifecycleFixture({ disposeError: error });

    const component = mountHarness({ initial: viewModel });
    unmountHarness(component);
    await flushMicrotasks();

    expect(viewModel.disposeCount).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('dispose() failed'), error);

    consoleError.mockRestore();
  });

  test('a replaced viewModel prop disposes the old instance and initializes the new one', async () => {
    const first = createLifecycleFixture({});
    const second = createLifecycleFixture({});

    const component = mountHarness({ initial: first, replacement: second });
    await flushMicrotasks();
    expect(first.initializeCount).toBe(1);
    expect(second.initializeCount).toBe(0);

    component.replace();
    flushSync();
    await flushMicrotasks();

    expect(first.disposeCount).toBe(1);
    expect(first.__mounted).toBe(false);
    expect(second.initializeCount).toBe(1);
    expect(second.__mounted).toBe(true);

    unmountHarness(component);
    await flushMicrotasks();

    expect(first.disposeCount).toBe(1);
    expect(second.disposeCount).toBe(1);
  });

  test('the owned AI editor is disposed exactly once per mount lifetime', async () => {
    const editor = createEditorDouble();
    const detail = createDetailWithEditor(editor);

    const first = mountHarness({ initial: detail });
    await flushMicrotasks();
    expect(editor.editorInitializeCount).toBe(1);
    unmountHarness(first);
    await flushMicrotasks();
    expect(editor.editorDisposeCount).toBe(1);

    // Tab switch back to the retained capability detail instance: one more
    // mount lifetime, still exactly one editor dispose per lifetime.
    const second = mountHarness({ initial: detail });
    await flushMicrotasks();
    expect(editor.editorInitializeCount).toBe(2);
    unmountHarness(second);
    await flushMicrotasks();
    expect(editor.editorDisposeCount).toBe(2);
  });
});
