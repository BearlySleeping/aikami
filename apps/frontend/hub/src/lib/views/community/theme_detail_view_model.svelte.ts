// apps/frontend/hub/src/lib/views/community/theme_detail_view_model.svelte.ts
//
// One theme version's public detail page (C-530 AC-3 / AC-4).
//
// 🔴 The preview is built from the *compiled* declarations the shared
// compiler produced (`declarations`), scoped to one preview element. There is
// no creator-supplied stylesheet, no user script and no external resource in
// the path — the only thing a package can influence is the value of a `--ui-*`
// custom property inside `[data-theme-preview]`, and those values were
// validated before they were stored.
//
// Hub navigation, auth and moderation chrome keep the Hub's own trusted
// appearance: the scope selector is what guarantees it, and the visual suite's
// `skinnedHubChrome` assertion is what proves it.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ThemeVersionDetail } from '@aikami/types';
import type { ThemeDetailPageData } from '$types';

/** The preview contexts a visitor may switch between. */
export const THEME_PREVIEW_MODES = [
  'default',
  'high-contrast',
  'compact',
  'large-text',
] as const;

/** One preview context. */
export type ThemePreviewMode = (typeof THEME_PREVIEW_MODES)[number];

/** One declared asset row, pre-formatted. */
export type ThemeAssetRow = {
  path: string;
  mediaType: string;
  sizeLabel: string;
  isPreview: boolean;
};

/** One variant fact row, pre-formatted. */
export type ThemeVariantRow = {
  variant: string;
  fontFamilyLabel: string;
  fontWeightLabel: string;
  tokenLabel: string;
};

export type ThemeDetailViewModelOptions = BaseViewModelOptions & {
  data: ThemeDetailPageData;
};

export type ThemeDetailViewModelInterface = BaseViewModelInterface & {
  readonly detail: ThemeVersionDetail;
  readonly isOwner: boolean;
  readonly variant: 'light' | 'dark';
  readonly previewMode: ThemePreviewMode;
  readonly previewModes: readonly ThemePreviewMode[];
  /** The scoped custom-property style the preview element renders with. */
  readonly previewStyle: string;
  readonly variantRows: readonly ThemeVariantRow[];
  readonly assetRows: readonly ThemeAssetRow[];
  readonly apiSupported: boolean;
  readonly revoked: boolean;
  readonly statusLabel: string;
  /** The public, content-addressed package URL a consumer downloads. */
  readonly installHref: string;
  readonly installLabel: string;
  readonly previewModeLabel: string;

  selectVariant(variant: 'light' | 'dark'): void;
  selectPreviewMode(mode: ThemePreviewMode): void;
};

/** Human label for a file size. */
const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Human label for one preview context. */
const previewModeLabel = (mode: ThemePreviewMode): string => {
  switch (mode) {
    case 'high-contrast':
      return 'High contrast';
    case 'compact':
      return 'Compact';
    case 'large-text':
      return '200% text';
    default:
      return 'Default';
  }
};

class ThemeDetailViewModel
  extends BaseViewModel<ThemeDetailViewModelOptions>
  implements ThemeDetailViewModelInterface
{
  private readonly _detail: ThemeVersionDetail;
  private readonly _isOwner: boolean;
  private _variant = $state<'light' | 'dark'>('light');
  private _previewMode = $state<ThemePreviewMode>('default');

  constructor(options: ThemeDetailViewModelOptions) {
    super(options);
    this._detail = options.data.detail;
    this._isOwner = options.data.isOwner;
    // Open on a variant the package actually ships.
    this._variant = this._detail.variants.includes('light') ? 'light' : 'dark';
  }

  get detail() {
    return this._detail;
  }

  get isOwner() {
    return this._isOwner;
  }

  get variant() {
    return this._variant;
  }

  get previewMode() {
    return this._previewMode;
  }

  get previewModes() {
    return THEME_PREVIEW_MODES;
  }

  get previewModeLabel() {
    return previewModeLabel(this._previewMode);
  }

  /**
   * The scoped custom-property declarations for the selected variant.
   *
   * Every value here came out of the shared compiler, which is the only thing
   * allowed to turn a creator value into CSS — so the preview cannot inject a
   * declaration the compiler would have refused.
   */
  get previewStyle(): string {
    return this._detail.declarations
      .filter((declaration) => declaration.variant === this._variant)
      .map((declaration) => `${declaration.cssVariable}: ${declaration.value};`)
      .join(' ');
  }

  get variantRows(): readonly ThemeVariantRow[] {
    return this._detail.variantFacts.map((fact) => ({
      variant: fact.variant,
      fontFamilyLabel: fact.fontFamily.length > 0 ? fact.fontFamily.join(', ') : 'not declared',
      fontWeightLabel:
        fact.fontWeight.length > 0 ? fact.fontWeight.join(', ') : 'not declared',
      tokenLabel: `${fact.tokenCount} token${fact.tokenCount === 1 ? '' : 's'}`,
    }));
  }

  get assetRows(): readonly ThemeAssetRow[] {
    return this._detail.assets.map((asset) => ({
      path: asset.path,
      mediaType: asset.mediaType,
      sizeLabel: formatSize(asset.bytes),
      isPreview: asset.isPreview,
    }));
  }

  get apiSupported() {
    return this._detail.themeApiSupported;
  }

  get revoked() {
    return this._detail.revoked;
  }

  get statusLabel(): string {
    if (this._detail.revoked) {
      return 'Withdrawn from public distribution';
    }
    return this._detail.promoted ? 'Published' : 'Awaiting review';
  }

  get installHref(): string {
    return `/api/assets/themes/${encodeURIComponent(this._detail.themeId)}/public?version=${encodeURIComponent(this._detail.version)}`;
  }

  get installLabel(): string {
    return `${this._detail.themeId}-${this._detail.version}.aikami-theme.zip`;
  }

  selectVariant(variant: 'light' | 'dark'): void {
    this._variant = variant;
  }

  selectPreviewMode(mode: ThemePreviewMode): void {
    this._previewMode = mode;
  }
}

/** Builds the theme detail ViewModel. */
export const getThemeDetailViewModel = (
  options: ThemeDetailViewModelOptions,
): ThemeDetailViewModelInterface => ThemeDetailViewModel.create(options);
