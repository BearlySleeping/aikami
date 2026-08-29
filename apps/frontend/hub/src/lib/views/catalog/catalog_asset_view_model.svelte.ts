// apps/frontend/hub/src/lib/views/catalog/catalog_asset_view_model.svelte.ts
//
// Asset detail page view model (C-396 AC-3): preview, license, attribution.
// Seeded from the SSR load; no re-fetch in initialize().
//
// C-446 additions: previewKind, resolver, lpcCatalog, previewMounted, previewError.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { LpcSlotDef } from '@aikami/frontend-preview';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import type { ComponentType } from 'svelte';
import { routerService } from '$services';
import type { AssetStats, CatalogAssetPageData } from '$types';
import { formatBytes } from '$utils/catalog.ts';
import { type PreviewKind, previewKindForEntry } from './preview_kind.ts';

// ── LPC slot definition — imported from @aikami/frontend-preview ──
// Type-only import is safe for the server bundle (erased at compile time).

export type CatalogAssetViewModelOptions = BaseViewModelOptions & {
  data: CatalogAssetPageData;
};

export type CatalogAssetViewModelInterface = BaseViewModelInterface & {
  readonly category: string;
  readonly categoryLabel: string;
  readonly entry: CatalogAssetEntry;
  readonly previewUrl: string | undefined;
  readonly stats: Promise<AssetStats | null>;
  readonly statsPending: boolean;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Human-readable size, e.g. "4.8 KB". */
  readonly sizeLabel: string;
  /** True when the license is genuinely unknown (empty or "unknown"). */
  readonly isLicenseUnknown: boolean;
  /** Attribution authors, or undefined when genuinely unknown. */
  readonly authors: readonly string[] | undefined;

  // ── C-446 Preview fields ──────────────────────────────────────────────

  /** Which interactive preview to mount, if any. */
  readonly previewKind: PreviewKind;
  /** Built in the browser from entries the server load already fetched. */
  readonly resolver: AssetResolver | undefined;
  /** Scoped LPC slot definitions built from shard entries. */
  readonly lpcSlots: readonly LpcSlotDef[];
  /** True once the preview island has painted; hides the thumbnail. */
  readonly previewMounted: boolean;
  /** Set when the island failed; the thumbnail stays and a notice shows. */
  readonly previewError: string | undefined;
  /** Mark the preview as successfully mounted. */
  setPreviewMounted(): void;
  /** Record a preview mount error. */
  setPreviewError(message: string): void;
  /** Build the CDN resolver lazily (client-side only). */
  ensureResolverBuilt(): Promise<AssetResolver | undefined>;
  /** Ensure the LPC slot definitions are built (lazy, client-side). */
  ensureLpcSlotsBuilt(): Promise<readonly LpcSlotDef[]>;
  /** Preview component instance (dynamically imported, client-only). */
  readonly previewComponent: ComponentType | undefined;
  /** Props passed to the preview component. */
  readonly previewProps: Record<string, unknown>;
  /** Tileset grid overlay toggle state. */
  readonly showTilesetGrid: boolean;
  /** Load the preview: dynamic imports, prop construction, URL state, error handling. */
  /** Load the preview: dynamic imports, prop construction, URL state, error handling. */
  loadPreview(): Promise<void>;
  /** Toggle the tileset grid overlay. */
  toggleTilesetGrid(): void;

  goToCategory(): Promise<void>;
  goToLanding(): Promise<void>;
};

