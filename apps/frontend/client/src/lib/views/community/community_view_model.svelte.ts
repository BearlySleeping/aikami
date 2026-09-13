// apps/frontend/client/src/lib/views/community/community_view_model.svelte.ts
//
// C-513 AC-4 / AC-10 / AC-11: the community browse + import ViewModel.
//
// Lists the hub's approved community assets and imports one into the local
// registry. Importing is the *only* network action here: after an import the
// bytes live in the on-device cache and resolve with no network, exactly like
// a bundled or generated asset.
//
// A tag collision (AC-11) is never resolved silently — the ViewModel holds the
// pending decision until the user accepts a new version or dismisses it.
//
// Contract: C-513

import type { BaseViewModelInterface, BaseViewModelOptions } from '@aikami/frontend/services/base';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { CommunityAssetSummary } from '@aikami/types';
import type { CommunityLibraryEntry } from '$types';

/** Registry categories whose bytes are images the browse surface can paint. */
const IMAGE_CATEGORIES = new Set(['sprites', 'backgrounds', 'portraits', 'props', 'tilesets']);

/** One browse row, pre-formatted (no formatting in the view). */
export type CommunityAssetRow = {
  tag: string;
  title: string;
  category: string;
  provenanceLabel: string;
  licenseLabel: string;
  sizeLabel: string;
};

/**
 * One asset this device already imported (C-513 AC-10).
 *
 * Rendered from the local registry, so it survives a reload with the hub
 * unreachable — and `previewUrl` is a blob URL served from the content-hash
 * cache, never a network fetch.
 */
export type CommunityLibraryRow = {
  tag: string;
  category: string;
  attributionLabel: string;
  licenseLabel: string;
  /** True for registry categories whose bytes are displayable images. */
  isImage: boolean;
  /** Blob URL for an imported image; empty when it cannot be painted. */
  previewUrl: string;
};

/** The browse/import operations the community view consumes. */
export type CommunityCapabilities = {
  /** Opens the local registry + cache (the import path needs both). */
  ready(): Promise<void>;
  /** Approved, promoted community assets — newest first. */
  list(): Promise<{ items: readonly CommunityAssetSummary[]; nextCursor?: string }>;
  /** Downloads, verifies and imports one asset (AC-4/AC-10). */
  import(
    asset: CommunityAssetSummary,
    options?: { collision?: 'version' },
  ): Promise<CommunityImportOutcomeLike>;
  /** Whether the hub is configured for this deployment. */
  hubAvailable(): boolean;
  /** Community assets already imported on this device (registry-only). */
  listLibrary(): Promise<readonly CommunityLibraryEntry[]>;
  /** Resolves an owned tag to a displayable URL — cache-first, offline-safe. */
  resolvePreview(tag: string): Promise<string | null>;
};

/** The import outcome shape the ViewModel renders. */
export type CommunityImportOutcomeLike =
  | { imported: true; tag: string; sha256: string; unchanged: boolean }
  | {
      imported: false;
      tag: string;
      reason: string;
      collision?: { kind: string; existingHash: string };
    };

/** The ViewModel's public surface. */
export type CommunityViewModelInterface = BaseViewModelInterface & {
  readonly assets: readonly CommunityAssetSummary[];
  readonly rows: readonly CommunityAssetRow[];
  readonly isReady: boolean;
  readonly isLoading: boolean;
  readonly isImporting: boolean;
  /** The last outcome, phrased for a human. */
  readonly message: string;
  readonly errorMessage: string;
  /** The tag whose collision awaits an explicit decision, if any. */
  readonly collisionTag: string;
  /** Why the import was refused, when a decision is pending. */
  readonly collisionReason: string;
  /** False when the hub is unreachable — the button is disabled, not broken. */
  readonly canImport: boolean;
  /** Assets this device already imported, newest first (offline-safe). */
  readonly libraryRows: readonly CommunityLibraryRow[];
  readonly hasLibrary: boolean;
  refresh(): Promise<void>;
  /** Reloads the on-device imports; never touches the hub. */
  refreshLibrary(): Promise<void>;
  importAsset(tag: string): Promise<void>;
  /** Accept the collision explicitly: import as a new registry version. */
  acceptCollisionAsVersion(): Promise<void>;
  dismissCollision(): void;
  initialize(): Promise<void>;
};

/** Options for {@link createCommunityViewModel}. */
export type CommunityViewModelOptions = BaseViewModelOptions & {
  capabilities: CommunityCapabilities;
};

/** Human label for a file size. */
const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Human label for the moderation state shown on an owner's own submission. */
const moderationLabel = (state: string): string => {
  if (state === 'approved') {
    return 'Approved';
  }
  if (state === 'rejected') {
    return 'Rejected';
  }
  return 'Pending review';
};

/**
 * The community browse/import ViewModel.
 */
