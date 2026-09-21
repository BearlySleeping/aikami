// apps/frontend/client/src/lib/views/asset-browser/asset_browser_view_model.test.ts
//
// Unit tests for AssetBrowserViewModel — manifest loading, folder/category
// filtering, preview resolution, and context-menu state.
//
// Collaborators arrive as injected capabilities, so no global `$services` mock
// is required.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { AssetEntry, AssetManifest } from '@aikami/types';
import {
  type AssetBrowserStoreCapabilities,
  createAssetBrowserViewModel,
} from './asset_browser_view_model.svelte';

const sprite: AssetEntry = {
  tag: 'sprites:fantasy:elf',
  category: 'sprites',
  subcategory: 'fantasy',
  name: 'elf',
  path: 'sprites/fantasy/elf.png',
  ext: '.png',
};

const rawData: AssetEntry = {
  tag: 'data:table:loot',
  category: 'data',
  subcategory: 'table',
  name: 'loot',
  path: 'data/table/loot.json',
  ext: '.json',
};

const manifest: AssetManifest = {
  scannedAt: '2026-09-04T00:00:00.000Z',
  count: 2,
  assets: { [sprite.tag]: sprite, [rawData.tag]: rawData },
  byCategory: { sprites: [sprite], data: [rawData] },
};

const createStore = (
  overrides: Partial<AssetBrowserStoreCapabilities> = {},
): AssetBrowserStoreCapabilities => ({
  manifest,
  isLoading: false,
  error: null,
  fetchManifest: mock(async () => {}),
  resolveUrl: mock((tag: string) => `resolved:${tag}`),
  ...overrides,
});

const createViewModel = (store: AssetBrowserStoreCapabilities = createStore()) =>
  createAssetBrowserViewModel({ className: 'AssetBrowserViewModelTest', store });

describe('AssetBrowserViewModel — manifest', () => {
  test('fetches the manifest on initialize', async () => {
    const fetchManifest = mock(async () => {});
    const viewModel = createViewModel(createStore({ fetchManifest }));

    await viewModel.initialize();

    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(viewModel.manifest).toBe(manifest);
  });

  test('reports loading and error state from the store', () => {
    const viewModel = createViewModel(createStore({ isLoading: true, error: 'boom' }));

    expect(viewModel.isLoading).toBe(true);
    expect(viewModel.assetError).toBe('boom');
  });
});

describe('AssetBrowserViewModel — derived lists', () => {
  test('builds a folder tree from the manifest categories', () => {
    const viewModel = createViewModel();

    expect(viewModel.folderTree.map((node) => node.name)).toEqual(['sprites', 'data']);
    expect(viewModel.folderTree[0]?.isDirectory).toBe(true);
    expect(viewModel.folderTree[0]?.children[0]?.name).toBe('elf.png');
  });

  test('filters files by category and folder', () => {
    const viewModel = createViewModel();

    expect(viewModel.currentFiles).toHaveLength(2);

    viewModel.setCategory('sprites');
    expect(viewModel.currentFiles).toEqual([sprite]);

    viewModel.setCategory('all');
    viewModel.navigateToFolder('sprites/fantasy');
    expect(viewModel.currentFiles).toEqual([sprite]);

    viewModel.setCategory('sprites');
    expect(viewModel.selectedFolder).toBe('');
  });

  test('returns an empty tree and file list without a manifest', () => {
    const viewModel = createViewModel(createStore({ manifest: null }));

    expect(viewModel.folderTree).toEqual([]);
    expect(viewModel.currentFiles).toEqual([]);
  });
});

describe('AssetBrowserViewModel — preview', () => {
  test('resolves a preview URL when an asset is open', () => {
    const viewModel = createViewModel();

    viewModel.openAssetPreview(sprite);

    expect(viewModel.previewModalOpen).toBe(true);
    expect(viewModel.hasPreview).toBe(true);
    expect(viewModel.previewUrl).toBe('resolved:sprites:fantasy:elf');
  });

  test('reports no preview for unsupported extensions', () => {
    const viewModel = createViewModel();

    viewModel.openAssetPreview(rawData);

    expect(viewModel.hasPreview).toBe(false);
  });

  test('clears preview state on close', () => {
    const viewModel = createViewModel();
    viewModel.openAssetPreview(sprite);

    viewModel.closePreview();

    expect(viewModel.previewModalOpen).toBe(false);
    expect(viewModel.previewAsset).toBeNull();
    expect(viewModel.previewUrl).toBeNull();
  });
});

describe('AssetBrowserViewModel — context menu', () => {
  test('opens and closes the context menu', () => {
    const viewModel = createViewModel();

    viewModel.openContextMenu(sprite, 10, 20);
    expect(viewModel.contextMenu).toEqual({ open: true, x: 10, y: 20, asset: sprite });

    viewModel.closeContextMenu();
    expect(viewModel.contextMenu.open).toBe(false);
    expect(viewModel.contextMenu.asset).toBeNull();
  });
});

describe('AssetBrowserViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
