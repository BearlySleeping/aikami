// apps/frontend/hub/src/lib/views/catalog/category_view_model.svelte.ts
//
// One category's browse page view model (C-396 AC-2/AC-4): seeded from the
// SSR load, owns client-side filter/search WITHIN the loaded shard and the
// visible window (server-side search/pagination across the whole catalog is
// explicitly out of scope).
//
// No re-fetch in initialize() (Design Reference #2): the load owns the data.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CatalogAssetEntry } from '@aikami/schemas';
import { routerService } from '$services';
import type { CatalogCategoryPageData, CategoryStats } from '$types';
import { matchesCatalogQuery } from '$utils/catalog.ts';

/** How many tiles render initially / per "Show more" step. */
export const CATALOG_GRID_PAGE_SIZE = 48;

export type CategoryViewModelOptions = BaseViewModelOptions & {
  data: CatalogCategoryPageData;
};

export type CategoryViewModelInterface = BaseViewModelInterface & {
  readonly category: string;
  readonly categoryLabel: string;
  readonly totalCount: number;
  readonly originUrl: string;
  /** Streamed stats promise — null when the stats endpoint is unavailable. */
  readonly stats: Promise<CategoryStats | null>;
  readonly searchQuery: string;
  readonly subcategoryFilter: string | undefined;
  /** Distinct subcategories present in the loaded shard. */
  readonly subcategories: readonly string[];
  /** Entries after applying the search query + subcategory filter. */
  readonly filteredEntries: readonly CatalogAssetEntry[];
  /** The visible slice of filteredEntries. */
  readonly visibleEntries: readonly CatalogAssetEntry[];
  readonly hasActiveFilters: boolean;
  readonly hasMore: boolean;
  readonly filterResultCount: number;
  /** True while the streamed stats promise is pending (ARIA busy). */
  readonly statsPending: boolean;

  setSearchQuery(query: string): void;
  setSubcategoryFilter(subcategory: string | undefined): void;
  resetFilters(): void;
  showMore(): void;
  goToAsset(entry: CatalogAssetEntry): Promise<void>;
  goToLanding(): Promise<void>;
};

class CategoryViewModel
  extends BaseViewModel<CategoryViewModelOptions>
  implements CategoryViewModelInterface
{
  private readonly _category: string;
  private readonly _categoryLabel: string;
  private readonly _entries: readonly CatalogAssetEntry[];
  private readonly _originUrl: string;
  private readonly _stats: Promise<CategoryStats | null>;
  private _searchQuery = $state('');
  private _subcategoryFilter = $state<string | undefined>(undefined);
  private _visibleCount = $state(CATALOG_GRID_PAGE_SIZE);
  private _statsSettled = $state(false);

  constructor(options: CategoryViewModelOptions) {
    super(options);
    const { data } = options;
    this._category = data.category;
    this._categoryLabel = data.categoryLabel;
    this._entries = data.entries;
    this._originUrl = data.originUrl;
    this._stats = data.stats;
    // Track settlement so the view can stop marking the stats region
    // aria-busy once the stream resolves (AC-4 accessibility).
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

  get totalCount() {
    return this._entries.length;
  }

  get originUrl() {
    return this._originUrl;
  }

  get stats() {
    return this._stats;
  }

  get searchQuery() {
    return this._searchQuery;
  }

  get subcategoryFilter() {
    return this._subcategoryFilter;
  }

  get statsPending() {
    return !this._statsSettled;
  }

  get subcategories(): readonly string[] {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const entry of this._entries) {
      const sub = entry.subcategory;
      if (!sub) {
        continue;
      }
      if (!seen.has(sub)) {
        seen.add(sub);
        list.push(sub);
      }
    }
    return list.sort((a, b) => a.localeCompare(b));
  }

  get filteredEntries(): readonly CatalogAssetEntry[] {
    const needle = this._searchQuery.trim().toLowerCase();
    const subcategory = this._subcategoryFilter;
    if (!needle && !subcategory) {
      return this._entries;
    }
    return this._entries.filter((entry) => {
      if (subcategory && entry.subcategory !== subcategory) {
        return false;
      }
      return matchesCatalogQuery(entry, needle);
    });
  }

  get filterResultCount() {
    return this.filteredEntries.length;
  }

  get visibleEntries() {
    return this.filteredEntries.slice(0, this._visibleCount);
  }

  get hasMore() {
    return this.visibleEntries.length < this.filteredEntries.length;
  }

  get hasActiveFilters() {
    return this._searchQuery.trim().length > 0 || this._subcategoryFilter !== undefined;
  }

  setSearchQuery(query: string): void {
    this._searchQuery = query;
  }

  setSubcategoryFilter(subcategory: string | undefined): void {
    this._subcategoryFilter = subcategory;
  }

  resetFilters(): void {
    this._searchQuery = '';
    this._subcategoryFilter = undefined;
  }

  showMore(): void {
    this._visibleCount += CATALOG_GRID_PAGE_SIZE;
  }

  async goToAsset(entry: CatalogAssetEntry): Promise<void> {
    try {
      await routerService.goToRoute('catalogAsset', {
        pathParameters: { category: entry.category, tag: entry.tag },
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToAsset', error);
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

export const getCategoryViewModel = (
  options: CategoryViewModelOptions,
): CategoryViewModelInterface => CategoryViewModel.create(options);