class CatalogAssetViewModel
  extends BaseViewModel<CatalogAssetViewModelOptions>
  implements CatalogAssetViewModelInterface
{
  private readonly _category: string;
  private readonly _categoryLabel: string;
  private readonly _entry: CatalogAssetEntry;
  private readonly _previewUrl: string | undefined;
  private readonly _stats: Promise<AssetStats | null>;
  private _statsSettled = $state(false);

  // ── C-446 Preview fields ──────────────────────────────────────────────
  private readonly _previewKind: PreviewKind;
  private readonly _dataEntries: readonly CatalogAssetEntry[];
  private readonly _dataOriginUrl: string;
  private _resolver = $state<AssetResolver | undefined>(undefined);
  private _resolverBuilt = false;
  private _lpcSlots = $state<readonly LpcSlotDef[]>([]);
  private _lpcSlotsBuilt = false;
  private _previewMounted = $state(false);
  private _previewError = $state<string | undefined>(undefined);
  previewComponent = $state<ComponentType | undefined>(undefined);
  previewProps = $state<Record<string, unknown>>({});
  showTilesetGrid = $state(false);

  /** Toggle the tileset grid overlay and update preview props reactively. */
  toggleTilesetGrid(): void {
    this.showTilesetGrid = !this.showTilesetGrid;
    this.previewProps = { ...this.previewProps, showGrid: this.showTilesetGrid };
  }

  constructor(options: CatalogAssetViewModelOptions) {
    super(options);
    const { data } = options;
    this._category = data.category;
    this._categoryLabel = data.categoryLabel;
    this._entry = data.entry;
    this._previewUrl = data.previewUrl;
    this._stats = data.stats;
    this._stats.then(
      () => {
        this._statsSettled = true;
      },
      () => {
        this._statsSettled = true;
      },
    );

    // C-446: Derive preview kind and store entries for lazy resolver building.
    this._previewKind = previewKindForEntry(data.entry);
    this._dataEntries = data.entries;
    this._dataOriginUrl = data.originUrl;
  }

  get category() {
    return this._category;
  }

  get categoryLabel() {
    return this._categoryLabel;
  }

  get entry() {
    return this._entry;
  }

  get previewUrl() {
    return this._previewUrl;
  }

  get stats() {
    return this._stats;
  }

  get statsPending() {
    return !this._statsSettled;
  }

  get displayName() {
    const { tag } = this._entry;
    const prefix = this._entry.category ? `${this._entry.category}:` : '';
    const sub = this._entry.subcategory ? `${this._entry.subcategory.split('/').join(':')}:` : '';
    let rest = tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
    if (rest.startsWith(sub)) {
      rest = rest.slice(sub.length);
    }
    return rest.split(':').filter(Boolean).join(' · ') || tag;
  }

  get sizeLabel() {
    return formatBytes(this._entry.sizeBytes);
  }

  get isLicenseUnknown() {
    return (
      this._entry.licenses.length === 0 ||
      this._entry.licenses.every((license) => license.trim().toLowerCase() === 'unknown')
    );
  }

  get authors(): readonly string[] | undefined {
    return this._entry.authors.length > 0 ? this._entry.authors : undefined;
  }

  // ── C-446 Preview getters ─────────────────────────────────────────────

  get previewKind(): PreviewKind {
    return this._previewKind;
  }

  get resolver(): AssetResolver | undefined {
    return this._resolver;
  }

  get previewMounted(): boolean {
    return this._previewMounted;
  }

  get previewError(): string | undefined {
    return this._previewError;
  }

  get lpcSlots(): readonly LpcSlotDef[] {
    return this._lpcSlots;
  }

  /** Called by the preview island after successful mount. */
  setPreviewMounted(): void {
    this._previewMounted = true;
  }

  /** Called by the preview island on mount failure. */
  setPreviewError(message: string): void {
    this._previewError = message;
  }

  /**
   * Build the CDN resolver lazily. Called from the preview island's onMount
   * (client-side only) to avoid pulling the resolver module into the server bundle.
   */
  async ensureResolverBuilt(): Promise<AssetResolver | undefined> {
    if (this._resolverBuilt) {
      return this._resolver;
    }
    this._resolverBuilt = true;

    if (this._dataEntries.length === 0 || !this._dataOriginUrl) {
      return undefined;
    }

    try {
      const { createCdnAssetResolver } = await import('$lib/client/services/cdn_asset_resolver.ts');
      this._resolver = createCdnAssetResolver({
        originUrl: this._dataOriginUrl,
        entries: this._dataEntries,
      });
    } catch (error) {
      this.error('ensureResolverBuilt', error);
      this._resolver = undefined;
    }
    return this._resolver;
  }

  /**
   * Build scoped LPC slot definitions from shard entries.
   * Called from the preview island's onMount (client-side only).
   * Groups entries by slot name and creates LpcSlotDef objects.
   */
  async ensureLpcSlotsBuilt(): Promise<readonly LpcSlotDef[]> {
    if (this._lpcSlotsBuilt) {
      return this._lpcSlots;
    }
    this._lpcSlotsBuilt = true;

    if (this._dataEntries.length === 0) {
      return [];
    }

    // Group LPC entries by slot (second segment of the tag)
    const slotMap = new Map<string, Map<string, string>>();

    for (const entry of this._dataEntries) {
      if (entry.category !== 'lpc') {
        continue;
      }

      const parts = entry.tag.split(':');
      if (parts.length < 4) {
        continue;
      }

      const slotName = parts[1] ?? '';
      // Build the complete asset identity path expected by lpcTag() —
      // slot/subcategory/assetId, using the full subcategory path.
      // This prevents assets from different subcategories from colliding.
      const subcategory = parts.slice(2, -1).join('/') ?? '';
      const assetId = parts[3] ?? '';
      const fullAssetPath = subcategory
        ? `${slotName}/${subcategory}/${assetId}`
        : `${slotName}/${assetId}`;

      if (!slotName || !assetId) {
        continue;
      }

      if (!slotMap.has(slotName)) {
        slotMap.set(slotName, new Map());
      }

      const variantMap = slotMap.get(slotName);
      if (variantMap && !variantMap.has(fullAssetPath)) {
        // Use subcategory + assetId as the label for disambiguation
        const label = subcategory ? `${subcategory}:${assetId}` : assetId;
        variantMap.set(
          fullAssetPath,
          label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        );
      }
    }

    // Build LpcSlotDef array, sorted by slot name
    const slots: LpcSlotDef[] = [];
    const sortedSlotNames = [...slotMap.keys()].sort();

    for (const slotName of sortedSlotNames) {
      const variantMap = slotMap.get(slotName);
      if (!variantMap) {
        continue;
      }
      const variants = [...variantMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([assetId, label]) => ({ label, assetId }));

      slots.push({
        slot: slotName,
        label: slotName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        variants,
      });
    }

    this._lpcSlots = slots;
    return slots;
  }
  /**
   * Load the preview: dynamic imports, prop construction, URL state, error handling.
   * Called from the view's onMount (client-side only).
   */
  async loadPreview(): Promise<void> {
    const kind = this._previewKind;
    if (kind === 'none') {
      return;
    }

    try {
      const resolver = await this.ensureResolverBuilt();
      if (!resolver) {
        this.setPreviewError('Preview resolver unavailable.');
        return;
      }

      const tag = this._entry.tag;

      switch (kind) {
        case 'lpc': {
          const mod = await import('@aikami/frontend-preview');
          const { LpcPreview, decodeLpcPreviewState, encodeLpcPreviewState } = mod;
          const initialParams = new URLSearchParams(window.location.search);
          const initialState = decodeLpcPreviewState(initialParams);

          // Build scoped LPC slots from shard entries
          const allSlots = await this.ensureLpcSlotsBuilt();

          this.previewComponent = LpcPreview as ComponentType;
          this.previewProps = {
            resolver,
            allSlots,
            initialState,
            width: 320,
            height: 320,
            zoom: 2,
            controls: true,
            onStateChange: (state: unknown) => {
              const params = encodeLpcPreviewState(
                state as Parameters<typeof encodeLpcPreviewState>[0],
              );
              const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
              window.history.replaceState(null, '', newUrl);
            },
          };
          break;
        }
        case 'tileset': {
          const { TilesetPreview } = await import('@aikami/frontend-preview');
          this.previewComponent = TilesetPreview as ComponentType;
          this.previewProps = {
            resolver,
            tag,
            width: 320,
            height: 320,
            zoom: 1,
            showGrid: this.showTilesetGrid,
          };
          break;
        }
        case 'map': {
          const { MapPreview } = await import('@aikami/frontend-preview');
          this.previewComponent = MapPreview as ComponentType;
          this.previewProps = { resolver, mapTag: tag, width: 320, height: 320, zoom: 1 };
          break;
        }
        case 'prop': {
          const { PropPreview } = await import('@aikami/frontend-preview');
          this.previewComponent = PropPreview as ComponentType;
          this.previewProps = { resolver, tag, width: 320, height: 320, zoom: 2 };
          break;
        }
        case 'pack': {
          // Pack preview not yet implemented — leave thumbnail visible.
          // Full pack contents listing in Phase 3.
          this.previewComponent = undefined;
          this.previewProps = {};
          return;
        }
      }

      this.setPreviewMounted();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPreviewError(`Preview failed to load: ${message}`);
    }
  }

  async goToCategory(): Promise<void> {
    try {
      await routerService.goToRoute('catalogCategory', {
        pathParameters: { category: this._category },
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToCategory', error);
    }
  }

  async goToLanding(): Promise<void> {
    try {
      await routerService.goToRoute('catalog', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToLanding', error);
    }
  }
}

export const getCatalogAssetViewModel = (
  options: CatalogAssetViewModelOptions,
): CatalogAssetViewModelInterface => CatalogAssetViewModel.create(options);
