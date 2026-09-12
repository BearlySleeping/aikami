// apps/frontend/client/src/lib/views/world/world_view_model.svelte.ts
/** biome-ignore-all lint/style/useNamingConvention: snake_case keys mirror persisted domain values (information kinds, faction ids) */
//
// World ViewModel — the Codex section for knowledge and affiliations
// (docs/design/game_ui_hud_overhaul.md §6):
//
//   People    — NPCs the player has actually interacted with, from the
//               relationship record (trust/affinity), never an omniscient cast.
//   Places    — locations the world state knows about.
//   Factions  — standings only; membership/rank is deliberately out of scope
//               until the domain models it, so this is reputation, not a guild sheet.
//   Lore      — committed narrative events (witnessed/discovered), each carrying
//               its information kind and witness count as provenance.
//   Gallery   — the shared media collection, opened from anywhere.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./world_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

/** The World Codex tabs. */
export type WorldTab = 'people' | 'places' | 'factions' | 'lore' | 'gallery';

/** The kind of knowledge a row represents. */
export type WorldEntryKind = 'person' | 'place' | 'faction' | 'lore' | 'gallery';

/**
 * One normalized row in the World Codex. Keeping a single display shape lets
 * the view render every tab identically while `kind` drives small differences.
 */
export type WorldEntry = {
  id: string;
  kind: WorldEntryKind;
  name: string;
  detail: string;
  /** Where this knowledge came from — shown, but visually secondary. */
  provenance: string;
  /** Optional numeric score (faction standing, trust) for a compact meter. */
  score?: number;
  /** Optional media URL for gallery rows. */
  url?: string;
};

// ── Capability contracts ────────────────────────────────────────────────

/** The relationship snapshot the People and Factions tabs project. */
export type WorldRelationshipSnapshot = {
  readonly factionStandings: Record<string, { readonly standing: number; readonly tier: string }>;
  readonly characterRelationships: Record<
    string,
    {
      readonly trust: number;
      readonly affinity: number;
      readonly relationshipType: string;
    }
  >;
};

export type WorldRelationshipCapabilities = {
  serialize(): WorldRelationshipSnapshot;
};

/** A committed narrative event, projected as discovered lore. */
export type WorldLoreEvent = {
  readonly id: string;
  readonly summary: string;
  readonly informationKind: string;
  readonly kind: string;
  readonly recordedAt: string;
  readonly witnesses: readonly string[];
};

export type WorldLoreCapabilities = {
  readonly events: readonly WorldLoreEvent[];
};

/** A location known to the world state. */
export type WorldPlace = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly lastVisited?: string;
};

export type WorldPlaceCapabilities = {
  readonly locations: readonly WorldPlace[];
};

/** A shared gallery media reference. */
export type WorldGalleryImage = {
  readonly id: string;
  readonly url: string;
  readonly prompt: string;
  readonly imageType: string;
  readonly generatedAt: string;
  readonly chatId: string;
};

export type WorldGalleryCapabilities = {
  readonly images: readonly WorldGalleryImage[];
};

/** Overlay navigation invoked when the World section closes. */
export type WorldOverlayCapabilities = {
  closeWorld(): void;
};

export type WorldViewModelOptions = BaseViewModelOptions & {
  relationships: WorldRelationshipCapabilities;
  lore: WorldLoreCapabilities;
  places: WorldPlaceCapabilities;
  gallery: WorldGalleryCapabilities;
  overlays: WorldOverlayCapabilities;
};

export type WorldViewModelInterface = BaseViewModelInterface & {
  readonly activeTab: WorldTab;
  setActiveTab(tab: WorldTab): void;

  // Local full-text search across the visible entries.
  readonly searchQuery: string;
  readonly hasSearchQuery: boolean;
  setSearchQuery(query: string): void;

  // Per-tab projections (unfiltered — used for tab counts).
  readonly people: readonly WorldEntry[];
  readonly places: readonly WorldEntry[];
  readonly factions: readonly WorldEntry[];
  readonly lore: readonly WorldEntry[];
  readonly gallery: readonly WorldEntry[];

  // Active-tab view.
  readonly visibleEntries: readonly WorldEntry[];
  readonly activeTabEmpty: boolean;
  readonly activeTabCount: number;

  close(): void;
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
};

// ── Labels ──────────────────────────────────────────────────────────────

const TIER_LABELS: Record<string, string> = {
  hostile: 'Hostile',
  unfriendly: 'Unfriendly',
  neutral: 'Neutral',
  friendly: 'Friendly',
  honored: 'Honored',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  ally: 'Ally',
  enemy: 'Enemy',
  friend: 'Friend',
  romantic: 'Romantic',
  neutral: 'Neutral',
  rival: 'Rival',
};

