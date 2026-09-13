// apps/frontend/hub/src/lib/views/community/community_category_view_model.svelte.ts
//
// One category's public community-asset browse page (C-513 AC-4): seeded from
// the SSR load, owns the client-side visible window.
//
// Nothing here can surface an unreviewed submission. The page data carries only
// the rows the shared listing query already filtered to approved + promoted
// (`listCommunityAssets`), and this view model never re-queries — it formats
// what the load handed it. That is why the HTML test can assert on `rows`:
// the view renders `visibleRows` and has no other data source.
//
// No re-fetch in initialize() (mirrors C-396's catalog category page): the load
// owns the data.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CommunityAssetSummary } from '@aikami/types';
import { routerService } from '$services';
import type { CommunityCategoryPageData } from '$types';

/** How many rows render initially / per "Show more" step. */
export const COMMUNITY_GRID_PAGE_SIZE = 48;

/** One browse row, pre-formatted — the view renders text, it never formats. */
export type CommunityAssetBrowseRow = {
  slug: string;
  tag: string;
  title: string;
  category: string;
  revisionLabel: string;
  /** Attribution names, or the provenance source when no author is named. */
  attribution: string;
  /** SPDX identifier, or an explicit label when none was declared. */
  license: string;
  sizeLabel: string;
  /** The public content-addressed URL the bytes resolve from. */
  sourceUrl: string;
};

export type CommunityCategoryViewModelOptions = BaseViewModelOptions & {
  data: CommunityCategoryPageData;
};

export type CommunityCategoryViewModelInterface = BaseViewModelInterface & {
  readonly category: string;
  readonly categoryLabel: string;
  readonly totalCount: number;
  readonly rows: readonly CommunityAssetBrowseRow[];
  readonly visibleRows: readonly CommunityAssetBrowseRow[];
  readonly hasAssets: boolean;
  readonly hasMore: boolean;
  /** Href for the next server page, or undefined on the last page. */
  readonly nextPageHref: string | undefined;

  showMore(): void;
  goToCommunityIndex(): Promise<void>;
  goToCatalog(): Promise<void>;
};

/** Human label for a file size. */
const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Attribution text: the named authors, else the provenance source verbatim. */
const attributionLabel = (asset: CommunityAssetSummary): string => {
  const authors = asset.provenance.author;
  if (authors !== undefined && authors.length > 0) {
    return authors.join(', ');
  }
  return asset.provenance.source;
};

/** Projects one listing row into the display shape the view renders. */
const toBrowseRow = (asset: CommunityAssetSummary): CommunityAssetBrowseRow => ({
  slug: asset.slug,
  tag: asset.tag,
  title: asset.title,
  category: asset.category,
  revisionLabel: `rev ${asset.revision}`,
  attribution: attributionLabel(asset),
  license: asset.license ?? 'no licence declared',
  sizeLabel: formatSize(asset.sizeBytes),
  sourceUrl: asset.deliveryUrl ?? '',
});

class CommunityCategoryViewModel
  extends BaseViewModel<CommunityCategoryViewModelOptions>
  implements CommunityCategoryViewModelInterface
{
  private readonly _category: string;
  private readonly _categoryLabel: string;
  private readonly _assets: readonly CommunityAssetSummary[];
  private readonly _nextCursor: string | undefined;
  private _visibleCount = $state(COMMUNITY_GRID_PAGE_SIZE);

  constructor(options: CommunityCategoryViewModelOptions) {
    super(options);
    const { data } = options;
    this._category = data.category;
    this._categoryLabel = data.categoryLabel;
    this._assets = data.assets;
    this._nextCursor = data.nextCursor;
  }

  get category() {
    return this._category;
  }

  get categoryLabel() {
    return this._categoryLabel;
  }

  get totalCount() {
    return this._assets.length;
  }

  get hasAssets() {
    return this._assets.length > 0;
  }

  get rows(): readonly CommunityAssetBrowseRow[] {
    return this._assets.map((asset) => toBrowseRow(asset));
  }

  get visibleRows(): readonly CommunityAssetBrowseRow[] {
    return this.rows.slice(0, this._visibleCount);
  }

  get hasMore() {
    return this.visibleRows.length < this._assets.length;
  }

  get nextPageHref(): string | undefined {
    if (this._nextCursor === undefined) {
      return undefined;
    }
    const category = encodeURIComponent(this._category);
    return `/community/${category}?cursor=${encodeURIComponent(this._nextCursor)}`;
  }

  showMore(): void {
    this._visibleCount += COMMUNITY_GRID_PAGE_SIZE;
  }

  /**
   * The community landing is the catalog landing today — there is no
   * `/community` index page, so the breadcrumb points at the catalog root
   * rather than inventing a route that would 404.
   */
  async goToCommunityIndex(): Promise<void> {
    await this.goToCatalog();
  }

  async goToCatalog(): Promise<void> {
    try {
      await routerService.goToRoute('catalog', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToCatalog', error);
    }
  }
}

/** Builds the community category ViewModel. */
export const getCommunityCategoryViewModel = (
  options: CommunityCategoryViewModelOptions,
): CommunityCategoryViewModelInterface => CommunityCategoryViewModel.create(options);
