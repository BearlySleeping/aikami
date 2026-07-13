// apps/frontend/client/src/lib/views/asset-browser/asset_browser_view_model.svelte.ts
//
// ViewModel for the Asset Browser panel. Displays the asset manifest,
// folder tree navigation, file grid filtering, and preview modals.
//
// Upload is a local-only operation: users place files in
// static/game-data/ and run the manifest scanner (Bun CLI or Tauri).
// The upload modal shows instructions instead of a network form.
//
// Contract: C-243

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AssetEntry, AssetTreeNode } from '@aikami/types';
import { assetStore } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetBrowserViewModelInterface = BaseViewModelInterface & {
  /** Full asset manifest (null while loading). */
  readonly manifest: typeof assetStore.manifest;
  /** Whether the manifest is currently being fetched. */
  readonly isLoading: boolean;
  /** Error message if manifest fetch failed. */
  readonly assetError: string | null;
  /** Hierarchical folder tree for the left sidebar. */
  readonly folderTree: AssetTreeNode[];
  /** Currently selected folder path. */
  selectedFolder: string;
  /** Files in the currently selected folder. */
  readonly currentFiles: AssetEntry[];
  /** Active category tab filter. */
  activeCategory: string;
  /** Upload info modal open state. */
  uploadInfoOpen: boolean;
  /** Preview modal open state. */
  previewModalOpen: boolean;
  /** Asset currently being previewed. */
  previewAsset: AssetEntry | null;
  /** Preview URL (resolved from tag). */
  readonly previewUrl: string | null;
  /** Whether a preview is available (image or audio). */
  readonly hasPreview: boolean;

  /** Initialize: loads the manifest on mount. */
  initialize(): Promise<void>;
  /** Fetch the manifest. */
  fetchManifest(): Promise<void>;
  /** Navigate to a folder in the tree. */
  navigateToFolder(path: string): void;
  /** Set the active category tab. */
  setCategory(category: string): void;
  /** Open upload info modal. */
  openUploadInfo(): void;
  /** Close upload info modal. */
  closeUploadInfo(): void;
  /** Open asset preview. */
  openAssetPreview(asset: AssetEntry): void;
  /** Close asset preview. */
  closePreview(): void;
  /** Open the assets folder in the OS file explorer (Tauri) or show the path. */
  openAssetsFolder(): void;

  // Context menu
  readonly contextMenu: {
    open: boolean;
    x: number;
    y: number;
    asset: AssetEntry | null;
  };
  openContextMenu(asset: AssetEntry, x: number, y: number): void;
  closeContextMenu(): void;
  renameAsset(asset: AssetEntry): void;
  deleteAsset(asset: AssetEntry): void;
};

export type AssetBrowserViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export class AssetBrowserViewModel
  extends BaseViewModel<AssetBrowserViewModelOptions>
  implements AssetBrowserViewModelInterface
{
  selectedFolder = $state<string>('');
  activeCategory = $state<string>('all');
  uploadInfoOpen = $state<boolean>(false);
  previewModalOpen = $state<boolean>(false);
  previewAsset = $state<AssetEntry | null>(null);

  // Context menu state
  contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    asset: AssetEntry | null;
  }>({ open: false, x: 0, y: 0, asset: null });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.fetchManifest();
    await super.initialize();
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  get manifest() {
    return assetStore.manifest;
  }

  get isLoading() {
    return assetStore.isLoading;
  }

  get assetError() {
    return assetStore.error;
  }

  get folderTree() {
    if (!assetStore.manifest) {
      return [];
    }

    const tree: AssetTreeNode[] = [];
    for (const [categoryName, entries] of Object.entries(assetStore.manifest.byCategory)) {
      if (entries.length === 0) {
        continue;
      }

      const categoryNode: AssetTreeNode = {
        name: categoryName,
        path: categoryName,
        isDirectory: true,
        children: entries.map((entry) => ({
          name: entry.path.split('/').pop() ?? entry.name,
          path: entry.path,
          isDirectory: false,
          children: [],
        })),
      };

      tree.push(categoryNode);
    }

    return tree;
  }

  get currentFiles() {
    if (!assetStore.manifest) {
      return [];
    }

    let entries: AssetEntry[];

    if (this.activeCategory === 'all') {
      entries = Object.values(assetStore.manifest.assets);
    } else {
      entries = assetStore.manifest.byCategory[this.activeCategory] ?? [];
    }

    if (this.selectedFolder) {
      entries = entries.filter((entry) => entry.path.startsWith(`${this.selectedFolder}/`));
    }

    return entries;
  }

  get previewUrl(): string | null {
    if (!this.previewAsset) {
      return null;
    }
    return assetStore.resolveUrl(this.previewAsset.tag);
  }

  get hasPreview(): boolean {
    if (!this.previewAsset) {
      return false;
    }
    const previewableExts = new Set([
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.svg',
      '.mp3',
      '.ogg',
      '.wav',
    ]);
    return previewableExts.has(this.previewAsset.ext);
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async fetchManifest(): Promise<void> {
    await assetStore.fetchManifest();
  }

  navigateToFolder(path: string): void {
    this.selectedFolder = path;
  }

  setCategory(category: string): void {
    this.activeCategory = category;
    this.selectedFolder = '';
  }

  openUploadInfo(): void {
    this.uploadInfoOpen = true;
  }

  closeUploadInfo(): void {
    this.uploadInfoOpen = false;
  }

  openAssetPreview(asset: AssetEntry): void {
    this.previewAsset = asset;
    this.previewModalOpen = true;
  }

  closePreview(): void {
    this.previewModalOpen = false;
    this.previewAsset = null;
  }

  // -----------------------------------------------------------------------
  // Context menu
  // -----------------------------------------------------------------------

  openContextMenu(asset: AssetEntry, x: number, y: number): void {
    this.contextMenu = { open: true, x, y, asset };
  }

  closeContextMenu(): void {
    this.contextMenu = { open: false, x: 0, y: 0, asset: null };
  }

  renameAsset(_asset: AssetEntry): void {
    this.closeContextMenu();
    this.debug('renameAsset not implemented');
  }

  deleteAsset(_asset: AssetEntry): void {
    this.closeContextMenu();
    this.debug('deleteAsset not implemented');
  }

  async openAssetsFolder(): Promise<void> {
    // Tauri desktop: open the OS file explorer at the assets folder
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const { resolve } = await import('@tauri-apps/api/path');
      const absolutePath = await resolve('static/game-data');
      await openPath(absolutePath);
      return;
    } catch {
      // Not in Tauri or plugin unavailable — fall through
    }

    // Web fallback: show the path
    alert('Assets folder: apps/frontend/client/static/game-data/');
  }
}

export const getAssetBrowserViewModel = (
  options: AssetBrowserViewModelOptions,
): AssetBrowserViewModelInterface => AssetBrowserViewModel.create(options);
