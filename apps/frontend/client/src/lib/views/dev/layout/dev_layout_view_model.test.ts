// apps/frontend/client/src/lib/views/dev/layout/dev_layout_view_model.test.ts
import { describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// Mock $app/state for page.url.pathname
mock.module('$app/state', () => {
  return {
    page: { url: { pathname: '/dev/text' } },
    navigating: null,
    __esModule: true,
  };
});

import type { DevViewModelInterface } from './dev_layout_view_model.svelte.ts';

const getDevViewModel = async (): Promise<DevViewModelInterface> => {
  const mod = await import('./dev_layout_view_model.svelte.ts');
  return mod.getDevViewModel({ className: 'DevViewModel' });
};

describe('DevViewModel', () => {
  test('getDevViewModel should return a ViewModel instance', async () => {
    const viewModel = await getDevViewModel();
    expect(viewModel).toBeDefined();
    expect(viewModel.navItems).toBeDefined();
  });

  test('navItems should contain all 15 dev console links', async () => {
    const viewModel = await getDevViewModel();
    expect(viewModel.navItems.length).toBe(15);

    const routes = viewModel.navItems.map((item) => item.route);
    expect(routes).toContain('/dev/config');
    expect(routes).toContain('/dev/text');
    expect(routes).toContain('/dev/voice');
    expect(routes).toContain('/dev/image');
    expect(routes).toContain('/dev/audio');
    expect(routes).toContain('/dev/character');
    expect(routes).toContain('/dev/chat');
    expect(routes).toContain('/dev/sandbox');
    expect(routes).toContain('/dev/lpc');
    expect(routes).toContain('/dev/combat');
    expect(routes).toContain('/dev/sandbox/map');
    expect(routes).toContain('/dev/inventory');
    expect(routes).toContain('/dev/quest');
    expect(routes).toContain('/dev/save_load');
    expect(routes).toContain('/dev/settings');
    expect(routes).toContain('/dev/sandbox/map');
  });

  test('each navItem should have route, label, and icon', async () => {
    const viewModel = await getDevViewModel();
    for (const item of viewModel.navItems) {
      expect(typeof item.route).toBe('string');
      expect(item.route.length).toBeGreaterThan(0);
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.icon).toBe('string');
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });

  test('activeRoute should reflect the mocked page.pathname', async () => {
    const viewModel = await getDevViewModel();
    expect(viewModel.activeRoute).toBe('/dev/text');
  });

  test('isDrawerOpen should default to false', async () => {
    const viewModel = await getDevViewModel();
    expect(viewModel.isDrawerOpen).toBe(false);
  });

  test('toggleDrawer should flip isDrawerOpen', async () => {
    const viewModel = await getDevViewModel();
    expect(viewModel.isDrawerOpen).toBe(false);

    viewModel.toggleDrawer();
    expect(viewModel.isDrawerOpen).toBe(true);

    viewModel.toggleDrawer();
    expect(viewModel.isDrawerOpen).toBe(false);
  });
});
