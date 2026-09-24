// apps/frontend/client/src/lib/views/game/ui/management_sections.ts
//
// C-527 — Coherent management navigation.
//
// Single code-owned registry for the five canonical management sections and the
// legacy `GameOverlayType` entry points that deep-open into them. Everything in
// this module is inert data plus pure lookups: the section host, the HUD menu
// entry and the overlay router all read the same table, so there is exactly one
// place that knows how a section maps onto a destination.
//
// The five sections replace the seven nav destinations of the previous strip
// WITHOUT deleting the domain features behind them (`GameOverlayType` stays the
// overlay router's vocabulary — see the legacy mapping table).

import type { GameOverlayType } from '$types';

/** The five canonical management sections. */
export type ManagementSectionId = 'character' | 'inventory' | 'journal' | 'party' | 'world';

/**
 * A location inside the management host.
 *
 * `subview` is validated against the owning section's own allowlist (see
 * {@link normalizeManagementLocation}) — an unknown value falls back to the
 * section default instead of throwing, so a stale shortcut can never break the
 * host.
 */
export type ManagementLocation = {
  section: ManagementSectionId;
  subview?: string;
  entityId?: string;
};

/** Registry entry for one canonical section. */
export type ManagementSectionDefinition = {
  id: ManagementSectionId;
  label: string;
  /** Overlay pushed when the section is opened at its default subview. */
  overlay: GameOverlayType;
  /** Subview ids this section itself allows, empty when the section has no subviews. */
  subviews: readonly string[];
  /** Subview used when none (or an unknown one) is requested; undefined for tab-less sections. */
  defaultSubview?: string;
  /**
   * Non-default subviews that route to their own legacy overlay destination,
   * so `QUEST_LOG` / `REPUTATION` stay reachable as deep-open entry points
   * without widening {@link ManagementSectionId} back to seven values.
   */
  subviewOverlays?: Readonly<Record<string, GameOverlayType>>;
};

/** The canonical sections, in navigation order. */
export const MANAGEMENT_SECTIONS: readonly ManagementSectionDefinition[] = [
  {
    id: 'character',
    label: 'Character',
    overlay: 'CHARACTER_DASHBOARD',
    subviews: [],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    overlay: 'INVENTORY',
    subviews: [],
  },
  {
    id: 'journal',
    label: 'Journal',
    // Quests are authoritative and lead the Journal. The legacy JOURNAL and
    // QUEST_LOG entry points therefore converge on the same host subview.
    overlay: 'JOURNAL',
    subviews: ['quests', 'notes', 'recaps'],
    defaultSubview: 'quests',
    subviewOverlays: { quests: 'QUEST_LOG' },
  },
  {
    id: 'party',
    label: 'Party',
    overlay: 'PARTY_ROSTER',
    subviews: [],
  },
  {
    id: 'world',
    label: 'World',
    // Codex is the default World surface; reputation keeps its own overlay.
    overlay: 'WORLD',
    subviews: ['codex', 'reputation'],
    defaultSubview: 'codex',
    subviewOverlays: { reputation: 'REPUTATION' },
  },
];

const SECTION_BY_ID: ReadonlyMap<ManagementSectionId, ManagementSectionDefinition> = new Map(
  MANAGEMENT_SECTIONS.map((section) => [section.id, section]),
);

/**
 * Reverse of {@link MANAGEMENT_SECTIONS}: which overlay destination belongs to
 * which canonical location. Built from the registry so the two directions can
 * never drift apart.
 */
export const MANAGEMENT_OVERLAY_LOCATIONS: Readonly<Record<string, ManagementLocation>> =
  Object.freeze(
    MANAGEMENT_SECTIONS.reduce<Record<string, ManagementLocation>>((acc, section) => {
      if (section.defaultSubview === undefined) {
        acc[section.overlay] = { section: section.id };
      } else {
        acc[section.overlay] = { section: section.id, subview: section.defaultSubview };
      }
      for (const [subview, overlay] of Object.entries(section.subviewOverlays ?? {})) {
        acc[overlay] = { section: section.id, subview };
      }
      return acc;
    }, {}),
  );

/** Every overlay destination the management host can display. */
export const MANAGEMENT_OVERLAY_TYPES: ReadonlySet<GameOverlayType> = new Set(
  Object.keys(MANAGEMENT_OVERLAY_LOCATIONS) as GameOverlayType[],
);

/** Type guard for the canonical section ids. */
export const isManagementSectionId = (value: unknown): value is ManagementSectionId =>
  typeof value === 'string' && SECTION_BY_ID.has(value as ManagementSectionId);

/** Type guard for an overlay the management host owns. */
export const isManagementOverlay = (overlay: GameOverlayType): boolean =>
  MANAGEMENT_OVERLAY_TYPES.has(overlay);

/** The registry entry for a section id, or undefined for an unknown id. */
export const getManagementSection = (
  section: ManagementSectionId,
): ManagementSectionDefinition | undefined => SECTION_BY_ID.get(section);

/** The section label, falling back to the raw id for an unknown section. */
export const managementSectionLabel = (section: ManagementSectionId): string =>
  SECTION_BY_ID.get(section)?.label ?? section;

/** The overlay destination a canonical location routes to. */
export const managementOverlayFor = (location: ManagementLocation): GameOverlayType | undefined => {
  const section = SECTION_BY_ID.get(location.section);
  if (!section) {
    return undefined;
  }
  // Journal quests are owned by the canonical Journal host. The retired
  // QUEST_LOG destination remains a valid input alias, not a second panel.
  if (section.id === 'journal' && location.subview === 'quests') {
    return section.overlay;
  }
  return section.subviewOverlays?.[location.subview ?? ''] ?? section.overlay;
};

/**
 * Validates a requested location against the owning section's own allowlist.
 *
 * - an unknown section id is rejected (`undefined`)
 * - an unknown subview falls back to the section's default subview
 * - a subview on a section that declares none is dropped
 *
 * Never throws: a stale shortcut or a persisted location must degrade to a
 * legal location instead of taking the host down.
 */
export const normalizeManagementLocation = (
  location: ManagementLocation,
): ManagementLocation | undefined => {
  const section = SECTION_BY_ID.get(location.section);
  if (!section) {
    return undefined;
  }

  const requested = location.subview;
  const subview =
    requested !== undefined && section.subviews.includes(requested)
      ? requested
      : section.defaultSubview;

  return {
    section: location.section,
    ...(subview === undefined ? {} : { subview }),
    ...(location.entityId === undefined ? {} : { entityId: location.entityId }),
  };
};

/**
 * Legacy entry-point mapping: the `GameOverlayType` destinations that used to
 * be the seven-item nav strip, expressed as canonical locations. Returning
 * `undefined` means "not a management destination" (combat, dialogue, pause…).
 */
export const managementLocationFromOverlay = (
  overlay: GameOverlayType,
): ManagementLocation | undefined => MANAGEMENT_OVERLAY_LOCATIONS[overlay];

/** The location the HUD Menu entry opens when nothing else is remembered. */
export const DEFAULT_MENU_LOCATION: ManagementLocation = { section: 'character' };
