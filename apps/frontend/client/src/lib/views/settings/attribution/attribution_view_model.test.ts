// apps/frontend/client/src/lib/views/settings/attribution/attribution_view_model.test.ts
//
// Contract: C-381 AC-1 — attribution screen displays provenance.
// Uses the feature-owned fixture pattern: the ViewModel is built with explicit
// capabilities, no production services or module mocks.

import { describe, expect, test } from 'bun:test';
import {
  type AttributionPackManifest,
  type AttributionViewModelOptions,
  attributionEntriesFromManifest,
  createAttributionViewModel,
} from './attribution_view_model.svelte.ts';

const PACK: AttributionPackManifest = {
  name: 'Emberwatch',
  tiles: {
    grass: { name: 'Grass', provenance: { license: 'CC-BY-4.0', author: ['A'], source: 'x' } },
    dirt: { name: 'Dirt' },
  },
  props: {
    chest: {
      name: 'Chest',
      provenance: { license: 'CC0-1.0', author: ['B'], source: 'y', shareAlike: true },
    },
  },
  atlas: { provenance: { license: 'OFL-1.1', author: ['C'], source: 'z' } },
};

const createVm = (overrides: Partial<AttributionViewModelOptions> = {}) =>
  createAttributionViewModel({
    className: 'AttributionViewModel',
    getActiveContentPackId: () => 'emberwatch',
    loadPack: async () => PACK,
    goToHref: () => {},
    ...overrides,
  });

describe('attributionEntriesFromManifest', () => {
  test('flattens tiles, props, and atlas provenance only', () => {
    expect(attributionEntriesFromManifest(PACK)).toEqual([
      {
        assetId: 'tile:Grass',
        license: 'CC-BY-4.0',
        authors: ['A'],
        source: 'x',
        shareAlike: undefined,
      },
      {
        assetId: 'prop:Chest',
        license: 'CC0-1.0',
        authors: ['B'],
        source: 'y',
        shareAlike: true,
      },
      { assetId: 'atlas', license: 'OFL-1.1', authors: ['C'], source: 'z', shareAlike: undefined },
    ]);
  });
});

describe('AttributionViewModel — C-381 AC-1', () => {
  test('starts with empty entries and unknown pack name', () => {
    const vm = createVm();
    expect(vm.entries).toHaveLength(0);
    expect(vm.packName).toBe('');
  });

  test('loads the active pack and exposes provenance rows', async () => {
    let requestedId: string | undefined;
    const vm = createVm({
      getActiveContentPackId: () => 'my-pack',
      loadPack: async (id) => {
        requestedId = id;
        return PACK;
      },
    });
    await vm.initialize();
    expect(requestedId).toBe('my-pack');
    expect(vm.packName).toBe('Emberwatch');
    expect(vm.entries).toHaveLength(3);
  });

  test('falls back to the default pack id when none is active', async () => {
    let requestedId: string | undefined;
    const vm = createVm({
      getActiveContentPackId: () => undefined,
      loadPack: async (id) => {
        requestedId = id;
        return { name: undefined };
      },
    });
    await vm.initialize();
    expect(requestedId).toBe('emberwatch');
    expect(vm.packName).toBe('emberwatch');
  });

  test('degrades gracefully when loading fails', async () => {
    const vm = createVm({
      loadPack: async () => {
        throw new Error('boom');
      },
    });
    await vm.initialize();
    expect(vm.entries).toEqual([]);
    expect(vm.packName).toBe('Unknown');
  });

  test('backToMenu navigates to the start menu', () => {
    let navigated: string | undefined;
    const vm = createVm({
      goToHref: (href) => {
        navigated = href;
      },
    });
    vm.backToMenu();
    expect(navigated).toBe('/start');
  });
});
