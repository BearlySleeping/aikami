// packages/shared/schemas/src/lib/game/emberwatch_content_stability.test.ts
//
// Gate 5 compatibility guards for the authored Emberwatch content.
//
// Saved quest progress is keyed by OBJECTIVE INDEX (`objectiveIndex` in
// `quest_state.ts`) and inventory state is keyed by the raw item id. Neither
// has a stable-id alias layer, so inserting/reordering/renaming content
// silently relabels an existing save. These golden fixtures make any such
// change fail loudly at CI instead of silently corrupting players' worlds.

import { describe, expect, test } from 'bun:test';
import emberwatchManifest from '../../../../../../content/packs/emberwatch/manifest.json';

type Objective = {
  text?: string;
  prerequisiteIndices?: number[];
  optional?: boolean;
  completeOnNpcInteract?: string;
  completeOnMapEnter?: string;
  completeOnEncounterComplete?: string;
  completeOnItemPickup?: string;
};

type Quest = { id?: string; objectives?: Objective[] };

const manifest = emberwatchManifest as unknown as {
  startingMapId?: string;
  maps?: Record<string, unknown>;
  items?: Record<string, unknown>;
  quests?: Record<string, Quest>;
};

/** Compact `kind:value` signature for an objective's completion trigger. */
const triggerOf = (objective: Objective): string => {
  if (objective.completeOnNpcInteract) {
    return `npc:${objective.completeOnNpcInteract}`;
  }
  if (objective.completeOnMapEnter) {
    return `map:${objective.completeOnMapEnter}`;
  }
  if (objective.completeOnEncounterComplete) {
    return `encounter:${objective.completeOnEncounterComplete}`;
  }
  if (objective.completeOnItemPickup) {
    return `item:${objective.completeOnItemPickup}`;
  }
  return 'none';
};

const signaturesOf = (questId: string): string[] =>
  (manifest.quests?.[questId]?.objectives ?? []).map(triggerOf);

const prerequisitesOf = (questId: string): Array<number[] | null> =>
  (manifest.quests?.[questId]?.objectives ?? []).map((o) => o.prerequisiteIndices ?? null);

// ---------------------------------------------------------------------------
// Quest objective indices — order is part of the save contract.
// ---------------------------------------------------------------------------

const EXPECTED_OBJECTIVE_SIGNATURES: Record<string, readonly string[]> = {
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  fading_ward: [
    'npc:village_elder',
    'map:inn',
    'npc:innkeeper_sella',
    'map:merchant_shop',
    'item:wardWand',
    'map:old_road',
    'map:ruined_shrine',
    'npc:village_elder',
  ],
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  tools_for_tomorrow: ['npc:smith_orra', 'map:old_road', 'npc:smith_orra'],
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  a_room_kept_warm: ['npc:innkeeper_sella', 'npc:apprentice_tess', 'npc:innkeeper_sella'],
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  mark_the_safe_trail: ['npc:woodcutter_ada', 'map:old_road', 'npc:cartographer_ivo'],
};

const EXPECTED_PREREQUISITES: Record<string, readonly (readonly number[] | null)[]> = {
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  fading_ward: [null, [0], [1], [1], [1], [4], [5], [6]],
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  tools_for_tomorrow: [null, [0], [1]],
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  a_room_kept_warm: [null, [0], [1]],
  // biome-ignore lint/style/useNamingConvention: quest ids are snake_case
  mark_the_safe_trail: [null, [0], [1]],
};

describe('Emberwatch quest objective index stability', () => {
  for (const [questId, expected] of Object.entries(EXPECTED_OBJECTIVE_SIGNATURES)) {
    test(`${questId} objective order and triggers are unchanged`, () => {
      expect(signaturesOf(questId)).toEqual([...expected]);
    });
  }

  for (const [questId, expected] of Object.entries(EXPECTED_PREREQUISITES)) {
    test(`${questId} prerequisite indices are unchanged`, () => {
      expect(prerequisitesOf(questId)).toEqual(expected.map((p) => (p ? [...p] : null)));
    });
  }

  test('objective indices referenced by prerequisites are in range', () => {
    for (const [questId, quest] of Object.entries(manifest.quests ?? {})) {
      const count = quest.objectives?.length ?? 0;
      for (const objective of quest.objectives ?? []) {
        for (const index of objective.prerequisiteIndices ?? []) {
          expect(index, `${questId} prerequisite index ${index} in range`).toBeLessThan(count);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Inventory keys — a rename orphans saved stacks and quest pickups.
// ---------------------------------------------------------------------------

const EXPECTED_ITEM_KEYS = [
  'ironSword',
  'steelSword',
  'healthPotion',
  'manaPotion',
  'ironArmor',
  'woodenShield',
  'wardWand',
] as const;

describe('Emberwatch inventory key stability', () => {
  test('item keys match the save-compatible golden set', () => {
    expect(Object.keys(manifest.items ?? {}).sort()).toEqual([...EXPECTED_ITEM_KEYS].sort());
  });

  test('every completeOnItemPickup objective references a declared item', () => {
    const itemKeys = new Set(Object.keys(manifest.items ?? {}));
    for (const [questId, quest] of Object.entries(manifest.quests ?? {})) {
      for (const objective of quest.objectives ?? []) {
        const itemId = objective.completeOnItemPickup;
        if (itemId) {
          expect(itemKeys.has(itemId), `${questId} pickup item ${itemId} is declared`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scene identity — starting map and map keys are save-routing anchors.
// ---------------------------------------------------------------------------

const EXPECTED_MAP_KEYS = ['inn', 'merchant_shop', 'old_road', 'ruined_shrine', 'village'] as const;

describe('Emberwatch scene identity stability', () => {
  test('starting map is unchanged', () => {
    expect(manifest.startingMapId).toBe('village');
  });

  test('map keys match the save-routing golden set', () => {
    expect(Object.keys(manifest.maps ?? {}).sort()).toEqual([...EXPECTED_MAP_KEYS].sort());
  });
});
