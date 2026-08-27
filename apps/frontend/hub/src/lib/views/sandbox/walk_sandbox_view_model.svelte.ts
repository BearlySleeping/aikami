// apps/frontend/hub/src/lib/views/sandbox/walk_sandbox_view_model.svelte.ts
//
// Walk sandbox ViewModel for the hub (C-447).
// Orchestrates WalkSandbox mounting, CDN resolver, debug overlays,
// player cell tracking, spawn parameter parsing, and repro-link generation.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CatalogAssetEntry } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import type { SandboxPageData } from '$types';
import type { OverlayRenderer, OverlayType } from './sandbox_overlays.ts';
import {
  createCollisionOverlay,
  createRenderOrderOverlay,
  createSpawnsOverlay,
  createTransitionsOverlay,
  createZBandsOverlay,
} from './sandbox_overlays.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type DebugOverlays = {
  /** Tint cells that isCellBlocked reports as blocked. */
  readonly collision: boolean;
  /** Colour entities by their WORLD_Z_BANDS band. */
  readonly zBands: boolean;
  /** Label each sprite with its computeEntityZIndex value. */
  readonly renderOrder: boolean;
  /** Draw transition-zone rectangles from extractTransitionZones. */
  readonly transitions: boolean;
  /** Draw spawn points from extractSpawnPoints. */
  readonly spawns: boolean;
};

export type HubWalkSandboxViewModelOptions = BaseViewModelOptions & {
  data: SandboxPageData;
};

export type HubWalkSandboxViewModelInterface = BaseViewModelInterface & {
  readonly ready: boolean;
  /** Explicit, human-readable failure — never an empty canvas. */
  readonly error: string | undefined;
  readonly overlays: DebugOverlays;
  /** Live player cell, shown in the HUD for bug reports. */
  readonly playerCell: { readonly x: number; readonly y: number } | undefined;
  /** Whether the player's current cell is walkable per the engine. */
  readonly playerCellWalkable: boolean | undefined;
  /** Whether the spawn was clamped (out of bounds). */
  readonly spawnClamped: boolean;
  /** The map tag being displayed. */
  readonly mapTag: string;
  /** The resolver for the sandbox. */
  readonly resolver: AssetResolver | undefined;
  /** True once the sandbox has mounted. */
  readonly sandboxMounted: boolean;
  /** The spawn coordinates parsed from the URL, if any. */
  readonly spawnCoords: { readonly x: number; readonly y: number } | undefined;

  toggleOverlay(key: keyof DebugOverlays): void;
  /** Copy a ?spawn= link reproducing the current position. */
  copyReproLink(): Promise<void>;
  /** Mark the sandbox as mounted. */
  setSandboxMounted(): void;
  /** Record a sandbox mount error. */
  setSandboxError(message: string): void;
  /** Update the player cell from the engine. */
  updatePlayerCell(x: number, y: number, walkable: boolean): void;
  /** Build the CDN resolver lazily (client-side only). */
  ensureResolverBuilt(): Promise<AssetResolver | undefined>;
  /** Create overlay renderers for the given parent element. */
  createOverlays(parent: HTMLElement, width: number, height: number): void;
  /** Toggle an overlay on/off. */
  toggleOverlay(key: OverlayType): void;
};

// ── Constants ─────────────────────────────────────────────────────────────

const OVERLAY_STORAGE_KEY = 'hub:sandbox:overlays';

const DEFAULT_OVERLAYS: DebugOverlays = {
  collision: false,
  zBands: false,
  renderOrder: false,
  transitions: false,
  spawns: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** Parse spawn coordinates from URL search params. */
const parseSpawnCoords = (searchParams: URLSearchParams): { x: number; y: number } | undefined => {
  const spawn = searchParams.get('spawn');
  if (!spawn) {
    return undefined;
  }
  const parts = spawn.split(',');
  if (parts.length < 2) {
    return undefined;
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return undefined;
  }
  return { x, y };
};

/** Load overlay state from localStorage with silent degradation. */
const loadOverlayState = (): DebugOverlays => {
  try {
    const stored = localStorage.getItem(OVERLAY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DebugOverlays>;
      return { ...DEFAULT_OVERLAYS, ...parsed };
    }
  } catch {
    // localStorage unavailable (private window, blocked site data) — use defaults
  }
  return { ...DEFAULT_OVERLAYS };
};

/** Save overlay state to localStorage with silent degradation. */
const saveOverlayState = (overlays: DebugOverlays): void => {
  try {
    localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(overlays));
  } catch {
    // localStorage unavailable — silently degrade
  }
};

// ── ViewModel ─────────────────────────────────────────────────────────────

