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
import type { CatalogAssetEntry } from '@aikami/schemas';
import { routerService } from '$services';
import type { CatalogCategorySummary, CatalogLandingPageData } from '$types';

/** One `<option>` in the landing's Walk Sandbox launcher. */
export type SandboxMapOption = {
  /** Catalog tag used as the sandbox path parameter (e.g. `maps:village`). */
  readonly tag: string;
  /** Human-readable label derived from the tag. */
  readonly label: string;
};

/** Derive a readable label from a map catalog tag (`maps:a:b` → `a · b`). */
const sandboxMapLabel = (entry: CatalogAssetEntry): string => {
  const prefix = 'maps:';
  const rest = entry.tag.startsWith(prefix) ? entry.tag.slice(prefix.length) : entry.tag;
  return rest.split(':').filter(Boolean).join(' · ') || entry.tag;
};

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
  /** Published maps available to walk in the sandbox launcher. */
  readonly sandboxMapOptions: readonly SandboxMapOption[];
  /** Selected map tag in the sandbox launcher. */
  readonly selectedSandboxTag: string;
  setSearchQuery(query: string): void;
  setSelectedSandboxTag(tag: string): void;
  goToCategory(categoryId: string): Promise<void>;
  /** Open the visual Map Studio. */
  goToMapStudio(): Promise<void>;
  /** Open the walk sandbox for the selected map, when one is chosen. */
  goToSandbox(): Promise<void>;
  /** Open the LPC character compositor. */
  goToLpcPreview(): Promise<void>;
  retry(): void;
};

class CatalogLandingViewModel
  extends BaseViewModel<CatalogLandingViewModelOptions>
  implements CatalogLandingViewModelInterface
{
  private _categories = $state<readonly CatalogCategorySummary[]>([]);
  private _publishedAt = $state<string | undefined>(undefined);
  private _mapEntries = $state<readonly CatalogAssetEntry[]>([]);
  // Using inherited errorMessage from BaseViewModel instead of a private field
  searchQuery = $state('');
  selectedSandboxTag = $state('');

  constructor(options: CatalogLandingViewModelOptions) {
    super(options);
    const { data } = options;
    if (data.status === 'ready') {
      this._categories = data.categories;
      this._publishedAt = data.publishedAt;
      this._mapEntries = data.mapEntries;
      this.selectedSandboxTag = data.mapEntries[0]?.tag ?? '';
    } else {
      this.errorMessage = data.message;
    }
  }

  get categories() {
    return this._categories;
  }

  get publishedAt() {
    return this._publishedAt;
  }

  get hasError() {
    return this.errorMessage !== undefined;
  }

  // errorMessage is inherited from BaseViewModel

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

  get sandboxMapOptions(): readonly SandboxMapOption[] {
    return this._mapEntries.map((entry) => ({
      tag: entry.tag,
      label: sandboxMapLabel(entry),
    }));
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  setSelectedSandboxTag(tag: string): void {
    this.selectedSandboxTag = tag;
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

  async goToMapStudio(): Promise<void> {
    try {
      await routerService.goToRoute('mapStudio', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToMapStudio', error);
    }
  }

  async goToSandbox(): Promise<void> {
    const { selectedSandboxTag } = this;
    if (!selectedSandboxTag) {
      return;
    }
    try {
      await routerService.goToRoute('sandbox', {
        pathParameters: { mapTag: selectedSandboxTag },
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToSandbox', error);
    }
  }

  async goToLpcPreview(): Promise<void> {
    try {
      await routerService.goToRoute('lpcPreview', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToLpcPreview', error);
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
