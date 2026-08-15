// apps/frontend/hub/src/lib/views/catalog/catalog_asset_view_model.svelte.ts
//
// Asset detail page view model (C-396 AC-3): preview, license, attribution.
// Seeded from the SSR load; no re-fetch in initialize().
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CatalogAssetEntry } from '@aikami/schemas';
import { routerService } from '$services';
import type { AssetStats, CatalogAssetPageData } from '$types';
import { formatBytes } from '$utils/catalog.ts';

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
