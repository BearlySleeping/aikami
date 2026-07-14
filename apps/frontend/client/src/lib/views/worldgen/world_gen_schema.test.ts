// apps/frontend/client/src/lib/views/worldgen/world_gen_schema.test.ts
//
// Unit tests for world gen data shapes — validates that the expected JSON
// structure from the LLM has all required fields and correct types.
// Uses manual structural validation (matching what the ViewModel does
// at runtime) rather than TypeBox Value.Parse, since typebox v1.x
// re-export does not expose Value.
//
// Contract: C-233

import { describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Helper: validate a world gen output structurally
// ---------------------------------------------------------------------------

type NpcShape = {
  name: string;
  race: string;
  class: string;
  role: string;
  description: string;
  personality: string;
};

type PartyArcShape = {
  chapter: string;
  description: string;
  objectives: string[];
  questGivers: string[];
};

type HudWidgetShape = {
  slot: string;
  label: string;
  icon: string;
  defaultVisibility: boolean;
};

type WorldGenOutputShape = {
  worldName: string;
  worldDescription: string;
  npcs: NpcShape[];
  locations: string[];
  partyArcs: PartyArcShape[];
  hudWidgets: HudWidgetShape[];
};

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isValidNpc = (npc: unknown): npc is NpcShape => {
  if (!npc || typeof npc !== 'object') {
    return false;
  }
  const o = npc as Record<string, unknown>;
  return (
    isString(o.name) &&
    isString(o.race) &&
    isString(o.class) &&
    isString(o.role) &&
    isString(o.description) &&
    o.description.length >= 10 &&
    isString(o.personality) &&
    o.personality.length >= 10
  );
};

const isValidPartyArc = (arc: unknown): arc is PartyArcShape => {
  if (!arc || typeof arc !== 'object') {
    return false;
  }
  const o = arc as Record<string, unknown>;
  return (
    isString(o.chapter) &&
    isString(o.description) &&
    o.description.length >= 10 &&
    Array.isArray(o.objectives) &&
    o.objectives.length >= 1 &&
    o.objectives.every((obj: unknown) => isString(obj)) &&
    Array.isArray(o.questGivers) &&
    o.questGivers.length >= 1 &&
    o.questGivers.every((qg: unknown) => isString(qg))
  );
};

const isValidHudWidget = (widget: unknown): widget is HudWidgetShape => {
  if (!widget || typeof widget !== 'object') {
    return false;
  }
  const o = widget as Record<string, unknown>;
  return (
    isString(o.slot) &&
    isString(o.label) &&
    isString(o.icon) &&
    typeof o.defaultVisibility === 'boolean'
  );
};

const isValidWorldGenOutput = (output: unknown): output is WorldGenOutputShape => {
  if (!output || typeof output !== 'object') {
    return false;
  }
  const o = output as Record<string, unknown>;
  return (
    isString(o.worldName) &&
    o.worldName.length <= 100 &&
    isString(o.worldDescription) &&
    o.worldDescription.length >= 20 &&
    Array.isArray(o.npcs) &&
    o.npcs.length >= 3 &&
    o.npcs.every(isValidNpc) &&
    Array.isArray(o.locations) &&
    o.locations.length >= 3 &&
    o.locations.every(isString) &&
    Array.isArray(o.partyArcs) &&
    o.partyArcs.length >= 1 &&
    o.partyArcs.every(isValidPartyArc) &&
    Array.isArray(o.hudWidgets) &&
    o.hudWidgets.length >= 1 &&
    o.hudWidgets.every(isValidHudWidget)
  );
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_NPC: NpcShape = {
  name: 'Elena Vex',
  race: 'Human',
  class: 'Wizard',
  role: 'Quest Giver',
  description: 'A wise wizard with silver hair streaked with aetherial blue.',
  personality: 'Wise and measured, she trusts few outside the Council.',
};

const VALID_PARTY_ARC: PartyArcShape = {
  chapter: 'Chapter 1: The Awakening',
  description: 'The party investigates the source of the Blight.',
  objectives: ['Visit the Grove', 'Collect samples', 'Report findings'],
  questGivers: ['Elena Vex'],
};

const VALID_HUD_WIDGET: HudWidgetShape = {
  slot: 'top-left',
  label: 'Aether Compass',
  icon: 'compass',
  defaultVisibility: true,
};

const VALID_WORLD_GEN_OUTPUT: WorldGenOutputShape = {
  worldName: "Aetheria's Echo",
  worldDescription:
    'A floating archipelago suspended above a sea of clouds. Ancient technology pulses through crystal conduits embedded in the islands.',
  npcs: [
    VALID_NPC,
    { ...VALID_NPC, name: 'Kael Stonebeard', role: 'Ally' },
    { ...VALID_NPC, name: 'Zara Nightwhisper', role: 'Merchant' },
  ],
  locations: ['Arcanum Spire', 'The Underdrift Ruins', 'Crystalwood Grove'],
  partyArcs: [VALID_PARTY_ARC],
  hudWidgets: [VALID_HUD_WIDGET],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldGen schema validation — C-233', () => {
  describe('valid output', () => {
    test('accepts a complete valid output', () => {
      expect(isValidWorldGenOutput(VALID_WORLD_GEN_OUTPUT)).toBe(true);
    });

    test('accepts output with exactly 3 NPCs', () => {
      const data = { ...VALID_WORLD_GEN_OUTPUT, npcs: VALID_WORLD_GEN_OUTPUT.npcs };
      expect(isValidWorldGenOutput(data)).toBe(true);
    });

    test('accepts output with maximum values', () => {
      const maxArcs: PartyArcShape[] = Array.from({ length: 6 }, (_, i) => ({
        ...VALID_PARTY_ARC,
        chapter: `Chapter ${i + 1}`,
      }));
      const twelveNpcs: NpcShape[] = Array.from({ length: 12 }, (_, i) => ({
        ...VALID_NPC,
        name: `NPC ${i + 1}`,
      }));
      const twentyLocations = Array.from({ length: 20 }, (_, i) => `Location ${i + 1}`);
      const eightWidgets: HudWidgetShape[] = Array.from({ length: 8 }, (_, i) => ({
        ...VALID_HUD_WIDGET,
        label: `Widget ${i + 1}`,
      }));

      const output = {
        ...VALID_WORLD_GEN_OUTPUT,
        npcs: twelveNpcs,
        locations: twentyLocations,
        partyArcs: maxArcs,
        hudWidgets: eightWidgets,
      };

      expect(isValidWorldGenOutput(output)).toBe(true);
    });
  });

  describe('invalid output', () => {
    test('rejects missing worldName', () => {
      const { worldName: _, ...rest } = VALID_WORLD_GEN_OUTPUT;
      expect(isValidWorldGenOutput(rest as unknown as WorldGenOutputShape)).toBe(false);
    });

    test('rejects empty worldName', () => {
      expect(isValidWorldGenOutput({ ...VALID_WORLD_GEN_OUTPUT, worldName: '' })).toBe(false);
    });

    test('rejects missing worldDescription', () => {
      const { worldDescription: _, ...rest } = VALID_WORLD_GEN_OUTPUT;
      expect(isValidWorldGenOutput(rest as unknown as WorldGenOutputShape)).toBe(false);
    });

    test('rejects missing npcs array', () => {
      const { npcs: _, ...rest } = VALID_WORLD_GEN_OUTPUT;
      expect(isValidWorldGenOutput(rest as unknown as WorldGenOutputShape)).toBe(false);
    });

    test('rejects npcs with fewer than 3 entries', () => {
      expect(
        isValidWorldGenOutput({
          ...VALID_WORLD_GEN_OUTPUT,
          npcs: [VALID_NPC, VALID_NPC],
        }),
      ).toBe(false);
    });

    test('rejects null npcs', () => {
      expect(
        isValidWorldGenOutput({ ...VALID_WORLD_GEN_OUTPUT, npcs: null as unknown as NpcShape[] }),
      ).toBe(false);
    });

    test('rejects wrong type for worldName (number)', () => {
      expect(
        isValidWorldGenOutput({
          ...VALID_WORLD_GEN_OUTPUT,
          worldName: 123 as unknown as string,
        }),
      ).toBe(false);
    });

    test('rejects missing locations', () => {
      const { locations: _, ...rest } = VALID_WORLD_GEN_OUTPUT;
      expect(isValidWorldGenOutput(rest as unknown as WorldGenOutputShape)).toBe(false);
    });

    test('rejects missing partyArcs', () => {
      const { partyArcs: _, ...rest } = VALID_WORLD_GEN_OUTPUT;
      expect(isValidWorldGenOutput(rest as unknown as WorldGenOutputShape)).toBe(false);
    });

    test('rejects missing hudWidgets', () => {
      const { hudWidgets: _, ...rest } = VALID_WORLD_GEN_OUTPUT;
      expect(isValidWorldGenOutput(rest as unknown as WorldGenOutputShape)).toBe(false);
    });
  });

  describe('NPC validation', () => {
    test('accepts valid NPC', () => {
      expect(isValidNpc(VALID_NPC)).toBe(true);
    });

    test('rejects NPC missing name', () => {
      const { name: _, ...rest } = VALID_NPC;
      expect(isValidNpc(rest as unknown as NpcShape)).toBe(false);
    });

    test('rejects NPC with empty description', () => {
      expect(isValidNpc({ ...VALID_NPC, description: 'short' })).toBe(false);
    });

    test('rejects NPC with wrong role type', () => {
      expect(isValidNpc({ ...VALID_NPC, role: 42 as unknown as string })).toBe(false);
    });
  });

  describe('PartyArc validation', () => {
    test('rejects arc with empty objectives', () => {
      expect(isValidPartyArc({ ...VALID_PARTY_ARC, objectives: [] })).toBe(false);
    });

    test('rejects arc with empty questGivers', () => {
      expect(isValidPartyArc({ ...VALID_PARTY_ARC, questGivers: [] })).toBe(false);
    });
  });

  describe('HudWidget validation', () => {
    test('rejects widget with non-boolean defaultVisibility', () => {
      expect(
        isValidHudWidget({
          ...VALID_HUD_WIDGET,
          defaultVisibility: 'true' as unknown as boolean,
        }),
      ).toBe(false);
    });
  });
});