const INFORMATION_LABELS: Record<string, string> = {
  world_fact: 'World fact',
  character_belief: 'Belief',
  dialogue_claim: 'Claim',
};

/** Title-cases an id like `iron_guard` into `Iron Guard`. */
const humanizeId = (id: string): string =>
  id.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

// ── Implementation ──────────────────────────────────────────────────────

class WorldViewModel
  extends BaseViewModel<WorldViewModelOptions>
  implements WorldViewModelInterface
{
  private readonly _relationships: WorldRelationshipCapabilities;
  private readonly _lore: WorldLoreCapabilities;
  private readonly _places: WorldPlaceCapabilities;
  private readonly _gallery: WorldGalleryCapabilities;
  private readonly _overlays: WorldOverlayCapabilities;

  activeTab = $state<WorldTab>('people');
  searchQuery = $state('');

  constructor(options: WorldViewModelOptions) {
    super(options);
    this._relationships = options.relationships;
    this._lore = options.lore;
    this._places = options.places;
    this._gallery = options.gallery;
    this._overlays = options.overlays;
  }

  setActiveTab(tab: WorldTab): void {
    this.activeTab = tab;
  }

  get hasSearchQuery(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  // ── Projections ───────────────────────────────────────────────────

  get people(): readonly WorldEntry[] {
    const state = this._relationships.serialize();
    return Object.entries(state.characterRelationships)
      .map(([id, relationship]) => ({
        id,
        kind: 'person' as const,
        name: humanizeId(id),
        detail: `Trust ${relationship.trust} · Affinity ${relationship.affinity}`,
        provenance:
          RELATIONSHIP_LABELS[relationship.relationshipType] ?? relationship.relationshipType,
        score: relationship.trust,
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  get factions(): readonly WorldEntry[] {
    const state = this._relationships.serialize();
    return Object.entries(state.factionStandings)
      .map(([id, standing]) => ({
        id,
        kind: 'faction' as const,
        name: humanizeId(id),
        detail: `Standing ${standing.standing}`,
        provenance: TIER_LABELS[standing.tier] ?? standing.tier,
        score: standing.standing,
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  get places(): readonly WorldEntry[] {
    return this._places.locations
      .map((location) => ({
        id: location.id,
        kind: 'place' as const,
        name: location.name,
        detail: location.description,
        provenance: location.lastVisited
          ? `Last visited ${formatDate(location.lastVisited)}`
          : 'Known location',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get lore(): readonly WorldEntry[] {
    return [...this._lore.events]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .map((event) => ({
        id: event.id,
        kind: 'lore' as const,
        name: event.summary,
        detail: event.kind,
        provenance: `${INFORMATION_LABELS[event.informationKind] ?? event.informationKind} · ${event.witnesses.length} witness${event.witnesses.length === 1 ? '' : 'es'} · ${formatDate(event.recordedAt)}`,
      }));
  }

  get gallery(): readonly WorldEntry[] {
    return [...this._gallery.images]
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .map((image) => ({
        id: image.id,
        kind: 'gallery' as const,
        name: image.prompt,
        detail: image.imageType,
        provenance: formatDate(image.generatedAt),
        url: image.url,
      }));
  }

  // ── Active tab ────────────────────────────────────────────────────

  get activeTabCount(): number {
    return this._entriesForTab(this.activeTab).length;
  }

  get activeTabEmpty(): boolean {
    return this.activeTabCount === 0;
  }

  get visibleEntries(): readonly WorldEntry[] {
    const query = this.searchQuery.trim().toLowerCase();
    const entries = this._entriesForTab(this.activeTab);
    if (query.length === 0) {
      return entries;
    }
    return entries.filter((entry) =>
      [entry.name, entry.detail, entry.provenance].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }

  private _entriesForTab(tab: WorldTab): readonly WorldEntry[] {
    switch (tab) {
      case 'people':
        return this.people;
      case 'places':
        return this.places;
      case 'factions':
        return this.factions;
      case 'lore':
        return this.lore;
      case 'gallery':
        return this.gallery;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  close(): void {
    this._overlays.closeWorld();
  }

  /** Closes the World overlay when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }
}

/**
 * Testable factory — builds the World ViewModel from typed capabilities with no
 * production imports. Production wiring lives in ./world_composition.ts.
 */
export const createWorldViewModel = (options: WorldViewModelOptions): WorldViewModelInterface =>
  WorldViewModel.create(options);
