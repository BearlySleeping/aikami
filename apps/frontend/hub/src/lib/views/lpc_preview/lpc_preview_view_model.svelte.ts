// apps/frontend/hub/src/lib/views/lpc_preview/lpc_preview_view_model.svelte.ts
//
// Hub LPC preview view model. Builds the CDN resolver and slot catalog from
// the LPC entries the server load fetched, derives the requested component's
// initial state, and lazily mounts the engine-backed `LpcPreview` component.
//
// The preview component itself (PixiJS) is imported dynamically so it never
// enters the Worker server bundle (mirrors the catalog preview island).

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { LpcPreviewState, LpcSlotDef } from '@aikami/frontend-preview';
import { buildLpcCatalog } from '@aikami/lpc';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { ComponentType } from 'svelte';
import { routerService } from '$services';
import type { LpcPreviewPageData } from '$types';
import { buildLpcPreviewState, lpcAssetIdFromTag } from './lpc_preview_state.ts';

export type HubLpcPreviewViewModelOptions = BaseViewModelOptions & {
  data: LpcPreviewPageData;
};

export type HubLpcPreviewViewModelInterface = BaseViewModelInterface & {
  /** Human-readable name of the loaded component, or undefined on the index. */
  readonly assetLabel: string | undefined;
  /** True when a specific catalog component was requested. */
  readonly hasAsset: boolean;
  /** True once the preview mounted or failed — the view shows a spinner until then. */
  readonly ready: boolean;
  /** Explicit failure text — never a blank canvas. */
  readonly previewError: string | undefined;
  /** Dynamically imported preview component (client-only). */
  readonly previewComponent: ComponentType | undefined;
  /** Props passed to the preview component. */
  readonly previewProps: Record<string, unknown>;
  /** Navigate back to the LPC catalog category. */
  goToCatalog(): Promise<void>;
};

/** Derive a readable label from an LPC catalog tag. */
const labelFromTag = (tag: string): string => {
  const parts = tag.split(':');
  if (parts.length < 3) {
    return tag;
  }
  return parts
    .slice(1, parts.length - 1)
    .map((segment) => segment.replace(/_/g, ' '))
    .join(' · ');
};

class HubLpcPreviewViewModel
  extends BaseViewModel<HubLpcPreviewViewModelOptions>
  implements HubLpcPreviewViewModelInterface
{
  private readonly _entry: CatalogAssetEntry | undefined;
  private readonly _dataEntries: readonly CatalogAssetEntry[];
  private readonly _dataOriginUrl: string;
  private _ready = $state(false);
  private _error = $state<string | undefined>(undefined);
  previewComponent = $state<ComponentType | undefined>(undefined);
  previewProps = $state<Record<string, unknown>>({});

  constructor(options: HubLpcPreviewViewModelOptions) {
    super(options);
    this._entry = options.data.entry;
    this._dataEntries = options.data.lpcEntries;
    this._dataOriginUrl = options.data.originUrl;
  }

  get assetLabel(): string | undefined {
    const tag = this._entry?.tag;
    return tag ? labelFromTag(tag) : undefined;
  }

  get hasAsset(): boolean {
    return this._entry !== undefined;
  }

  get ready(): boolean {
    return this._ready;
  }

  get previewError(): string | undefined {
    return this._error;
  }

  override async initialize(): Promise<void> {
    await this._loadPreview();
    return await super.initialize();
  }

  async goToCatalog(): Promise<void> {
    try {
      await routerService.goToRoute('catalogCategory', {
        pathParameters: { category: 'lpc' },
        queryParameters: undefined,
      });
    } catch (error) {
      this.error('goToCatalog', error);
    }
  }

  /**
   * Build the resolver + slot catalog and mount the preview component with
   * the requested asset applied. Failures degrade to an explicit message.
   */
  private async _loadPreview(): Promise<void> {
    try {
      // Build the resolver lazily so the PixiJS-bearing module is only pulled
      // in on the client, after hydration.
      const { createCdnAssetResolver } = await import('$lib/client/services/cdn_asset_resolver.ts');
      if (this._dataEntries.length === 0 || !this._dataOriginUrl) {
        this._error = 'The LPC catalog is empty or unavailable.';
        return;
      }
      const resolver = createCdnAssetResolver({
        originUrl: this._dataOriginUrl,
        entries: this._dataEntries,
      });

      const catalog = buildLpcCatalog({
        entries: this._dataEntries.filter((entry) => entry.category === 'lpc'),
      });
      const allSlots: LpcSlotDef[] = catalog.slots.map((slot) => ({
        slot: slot.slot,
        label: slot.label,
        variants: slot.variants.map((variant) => ({
          assetId: variant.assetId,
          label: variant.label,
        })),
      }));

      if (allSlots.length === 0) {
        this._error = 'No LPC components were found in the catalog.';
        return;
      }

      const targetAssetId = this._entry ? lpcAssetIdFromTag(this._entry.tag) : undefined;
      const initialState: LpcPreviewState = buildLpcPreviewState({
        allSlots,
        ...(targetAssetId ? { targetAssetId } : {}),
      });

      const { LpcPreview } = await import('@aikami/frontend-preview');
      this.previewComponent = LpcPreview as unknown as ComponentType; // guard-ignore lint/type-safety/casting: dynamic component type resolution from the preview package
      this.previewProps = {
        resolver,
        allSlots,
        initialState,
        controls: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._error = `Could not load the LPC preview: ${message}`;
    } finally {
      this._ready = true;
    }
  }
}

export const getHubLpcPreviewViewModel = (
  options: HubLpcPreviewViewModelOptions,
): HubLpcPreviewViewModelInterface => HubLpcPreviewViewModel.create(options);
