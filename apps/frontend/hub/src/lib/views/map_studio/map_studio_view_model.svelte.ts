// apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts
//
// Map studio ViewModel for the hub.
//
// Owns the manifest text, the CDN resolver, and the preview ViewModel. The
// preview renders through the SAME unified scene loader the game uses
// (loadSceneSync → sceneFromTilemap / sceneFromNative), so anything the
// studio accepts is something the game accepts.
//
// No network call is a boot dependency: the studio opens with the embedded
// sample manifest already rendering.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { MapPreviewViewModelInterface } from '@aikami/frontend-preview';
import type { AssetResolver } from '@aikami/types';
import { createCdnAssetResolver } from '$lib/client/services/cdn_asset_resolver.ts';
import type { MapStudioPageData } from '$types';
import { SAMPLE_MANIFEST_TEXT } from './sample_manifest.ts';

// ── Types ────────────────────────────────────────────────────────────────

/** A published map offered as an editable starting point. */
export type PublishedMapOption = {
  /** Catalog tag, e.g. `maps:sandbox_combat`. */
  readonly tag: string;
  /** Human-readable label for the picker. */
  readonly label: string;
};

export type HubMapStudioViewModelOptions = BaseViewModelOptions & {
  data: MapStudioPageData;
};

export type HubMapStudioViewModelInterface = BaseViewModelInterface & {
  /**
   * The preview canvas, bound by the View with `bind:this`. The ViewModel
   * reacts to it internally (see `initialize`), so the View stays logicless —
   * no `$effect` and no `onMount`, per the MVVM conventions.
   */
  canvasElement: HTMLCanvasElement | undefined;
  /** Current manifest text (always defined — starts as the sample). */
  readonly manifestText: string;
  /** Scene-load failure reported by the preview, if any. */
  readonly previewError: string | undefined;
  /** Studio-level failure (resolver, fetch, file read). */
  readonly studioError: string | undefined;
  /** True once the preview canvas has mounted and initialized. */
  readonly previewReady: boolean;
  /** Published maps available as starting points. */
  readonly publishedMaps: readonly PublishedMapOption[];
  /** Tag currently being fetched, if any. */
  readonly loadingMapTag: string | undefined;

  /** Replace the manifest text (re-renders through the live preview). */
  setManifestText(text: string): void;
  /** Restore the embedded sample manifest. */
  resetToSample(): void;
  /** Load a manifest from a local file. */
  loadManifestFile(file: File): Promise<void>;
  /** Fetch a published map from the catalog and load it as text. */
  loadPublishedMap(tag: string): Promise<void>;
  /** Format the current manifest as pretty JSON (no-op when invalid). */
  formatManifest(): void;
};

// ── Helpers ──────────────────────────────────────────────────────────────

/** Turn a catalog tag into a short label: `maps:sandbox_combat` → `sandbox combat`. */
const tagToLabel = (tag: string): string => {
  const tail = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
  return tail.replace(/[_-]+/g, ' ');
};

// ── ViewModel ────────────────────────────────────────────────────────────

