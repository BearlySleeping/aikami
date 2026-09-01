// apps/frontend/client/src/lib/views/settings/attribution/attribution_view_model.svelte.ts
//
// Attribution screen — displays per-asset provenance from the active content
// pack. Contract: C-381 AC-1 (attribution surface), Quality Requirements
// (screen-reader accessible, reachable from main menu).

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  routerService,
} from '@aikami/frontend/services';
import { campaignService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionEntry = {
  /** Asset name or tile/prop id. */
  assetId: string;
  /** SPDX licence identifier. */
  license: string;
  /** Attribution author(s). */
  authors: readonly string[];
  /** Source description (URL, 'generated:<provider>', 'original'). */
  source: string;
  /** Whether the licence is share-alike. */
  shareAlike?: boolean;
};

export type AttributionViewModelOptions = BaseViewModelOptions;

export type AttributionViewModelInterface = BaseViewModelInterface & {
  readonly entries: readonly AttributionEntry[];
  readonly packName: string;
  readonly backToMenu: () => void;
};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class AttributionViewModel
  extends BaseViewModel<AttributionViewModelOptions>
  implements AttributionViewModelInterface
{
  entries = $state<readonly AttributionEntry[]>([]);
  packName = $state<string>('');

  async initialize(): Promise<void> {
    // Load provenance from the active content pack
    try {
      const campaign = campaignService.activeCampaign;
      const packId = campaign?.contentPackId ?? 'emberwatch';

      const { loadContentPack } = await import('@aikami/frontend/engine');
      const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
      const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');

      const pack = await loadContentPack({
        packId,
        resolveTag: assetTagResolver,
        releaseUrl: (url: string) => assetManager.releaseUrl(url),
      });

      this.packName = pack.manifest.name ?? packId;

      const entries: AttributionEntry[] = [];

      // Collect provenance from tiles
      if (pack.manifest.tiles) {
        for (const [tileId, tile] of Object.entries(pack.manifest.tiles)) {
          if (tile.provenance) {
            entries.push({
              assetId: `tile:${tile.name ?? tileId}`,
              license: tile.provenance.license,
              authors: tile.provenance.author,
              source: tile.provenance.source,
              shareAlike: tile.provenance.shareAlike,
            });
          }
        }
      }

      // Collect provenance from props
      if (pack.manifest.props) {
        for (const [propId, prop] of Object.entries(pack.manifest.props)) {
          if (prop.provenance) {
            entries.push({
              assetId: `prop:${prop.name ?? propId}`,
              license: prop.provenance.license,
              authors: prop.provenance.author,
              source: prop.provenance.source,
              shareAlike: prop.provenance.shareAlike,
            });
          }
        }
      }

      // Collect provenance from atlas
      if (pack.manifest.atlas?.provenance) {
        entries.push({
          assetId: 'atlas',
          license: pack.manifest.atlas.provenance.license,
          authors: pack.manifest.atlas.provenance.author,
          source: pack.manifest.atlas.provenance.source,
          shareAlike: pack.manifest.atlas.provenance.shareAlike,
        });
      }

      this.entries = entries;
    } catch (error) {
      this.warn('attribution:load-failed', { error: String(error) });
      this.entries = [];
      this.packName = 'Unknown';
    }

    await super.initialize();
  }

  backToMenu(): void {
    routerService.goToHref('/start');
  }
}

/** Creates the attribution ViewModel that loads pack provenance and returns to the start menu. */
export const getAttributionViewModel = (
  options: AttributionViewModelOptions,
): AttributionViewModelInterface => AttributionViewModel.create(options);
