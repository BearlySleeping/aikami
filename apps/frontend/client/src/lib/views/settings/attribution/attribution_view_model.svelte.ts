// apps/frontend/client/src/lib/views/settings/attribution/attribution_view_model.svelte.ts
//
// Attribution screen — displays per-asset provenance from the active content
// pack. Contract: C-381 AC-1 (attribution surface), Quality Requirements
// (screen-reader accessible, reachable from main menu).
//
// The ViewModel takes its collaborators as typed capabilities. Content-pack
// loading (engine + asset resolvers) and navigation live in
// ./attribution_composition.ts, so this module imports no production graph.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

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

/** Provenance block carried by a manifest asset. */
export type AttributionProvenance = {
  license: string;
  author: readonly string[];
  source: string;
  shareAlike?: boolean;
};

/** Minimal manifest shape needed to build the attribution table. */
export type AttributionPackManifest = {
  name?: string;
  tiles?: Record<string, { name?: string; provenance?: AttributionProvenance }>;
  props?: Record<string, { name?: string; provenance?: AttributionProvenance }>;
  atlas?: { provenance?: AttributionProvenance };
};

/** Flattens pack provenance into display-ready rows. Pure — no side effects. */
export const attributionEntriesFromManifest = (
  manifest: AttributionPackManifest,
): AttributionEntry[] => {
  const entries: AttributionEntry[] = [];
  for (const [tileId, tile] of Object.entries(manifest.tiles ?? {})) {
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
  for (const [propId, prop] of Object.entries(manifest.props ?? {})) {
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
  if (manifest.atlas?.provenance) {
    entries.push({
      assetId: 'atlas',
      license: manifest.atlas.provenance.license,
      authors: manifest.atlas.provenance.author,
      source: manifest.atlas.provenance.source,
      shareAlike: manifest.atlas.provenance.shareAlike,
    });
  }
  return entries;
};

export type AttributionViewModelOptions = BaseViewModelOptions & {
  /** Resolves the active content-pack id, if any. */
  getActiveContentPackId: () => string | undefined;
  /** Loads (and resolves) a content pack by id. */
  loadPack: (packId: string) => Promise<AttributionPackManifest>;
  /** Navigates back to the start menu. */
  goToHref: (href: string) => void;
};

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

  private readonly _getActiveContentPackId: () => string | undefined;
  private readonly _loadPack: (packId: string) => Promise<AttributionPackManifest>;
  private readonly _goToHref: (href: string) => void;

  constructor(options: AttributionViewModelOptions) {
    super(options);
    this._getActiveContentPackId = options.getActiveContentPackId;
    this._loadPack = options.loadPack;
    this._goToHref = options.goToHref;
  }

  async initialize(): Promise<void> {
    try {
      const packId = this._getActiveContentPackId() ?? 'emberwatch';
      const manifest = await this._loadPack(packId);
      this.packName = manifest.name ?? packId;
      this.entries = attributionEntriesFromManifest(manifest);
    } catch (error) {
      this.warn('attribution:load-failed', { error: String(error) });
      this.entries = [];
      this.packName = 'Unknown';
    }

    await super.initialize();
  }

  backToMenu(): void {
    this._goToHref('/start');
  }
}

/**
 * Testable factory — takes capabilities explicitly and imports no production
 * singletons. Production wiring lives in ./attribution_composition.ts.
 */
export const createAttributionViewModel = (
  options: AttributionViewModelOptions,
): AttributionViewModelInterface => AttributionViewModel.create(options);