export class HubMapStudioViewModel
  extends BaseViewModel<HubMapStudioViewModelOptions>
  implements HubMapStudioViewModelInterface
{
  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  manifestText = $state<string>(SAMPLE_MANIFEST_TEXT);
  studioError = $state<string | undefined>(undefined);
  previewReady = $state(false);
  loadingMapTag = $state<string | undefined>(undefined);

  /** Preview VM handle — created on canvas attach, never in the server bundle. */
  private _preview = $state<MapPreviewViewModelInterface | undefined>(undefined);
  private _resolver: AssetResolver | undefined;
  private _resolverBuilt = false;
  /** Monotonic token identifying the newest published-map load. */
  private _loadRequestId = 0;

  private readonly _data: MapStudioPageData;

  constructor(options: HubMapStudioViewModelOptions) {
    super(options);
    this._data = options.data;
  }

  get previewError(): string | undefined {
    return this._preview?.errorMessage;
  }

  get publishedMaps(): readonly PublishedMapOption[] {
    return this._data.mapEntries
      .map((entry) => ({ tag: entry.tag, label: tagToLabel(entry.tag) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      // Manifest edits flow into the live preview without a teardown.
      $effect(() => {
        this._preview?.setManifestText(this.manifestText);
      });
      // The View binds the canvas with `bind:this`; mounting happens here so
      // the View itself stays logicless.
      $effect(() => {
        const canvas = this.canvasElement;
        if (canvas) {
          void this._mountPreview(canvas);
        }
      });
    });
    return await super.initialize();
  }

  override async dispose(): Promise<void> {
    await this._preview?.dispose();
    this._preview = undefined;
    this.previewReady = false;
    return await super.dispose();
  }

  // ── Actions ──────────────────────────────────────────────────────

  setManifestText(text: string): void {
    // Supersede any in-flight published-map load: this edit is newer.
    this._loadRequestId++;
    this.manifestText = text;
    this.studioError = undefined;
  }

  resetToSample(): void {
    this.setManifestText(SAMPLE_MANIFEST_TEXT);
  }

  formatManifest(): void {
    try {
      const parsed: unknown = JSON.parse(this.manifestText);
      this.setManifestText(JSON.stringify(parsed, undefined, 2));
    } catch {
      // Invalid JSON — leave the text untouched so the preview error stands.
    }
  }

  async loadManifestFile(file: File): Promise<void> {
    try {
      this.setManifestText(await file.text());
    } catch (error) {
      this.error('loadManifestFile', error);
      this.studioError = `Could not read "${file.name}".`;
    }
  }

  async loadPublishedMap(tag: string): Promise<void> {
    this.loadingMapTag = tag;
    // Token identifying THIS request. A fetch that resolves after the user has
    // edited, reset, or picked a different map must not overwrite that newer
    // state, so every write below is gated on the token still being current.
    const requestId = ++this._loadRequestId;
    const isCurrent = (): boolean => this._loadRequestId === requestId;

    try {
      const resolver = await this._ensureResolver();
      if (!isCurrent()) {
        return;
      }
      if (!resolver) {
        this.studioError = 'Catalog is unavailable — cannot load published maps.';
        return;
      }
      const url = resolver.resolve(tag);
      if (!url) {
        this.studioError = `Cannot resolve map "${tag}" in the catalog.`;
        return;
      }
      try {
        const response = await fetch(url);
        if (!isCurrent()) {
          return;
        }
        if (!response.ok) {
          this.studioError = `Failed to fetch "${tag}" (HTTP ${response.status}).`;
          return;
        }
        const text = await response.text();
        if (!isCurrent()) {
          return;
        }
        this.setManifestText(text);
      } finally {
        resolver.release(url);
      }
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      this.error('loadPublishedMap', error);
      this.studioError = `Failed to load "${tag}".`;
    } finally {
      // Only the current request may clear the spinner — an older one
      // finishing late would hide a newer request's progress.
      if (isCurrent()) {
        this.loadingMapTag = undefined;
      }
    }
  }

  /**
   * Mounts the preview against the View-bound canvas.
   *
   * Idempotent: the reaction re-runs whenever `canvasElement` changes, and
   * the preview ViewModel is created once and merely re-bound afterwards.
   *
   * `@aikami/frontend-preview` is imported dynamically because it re-exports
   * the PixiJS engine — a static import would pull PixiJS into the hub's
   * Cloudflare Worker server bundle, which `server_bundle_purity.test.ts`
   * forbids.
   */
  private async _mountPreview(canvas: HTMLCanvasElement): Promise<void> {
    try {
      const resolver = await this._ensureResolver();
      if (!resolver) {
        this.studioError = 'Catalog is unavailable — assets cannot be resolved.';
        return;
      }

      if (!this._preview) {
        const { getMapPreviewViewModel } = await import('@aikami/frontend-preview');
        this._preview = getMapPreviewViewModel({
          className: 'HubMapStudioPreview',
          resolver,
          mapTag: 'studio:manifest',
          sceneId: 'studio',
          assetLock: 'pack:emberwatch',
          manifestText: this.manifestText,
          width: canvas.width,
          height: canvas.height,
        });
        await this._preview.initialize();
      }

      this._preview.setCanvasElement(canvas);
      this.previewReady = true;
    } catch (error) {
      this.error('mountPreview', error);
      this.studioError = 'Could not mount the preview.';
    }
  }

  /** Build the CDN resolver lazily (client-side only). */
  private async _ensureResolver(): Promise<AssetResolver | undefined> {
    if (this._resolverBuilt) {
      return this._resolver;
    }

    const entries = [...this._data.tilesetEntries, ...this._data.mapEntries];
    if (entries.length === 0 || !this._data.originUrl) {
      return undefined;
    }

    try {
      this._resolver = createCdnAssetResolver({
        originUrl: this._data.originUrl,
        entries,
        // Manifests reference tileset images by game-data path, not tag.
        resolveGameDataPaths: true,
      });
      // Only latch once construction succeeded: a transient failure must stay
      // retryable, otherwise one bad attempt disables the resolver for the
      // lifetime of the page.
      this._resolverBuilt = true;
    } catch (error) {
      this.error('ensureResolverBuilt', error);
      this._resolver = undefined;
      this._resolverBuilt = false;
    }
    return this._resolver;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Get or create the map studio ViewModel for this page.
 *
 * @param options - Page data plus the standard BaseViewModel options.
 * @returns The shared ViewModel instance.
 */
export const getHubMapStudioViewModel = (
  options: HubMapStudioViewModelOptions,
): HubMapStudioViewModelInterface => HubMapStudioViewModel.create(options);