export class CommunityViewModel
  extends BaseViewModel<CommunityViewModelOptions>
  implements CommunityViewModelInterface
{
  private readonly _capabilities: CommunityCapabilities;

  assets = $state<readonly CommunityAssetSummary[]>([]);
  libraryRows = $state<readonly CommunityLibraryRow[]>([]);
  isReady = $state<boolean>(false);
  isLoading = $state<boolean>(false);
  isImporting = $state<boolean>(false);
  message = $state<string>('');
  errorMessage = $state<string>('');
  collisionTag = $state<string>('');
  collisionReason = $state<string>('');

  private _collisionAsset: CommunityAssetSummary | undefined;

  constructor(options: CommunityViewModelOptions) {
    super(options);
    this._capabilities = options.capabilities;
  }

  get rows(): readonly CommunityAssetRow[] {
    return this.assets.map((asset) => ({
      tag: asset.tag,
      title: asset.title,
      category: asset.category,
      provenanceLabel: asset.provenance.source,
      licenseLabel: asset.license ?? 'unlicensed',
      sizeLabel: formatSize(asset.sizeBytes),
    }));
  }

  get canImport(): boolean {
    return this._capabilities.hubAvailable();
  }

  get hasLibrary(): boolean {
    return this.libraryRows.length > 0;
  }

  /**
   * Loads the assets this device already imported (C-513 AC-10).
   *
   * Deliberately independent of {@link refresh}: this must succeed with the hub
   * unreachable, because it is what proves an imported asset survived the
   * reload. Failures are swallowed — the hub path owns `errorMessage`.
   */
  async refreshLibrary(): Promise<void> {
    try {
      await this._capabilities.ready();
      const entries = await this._capabilities.listLibrary();
      const rows: CommunityLibraryRow[] = [];
      for (const entry of entries) {
        const isImage = IMAGE_CATEGORIES.has(entry.category);
        let previewUrl = '';
        if (isImage) {
          try {
            previewUrl = (await this._capabilities.resolvePreview(entry.tag)) ?? '';
          } catch {
            // A preview that cannot be resolved must not drop the row: the
            // asset is on device even when it cannot be painted right now.
            previewUrl = '';
          }
        }
        rows.push({
          tag: entry.tag,
          category: entry.category,
          attributionLabel: entry.attribution ?? 'unknown',
          licenseLabel: entry.license ?? 'no licence declared',
          isImage,
          previewUrl,
        });
      }
      this.libraryRows = rows;
    } catch {
      // Secondary surface — the browse list already reports hub failures.
    }
  }

  async initialize(): Promise<void> {
    await super.initialize();
    // Library first: it is the offline-capable half, so a reload with the hub
    // unreachable still paints what was imported (AC-10).
    await this.refreshLibrary();
    await this.refresh();
    this.isReady = true;
  }

  async refresh(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      await this._capabilities.ready();
      const page = await this._capabilities.list();
      this.assets = page.items;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isLoading = false;
    }
  }

  async importAsset(tag: string): Promise<void> {
    const asset = this.assets.find((candidate) => candidate.tag === tag);
    if (!asset) {
      this.errorMessage = `No community asset "${tag}" is loaded.`;
      return;
    }
    this.isImporting = true;
    this.message = '';
    this.errorMessage = '';
    this.dismissCollision();
    try {
      const outcome = await this._capabilities.import(asset);
      if (outcome.imported) {
        this.message = outcome.unchanged
          ? `"${outcome.tag}" is already in your library.`
          : `Imported "${outcome.tag}" into your library.`;
        // The library section is this page's offline half — keep it in step
        // with the registry the import just wrote (AC-10).
        await this.refreshLibrary();
        return;
      }
      // AC-11: never silently replace a curated or local asset.
      this.collisionTag = outcome.tag;
      this.collisionReason = collisionExplanation(outcome.reason, outcome.collision?.kind);
      this._collisionAsset = asset;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isImporting = false;
    }
  }

  async acceptCollisionAsVersion(): Promise<void> {
    const asset = this._collisionAsset ?? this.assets.find((a) => a.tag === this.collisionTag);
    if (!asset) {
      this.dismissCollision();
      return;
    }
    this.isImporting = true;
    try {
      const outcome = await this._capabilities.import(asset, { collision: 'version' });
      if (outcome.imported) {
        this.message = `Imported "${outcome.tag}" as a new version.`;
        this.dismissCollision();
        await this.refreshLibrary();
      } else {
        this.collisionReason = collisionExplanation(outcome.reason, outcome.collision?.kind);
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isImporting = false;
    }
  }

  dismissCollision(): void {
    this.collisionTag = '';
    this.collisionReason = '';
    this._collisionAsset = undefined;
  }
}

/** Phrases a refused import for the user. */
const collisionExplanation = (reason: string, kind: string | undefined): string => {
  if (kind === 'seed') {
    return 'That tag belongs to the curated catalog, so it can never be replaced by an import. Publish under a different tag instead.';
  }
  if (kind === 'local-generated') {
    return 'You already have a locally generated asset with that tag. Import as a new version to keep both, or rename your local asset.';
  }
  if (kind === 'community-import') {
    return 'A different revision of that tag is already imported. Import as a new version to replace it.';
  }
  if (reason === 'not_promoted') {
    return 'That asset has not been approved yet, so its bytes are not public.';
  }
  if (reason === 'hash_mismatch' || reason === 'size_mismatch') {
    return 'The downloaded bytes do not match the advertised hash — the import was refused.';
  }
  return `Import refused (${reason}).`;
};

/** Finalization label for an owner's own submission (kept for the owning view). */
export { moderationLabel };

/** Builds the community ViewModel. */
export const createCommunityViewModel = (
  options: CommunityViewModelOptions,
): CommunityViewModelInterface => CommunityViewModel.create(options);
