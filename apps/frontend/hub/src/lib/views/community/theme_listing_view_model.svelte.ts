// apps/frontend/hub/src/lib/views/community/theme_listing_view_model.svelte.ts
//
// The public theme listing page (C-530 AC-3).
//
// Nothing here can surface an unreviewed version. The page data carries only
// the rows the shared listing query already filtered to approved + promoted +
// non-revoked (`listThemeVersions`), and this view model never re-queries — it
// formats what the load handed it.
//
// 🔴 `degraded` is not an empty list. "This deployment cannot serve themes" and
// "nobody has published a theme yet" are different messages, and only one of
// them is the visitor's problem — so they are different states here.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ThemeVersionSummary } from '@aikami/types';
import type { ThemeListingPageData } from '$types';

/** How many rows render initially / per "Show more" step. */
export const THEME_GRID_PAGE_SIZE = 24;

/** One listing row, pre-formatted — the view renders text, it never formats. */
export type ThemeBrowseRow = {
  themeId: string;
  version: string;
  name: string;
  authorDisplayName: string;
  license: string;
  /** `light + dark`, or just the variants the package actually ships. */
  variantsLabel: string;
  sizeLabel: string;
  /** `theme API >=1.0 <2.0` plus the server's support verdict. */
  apiLabel: string;
  apiSupported: boolean;
  statusLabel: string;
  detailHref: string;
};

export type ThemeListingViewModelOptions = BaseViewModelOptions & {
  data: ThemeListingPageData;
};

export type ThemeListingViewModelInterface = BaseViewModelInterface & {
  readonly degraded: boolean;
  readonly rows: readonly ThemeBrowseRow[];
  readonly visibleRows: readonly ThemeBrowseRow[];
  readonly isEmpty: boolean;
  readonly hasMore: boolean;
  readonly nextPageHref: string | undefined;

  showMore(): void;
};

/** Human label for a file size. */
const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The shipped variants, in a stable order. */
const variantsLabel = (variants: readonly string[]): string => {
  if (variants.length === 0) {
    return 'no variant declared';
  }
  const ordered = ['light', 'dark'].filter((variant) => variants.includes(variant));
  return ordered.length > 0 ? ordered.join(' + ') : variants.join(' + ');
};

/** The moderation state, in visitor-facing words. */
const statusLabel = (theme: ThemeVersionSummary): string => {
  if (theme.revoked) {
    return 'withdrawn from public distribution';
  }
  switch (theme.moderationState) {
    case 'approved':
      return theme.promoted ? 'published' : 'approved, not yet published';
    case 'rejected':
      return 'rejected';
    default:
      return 'awaiting review';
  }
};

/** Projects one listing row into the display shape the view renders. */
const toBrowseRow = (theme: ThemeVersionSummary): ThemeBrowseRow => ({
  themeId: theme.themeId,
  version: theme.version,
  name: theme.name,
  authorDisplayName: theme.authorDisplayName,
  license: theme.license,
  variantsLabel: variantsLabel(theme.variants),
  sizeLabel: formatSize(theme.packageBytes),
  apiLabel: `theme API ${theme.themeApiRange}`,
  apiSupported: theme.themeApiSupported,
  statusLabel: statusLabel(theme),
  detailHref: `/community/themes/${encodeURIComponent(theme.themeId)}?version=${encodeURIComponent(theme.version)}`,
});

class ThemeListingViewModel
  extends BaseViewModel<ThemeListingViewModelOptions>
  implements ThemeListingViewModelInterface
{
  private readonly _themes: readonly ThemeVersionSummary[];
  private readonly _nextCursor: string | undefined;
  private readonly _degraded: boolean;
  private _visibleCount = $state(THEME_GRID_PAGE_SIZE);

  constructor(options: ThemeListingViewModelOptions) {
    super(options);
    this._themes = options.data.themes;
    this._nextCursor = options.data.nextCursor;
    this._degraded = options.data.degraded;
  }

  get degraded() {
    return this._degraded;
  }

  get rows(): readonly ThemeBrowseRow[] {
    return this._themes.map((theme) => toBrowseRow(theme));
  }

  get visibleRows(): readonly ThemeBrowseRow[] {
    return this.rows.slice(0, this._visibleCount);
  }

  get isEmpty() {
    return this._themes.length === 0;
  }

  get hasMore() {
    return this.visibleRows.length < this._themes.length;
  }

  get nextPageHref(): string | undefined {
    if (this._nextCursor === undefined) {
      return undefined;
    }
    return `/community/themes?cursor=${encodeURIComponent(this._nextCursor)}`;
  }

  showMore(): void {
    this._visibleCount += THEME_GRID_PAGE_SIZE;
  }
}

/** Builds the theme listing ViewModel. */
export const getThemeListingViewModel = (
  options: ThemeListingViewModelOptions,
): ThemeListingViewModelInterface => ThemeListingViewModel.create(options);
