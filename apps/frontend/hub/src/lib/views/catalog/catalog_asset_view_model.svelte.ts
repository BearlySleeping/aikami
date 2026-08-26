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
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import { routerService } from '$services';
import type { AssetStats, CatalogAssetPageData } from '$types';
import { formatBytes } from '$utils/catalog.ts';
import { type PreviewKind, previewKindForEntry } from './preview_kind.ts';

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
  /** True once the preview island has painted; hides the thumbnail. */
  readonly previewMounted: boolean;
  /** Set when the island failed; the thumbnail stays and a notice shows. */
  readonly previewError: string | undefined;
  /** Mark the preview as successfully mounted. */
  setPreviewMounted(): void;
  /** Record a preview mount error. */
  setPreviewError(message: string): void;

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
  private _resolver: AssetResolver | undefined = undefined;
  private _resolverBuilt = false;
  private _previewMounted = $state(false);
  private _previewError = $state<string | undefined>(undefined);

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
