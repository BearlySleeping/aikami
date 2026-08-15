// apps/frontend/hub/src/lib/views/catalog/catalog_landing_view_model.svelte.ts
//
// Catalog landing view model (C-396 AC-1): category summaries seeded from
// the SSR load. Data is seeded once in the constructor and NEVER re-fetched
// in initialize() (C-396 Design Reference #2 — the load owns the data; a
// refresh would go through SvelteKit's invalidate(), not a second fetch).
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { routerService } from '$services';
import type { CatalogCategorySummary, CatalogLandingPageData } from '$types';

export type CatalogLandingViewModelOptions = BaseViewModelOptions & {
  data: CatalogLandingPageData;
};

export type CatalogLandingViewModelInterface = BaseViewModelInterface & {
  readonly categories: readonly CatalogCategorySummary[];
  readonly publishedAt: string | undefined;
  readonly hasError: boolean;
  readonly errorMessage: string | undefined;
  /** Live search query that filters the category cards. */
  readonly searchQuery: string;
  /** Categories filtered by the landing search box. */
  readonly visibleCategories: readonly CatalogCategorySummary[];
  setSearchQuery(query: string): void;
  goToCategory(categoryId: string): Promise<void>;
  retry(): void;
};

class CatalogLandingViewModel
  extends BaseViewModel<CatalogLandingViewModelOptions>
  implements CatalogLandingViewModelInterface
{
  private _categories = $state<readonly CatalogCategorySummary[]>([]);
  private _publishedAt = $state<string | undefined>(undefined);
  private _errorMessage = $state<string | undefined>(undefined);
  searchQuery = $state('');

  constructor(options: CatalogLandingViewModelOptions) {
    super(options);
    const { data } = options;
    if (data.status === 'ready') {
      this._categories = data.categories;
      this._publishedAt = data.publishedAt;
    } else {
      this._errorMessage = data.message;
    }
  }

  get categories() {
    return this._categories;
  }

  get publishedAt() {
    return this._publishedAt;
  }

  get hasError() {
    return this._errorMessage !== undefined;
  }

  get errorMessage() {
    return this._errorMessage;
  }

  get visibleCategories() {
    const needle = this.searchQuery.trim().toLowerCase();
    if (!needle) {
      return this._categories;
    }
    return this._categories.filter(
      (category) =>
        category.label.toLowerCase().includes(needle) || category.id.toLowerCase().includes(needle),
    );
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  async goToCategory(categoryId: string): Promise<void> {
    try {
      await routerService.goToRoute('catalogCategory', {
        pathParameters: { category: categoryId },
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToCategory', error);
    }
  }

  retry(): void {
    // The index is fetched by the SSR load — a retry re-runs the load.
    window.location.reload();
  }
}

export const getCatalogLandingViewModel = (
  options: CatalogLandingViewModelOptions,
): CatalogLandingViewModelInterface => CatalogLandingViewModel.create(options);
