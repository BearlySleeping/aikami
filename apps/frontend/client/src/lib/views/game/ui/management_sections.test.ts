// apps/frontend/client/src/lib/views/game/ui/management_sections.test.ts
//
// C-527 — pure policy tests for the management section registry and the legacy
// entry-point mapping. These assert the contract's mapping table verbatim, so a
// future edit that silently re-widens the section union (or renames a
// destination) fails here rather than in the host.

import { describe, expect, test } from 'bun:test';
import type { GameOverlayType } from '$types';
import {
  DEFAULT_MENU_LOCATION,
  getManagementSection,
  isManagementOverlay,
  isManagementSectionId,
  MANAGEMENT_OVERLAY_TYPES,
  MANAGEMENT_SECTIONS,
  managementLocationFromOverlay,
  managementOverlayFor,
  managementSectionLabel,
  normalizeManagementLocation,
} from './management_sections.ts';

describe('C-527 management section registry', () => {
  test('exposes exactly the five canonical sections in navigation order', () => {
    expect(MANAGEMENT_SECTIONS.map((section) => section.id)).toEqual([
      'character',
      'inventory',
      'journal',
      'party',
      'world',
    ]);
  });

  test('every section has a label and a destination overlay', () => {
    for (const section of MANAGEMENT_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.overlay.length).toBeGreaterThan(0);
    }
  });

  test('subview overlays are always named in the section own allowlist', () => {
    for (const section of MANAGEMENT_SECTIONS) {
      for (const subview of Object.keys(section.subviewOverlays ?? {})) {
        expect(section.subviews).toContain(subview);
      }
    }
  });

  test('guards accept only canonical section ids', () => {
    expect(isManagementSectionId('journal')).toBe(true);
    expect(isManagementSectionId('quests')).toBe(false);
    expect(isManagementSectionId('reputation')).toBe(false);
    expect(isManagementSectionId(undefined)).toBe(false);
  });

  test('resolves labels and registry entries', () => {
    expect(managementSectionLabel('party')).toBe('Party');
    expect(getManagementSection('world')?.label).toBe('World');
    expect(getManagementSection('inventory')?.subviews).toEqual([]);
  });
});

describe('C-527 legacy entry-point mapping', () => {
  const cases: readonly [GameOverlayType, string][] = [
    ['CHARACTER_DASHBOARD', 'character'],
    ['INVENTORY', 'inventory'],
    ['JOURNAL', 'journal'],
    ['QUEST_LOG', 'journal'],
    ['PARTY_ROSTER', 'party'],
    ['REPUTATION', 'world'],
    ['WORLD', 'world'],
  ];

  test('maps every legacy nav destination onto a canonical section', () => {
    for (const [overlay, section] of cases) {
      expect(managementLocationFromOverlay(overlay)?.section).toBe(section as never);
    }
  });

  test('deep-open destinations keep their subview', () => {
    expect(managementLocationFromOverlay('QUEST_LOG')).toEqual({
      section: 'journal',
      subview: 'quests',
    });
    expect(managementLocationFromOverlay('JOURNAL')).toEqual({
      section: 'journal',
      subview: 'notes',
    });
    expect(managementLocationFromOverlay('REPUTATION')).toEqual({
      section: 'world',
      subview: 'reputation',
    });
    expect(managementLocationFromOverlay('WORLD')).toEqual({
      section: 'world',
      subview: 'codex',
    });
  });

  test('non-management overlays have no canonical location', () => {
    for (const overlay of [
      'NONE',
      'PAUSE_MENU',
      'DIALOGUE',
      'COMBAT',
      'VENDOR',
      'SETTINGS',
    ] as const) {
      expect(managementLocationFromOverlay(overlay)).toBeUndefined();
      expect(isManagementOverlay(overlay)).toBe(false);
    }
  });

  test('the overlay set covers exactly the seven legacy destinations', () => {
    expect([...MANAGEMENT_OVERLAY_TYPES].sort()).toEqual(
      [
        'CHARACTER_DASHBOARD',
        'INVENTORY',
        'JOURNAL',
        'PARTY_ROSTER',
        'QUEST_LOG',
        'REPUTATION',
        'WORLD',
      ].sort(),
    );
  });

  test('round-trips every mapped location back to its overlay', () => {
    for (const [overlay] of cases) {
      const location = managementLocationFromOverlay(overlay);
      expect(location).toBeDefined();
      if (location === undefined) {
        throw new Error(`expected a management location for ${overlay}`);
      }
      expect(managementOverlayFor(location)).toBe(overlay);
    }
  });

  test('a section without a subview routes to its default overlay', () => {
    expect(managementOverlayFor({ section: 'inventory' })).toBe('INVENTORY');
    expect(managementOverlayFor({ section: 'party' })).toBe('PARTY_ROSTER');
    expect(managementOverlayFor({ section: 'journal' })).toBe('JOURNAL');
    expect(managementOverlayFor({ section: 'journal', subview: 'quests' })).toBe('QUEST_LOG');
  });
});

describe('C-527 location normalization', () => {
  test('fills the section default subview when none is requested', () => {
    expect(normalizeManagementLocation({ section: 'journal' })).toEqual({
      section: 'journal',
      subview: 'notes',
    });
    expect(normalizeManagementLocation({ section: 'world' })).toEqual({
      section: 'world',
      subview: 'codex',
    });
  });

  test('an unknown subview falls back to the section default instead of throwing', () => {
    expect(normalizeManagementLocation({ section: 'journal', subview: 'nope' })).toEqual({
      section: 'journal',
      subview: 'notes',
    });
    expect(normalizeManagementLocation({ section: 'world', subview: '' })).toEqual({
      section: 'world',
      subview: 'codex',
    });
  });

  test('a subview on a tab-less section is dropped', () => {
    expect(normalizeManagementLocation({ section: 'inventory', subview: 'quests' })).toEqual({
      section: 'inventory',
    });
  });

  test('a known subview is preserved', () => {
    expect(normalizeManagementLocation({ section: 'journal', subview: 'quests' })).toEqual({
      section: 'journal',
      subview: 'quests',
    });
  });

  test('entityId is preserved only when supplied', () => {
    expect(
      normalizeManagementLocation({ section: 'characters' as never, subview: 'x' }),
    ).toBeUndefined();
    expect(normalizeManagementLocation({ section: 'inventory', entityId: 'sword-1' })).toEqual({
      section: 'inventory',
      entityId: 'sword-1',
    });
  });

  test('the default Menu location is a canonical section', () => {
    expect(isManagementSectionId(DEFAULT_MENU_LOCATION.section)).toBe(true);
  });
});
