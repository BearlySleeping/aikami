// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_combat_fixtures.ts
//
// Combat fixtures and copy for the Obsidian Chronicle sandbox, kept separate
// so the ViewModel module stays focused on state transitions.

import { OBSIDIAN_ENEMY_ID, OBSIDIAN_PLAYER_ID } from './obsidian_fixtures';
import type { ObsidianEncounterSummary, ObsidianInitiativeEntry } from './obsidian_types';

/** Opening initiative order: player, companion, then the enemy. */
export const OBSIDIAN_INITIATIVE: readonly ObsidianInitiativeEntry[] = [
  {
    actorId: OBSIDIAN_PLAYER_ID,
    name: 'Rook',
    hue: 285,
    initiative: 18,
    isCurrent: true,
    hp: 26,
    maxHp: 34,
  },
  { actorId: 'kael', name: 'Kael', hue: 12, initiative: 14, isCurrent: false, hp: 22, maxHp: 30 },
  {
    actorId: OBSIDIAN_ENEMY_ID,
    name: 'Goblin Raider',
    hue: 96,
    initiative: 9,
    isCurrent: false,
    hp: 22,
    maxHp: 22,
  },
];

/** The single authoritative encounter result summary. */
export const OBSIDIAN_ENCOUNTER_SUMMARY: ObsidianEncounterSummary = {
  xp: 150,
  loot: '2 shortblades · 14 gp · a waterlogged map',
  injuries: 'Kael is bleeding (8 HP lost)',
  questEffects: 'The road to Ashfen is clear — the gate will be quick to reach.',
};

/** Narration committed when the encounter begins. */
export const OBSIDIAN_COMBAT_START_TEXT =
  'Three goblin raiders burst from the ditch, shortblades drawn. Roll initiative.';

/** Enemy turn action text. */
export const OBSIDIAN_ENEMY_ACTION_TEXT = 'Hurls a jagged spear at Rook.';

/** Enemy turn consequence text. */
export const OBSIDIAN_ENEMY_DAMAGE_TEXT = 'The spear grazes your shoulder. Rook takes 6 damage.';

/** Damage dealt by the player's scripted attack. */
export const OBSIDIAN_ATTACK_DAMAGE = 9;

/** Damage dealt by the enemy's scripted attack. */
export const OBSIDIAN_ENEMY_DAMAGE = 6;
