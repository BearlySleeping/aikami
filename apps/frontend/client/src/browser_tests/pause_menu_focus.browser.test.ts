// apps/frontend/client/src/browser_tests/pause_menu_focus.browser.test.ts
//
// Compiled-browser proof for Pause Menu keyboard accessibility.
//
// The Bun lane covers the focus-cycle arithmetic; this lane mounts the real
// Svelte View in Chromium so the DOM contract is proven as shipped: a
// keyboard-only open lands on the primary action, Tab/Shift+Tab stay inside the
// named dialog, and Escape restores the focus the canvas owned before.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createPauseMenuViewModel } from '../lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';
import {
  createPauseMenuDice,
  createPauseMenuHud,
  createPauseMenuOverlay,
} from '../lib/views/game/ui/overlays/pause_menu/testing/pause_menu_fixtures';
import PauseMenuHarness from './fixtures/pause_menu_harness.svelte';

const openComponents: ReturnType<typeof mount>[] = [];

const unmountLastMenu = async (): Promise<void> => {
  const component = openComponents.pop();
  if (!component) {
    throw new Error('Expected a mounted Pause Menu');
  }
  await unmount(component);
  flushSync();
};

/** Production-shaped canvas region: programmatically focusable, not a Tab stop. */
const mountGameSurface = (): HTMLElement => {
  const container = document.createElement('div');
  container.id = 'game-canvas-container';
  container.tabIndex = -1;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Game world');
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  container.append(canvas);
  document.body.append(container);
  return container;
};

/** A focusable control standing in for whatever HUD element opened the menu. */
const mountFocusOwner = (): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'HUD menu';
  document.body.append(button);
  return button;
};

const pressKey = (key: string, init: KeyboardEventInit = {}): void => {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
};

const mountMenu = (overlayOverrides: Parameters<typeof createPauseMenuOverlay>[0] = {}) => {
  const surface = mountGameSurface();
  const viewModel = createPauseMenuViewModel({
    className: 'PauseMenuViewModel',
    overlay: createPauseMenuOverlay({ resumeGame: () => undefined, ...overlayOverrides }),
    dice: createPauseMenuDice(),
    hud: createPauseMenuHud(),
  });
  const component = mount(PauseMenuHarness, { target: document.body, props: { viewModel } });
  openComponents.push(component);
  flushSync();
  return { viewModel, surface, component };
};

afterEach(async () => {
  while (openComponents.length > 0) {
    const component = openComponents.pop();
    if (component) {
      await unmount(component);
    }
  }
  flushSync();
  document.body.innerHTML = '';
});

const pauseDialog = (): HTMLElement => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Pause Menu"]');
  if (!dialog) {
    throw new Error('Pause Menu dialog is not rendered');
  }
  return dialog;
};

const activeName = (): string => document.activeElement?.textContent?.trim() ?? '';

describe('Pause Menu dialog — keyboard focus (compiled View)', () => {
  test('opening the menu lands focus on the primary Resume action', () => {
    mountMenu();

    expect(activeName()).toBe('Resume');
    expect(pauseDialog().contains(document.activeElement)).toBe(true);
  });

  test('Tab and Shift+Tab cycle inside the dialog and wrap at both ends', () => {
    mountMenu();

    const focusable = pauseDialog().querySelectorAll('button:not([disabled])');
    expect(focusable.length).toBeGreaterThan(2);

    for (let step = 0; step < focusable.length; step += 1) {
      pressKey('Tab');
      expect(pauseDialog().contains(document.activeElement)).toBe(true);
    }
    // A full cycle returns to the landing control instead of escaping the dialog.
    expect(activeName()).toBe('Resume');

    // Shift+Tab from the landing control wraps backwards to the last action.
    pressKey('Tab', { shiftKey: true });
    expect(activeName()).toBe('Quit to Main Menu');

    for (let step = 0; step < focusable.length; step += 1) {
      pressKey('Tab', { shiftKey: true });
      expect(pauseDialog().contains(document.activeElement)).toBe(true);
    }
    expect(activeName()).toBe('Quit to Main Menu');
  });

  test('Escape is consumed before the window dispatcher can reopen Pause', () => {
    const resumeGame = vi.fn();
    const globalDispatch = vi.fn();
    mountMenu({ resumeGame });
    const onWindowKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        globalDispatch();
      }
    };
    window.addEventListener('keydown', onWindowKeydown);
    try {
      pressKey('Escape');
    } finally {
      window.removeEventListener('keydown', onWindowKeydown);
    }
    expect(resumeGame).toHaveBeenCalledTimes(1);
    expect(globalDispatch).not.toHaveBeenCalled();
  });

  test('an IME or already-consumed Escape does not dismiss the menu', () => {
    const resumeGame = vi.fn();
    mountMenu({ resumeGame });
    pressKey('Escape', { isComposing: true });
    const consumed = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    document.activeElement?.dispatchEvent(consumed);
    expect(resumeGame).not.toHaveBeenCalled();
  });

  test('teardown does not steal focus from a newer connected owner', async () => {
    const { viewModel } = mountMenu();
    const newerOwner = mountFocusOwner();
    newerOwner.focus();
    await unmountLastMenu();
    await vi.waitFor(() => expect(document.activeElement).toBe(newerOwner));
    viewModel.dispose();
  });

  test('Escape resumes and returns focus to the control that opened the menu', async () => {
    const resumeGame = vi.fn();
    const owner = mountFocusOwner();
    owner.focus();
    const { viewModel } = mountMenu({ resumeGame });

    pressKey('Escape');
    expect(resumeGame).toHaveBeenCalledTimes(1);

    // The dialog is dismissed by the product layer; simulate that teardown.
    await unmountLastMenu();
    await vi.waitFor(() => expect(document.activeElement).toBe(owner));

    viewModel.dispose();
  });

  test('Escape falls back to the game surface when nothing else owned focus', async () => {
    const { viewModel, surface } = mountMenu();

    await unmountLastMenu();

    await vi.waitFor(() => expect(document.activeElement).toBe(surface));
    // Removing tabindex from a generic div can lose focus in Chromium.
    // Keep the native programmatic stop stable, without adding it to Tab order.
    expect(surface.tabIndex).toBe(-1);
    await Promise.resolve();
    expect(document.activeElement).toBe(surface);

    viewModel.dispose();
  });

  test('the quit confirmation lands focus on its own confirm action', () => {
    const { viewModel } = mountMenu({ resumeGame: () => undefined });

    viewModel.requestQuit();
    flushSync();

    expect(activeName()).toBe('Quit');
    expect(pauseDialog().contains(document.activeElement)).toBe(true);
  });
});