class HubWalkSandboxViewModel
  extends BaseViewModel<HubWalkSandboxViewModelOptions>
  implements HubWalkSandboxViewModelInterface
{
  private readonly _entry: CatalogAssetEntry;
  private readonly _tilesetEntries: readonly CatalogAssetEntry[];
  private readonly _dataOriginUrl: string;
  private readonly _mapTag: string;
  private readonly _spawnCoords: { readonly x: number; readonly y: number } | undefined;

  private _resolver = $state<AssetResolver | undefined>(undefined);
  private _resolverBuilt = false;
  private _ready = $state(false);
  private _error = $state<string | undefined>(undefined);
  private _sandboxMounted = $state(false);
  private _playerCell = $state<{ x: number; y: number } | undefined>(undefined);
  private _playerCellWalkable = $state<boolean | undefined>(undefined);
  private _spawnClamped = $state(false);
  private _overlays = $state<DebugOverlays>(loadOverlayState());
  private _overlayRenderers = new Map<string, OverlayRenderer>();

  constructor(options: HubWalkSandboxViewModelOptions) {
    super(options);
    const { data } = options;
    this._entry = data.entry;
    this._tilesetEntries = data.tilesetEntries;
    this._dataOriginUrl = data.originUrl;
    this._mapTag = data.entry.tag;

    // Parse spawn coordinates from URL
    if (typeof window !== 'undefined') {
      this._spawnCoords = parseSpawnCoords(new URLSearchParams(window.location.search));
    } else {
      this._spawnCoords = undefined;
    }
  }

  // ── Getters ────────────────────────────────────────────────────────────

  get ready(): boolean {
    return this._ready;
  }

  get error(): string | undefined {
    return this._error;
  }

  get overlays(): DebugOverlays {
    return this._overlays;
  }

  get playerCell(): { readonly x: number; readonly y: number } | undefined {
    return this._playerCell;
  }

  get playerCellWalkable(): boolean | undefined {
    return this._playerCellWalkable;
  }

  get spawnClamped(): boolean {
    return this._spawnClamped;
  }

  get mapTag(): string {
    return this._mapTag;
  }

  get resolver(): AssetResolver | undefined {
    return this._resolver;
  }

  get sandboxMounted(): boolean {
    return this._sandboxMounted;
  }

  get spawnCoords(): { readonly x: number; readonly y: number } | undefined {
    return this._spawnCoords;
  }

  // ── Public methods ─────────────────────────────────────────────────────

  toggleOverlay(key: keyof DebugOverlays): void {
    this._overlays = { ...this._overlays, [key]: !this._overlays[key] };
    saveOverlayState(this._overlays);
    const renderer = this._overlayRenderers.get(key);
    if (renderer) {
      renderer.setEnabled(this._overlays[key]);
    }
  }

  async copyReproLink(): Promise<void> {
    const cell = this._playerCell;
    if (!cell) {
      return;
    }
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const reproUrl = `${baseUrl}?spawn=${cell.x},${cell.y}`;
    try {
      await navigator.clipboard.writeText(reproUrl);
      this.debug('copyReproLink:copied', { url: reproUrl });
    } catch (error) {
      this.error('copyReproLink:failed', error);
    }
  }

  setSandboxMounted(): void {
    this._sandboxMounted = true;
    this._ready = true;
  }

  setSandboxError(message: string): void {
    this._error = message;
    this._ready = true; // Mark as ready so the view renders the error state
  }

  updatePlayerCell(x: number, y: number, walkable: boolean): void {
    this._playerCell = { x, y };
    this._playerCellWalkable = walkable;
  }

  createOverlays(parent: HTMLElement, width: number, height: number): void {
    // Create all overlay renderers
    const overlayTypes: OverlayType[] = [
      'collision',
      'zBands',
      'renderOrder',
      'transitions',
      'spawns',
    ];
    for (const type of overlayTypes) {
      try {
        const renderer = this._createOverlay(type, { parent, width, height });
        this._overlayRenderers.set(type, renderer);
        // Apply current state
        renderer.setEnabled(this._overlays[type]);
      } catch (error) {
        this.error('createOverlay:failed', { type, error });
      }
    }
  }

  private _createOverlay(
    type: OverlayType,
    options: { parent: HTMLElement; width: number; height: number },
  ): OverlayRenderer {
    // Dynamic import to avoid pulling PixiJS into the server bundle
    // The overlay renderers use plain Canvas2D, not PixiJS
    switch (type) {
      case 'collision': {
        const resolver = this._resolver;
        if (!resolver) {
          throw new Error('Resolver not available for collision overlay');
        }
        return createCollisionOverlay({
          ...options,
          resolver,
          mapTag: this._mapTag,
        });
      }
      case 'zBands':
        return createZBandsOverlay(options);
      case 'renderOrder':
        return createRenderOrderOverlay(options);
      case 'transitions':
        return createTransitionsOverlay(options);
      case 'spawns':
        return createSpawnsOverlay(options);
    }
  }

  async ensureResolverBuilt(): Promise<AssetResolver | undefined> {
    if (this._resolverBuilt) {
      return this._resolver;
    }
    this._resolverBuilt = true;

    // Build the full entries list: map entry + tileset entries
    const allEntries = [this._entry, ...this._tilesetEntries];
    if (allEntries.length === 0 || !this._dataOriginUrl) {
      return undefined;
    }

    try {
      const { createCdnAssetResolver } = await import('$lib/client/services/cdn_asset_resolver.ts');
      this._resolver = createCdnAssetResolver({
        originUrl: this._dataOriginUrl,
        entries: allEntries,
      });
    } catch (error) {
      this.error('ensureResolverBuilt', error);
      this._resolver = undefined;
    }
    return this._resolver;
  }
}

export const getWalkSandboxViewModel = (
  options: HubWalkSandboxViewModelOptions,
): HubWalkSandboxViewModelInterface => HubWalkSandboxViewModel.create(options);
