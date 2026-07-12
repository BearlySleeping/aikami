// apps/frontend/client/src/lib/views/dev/character_sheet_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the Character Sheet. Extends the production
// ViewModel and injects mock data with varied ability scores, skill
// proficiencies, traits, and narrative traits for isolated testing.
//
// Contract: C-232 Character Sheet & Traits System

import { computeModifier } from '$lib/data/character_sheet_helpers';
import {
  type AbilityKey,
  createDefaultAbilities,
  createDefaultSavingThrows,
  createDefaultSkills,
} from '$lib/data/character_sheet_types';
import {
  CharacterSheetViewModel,
  type CharacterSheetViewModelInterface,
  type CharacterSheetViewModelOptions,
} from '$views/game/dashboard/character_sheet_view_model.svelte';

export type CharacterSheetSandboxViewModelInterface = CharacterSheetViewModelInterface & {
  readonly isSandbox: boolean;
};

class CharacterSheetSandboxViewModel
  extends CharacterSheetViewModel
  implements CharacterSheetSandboxViewModelInterface
{
  readonly isSandbox = true;

  constructor(options: CharacterSheetViewModelOptions) {
    super(options);
    this._loadMockData();
  }

  /** Populate character sheet with mock data for sandbox testing. */
  private _loadMockData(): void {
    // ── Mock ability scores ──
    const mockScores: Array<{ key: AbilityKey; value: number }> = [
      { key: 'strength', value: 16 },
      { key: 'dexterity', value: 14 },
      { key: 'constitution', value: 14 },
      { key: 'intelligence', value: 12 },
      { key: 'wisdom', value: 10 },
      { key: 'charisma', value: 8 },
    ];

    const abilities = createDefaultAbilities();
    for (const { key, value } of mockScores) {
      abilities[key] = { value, modifier: computeModifier(value) };
    }
    this._abilities = abilities;

    // ── Mock skill proficiencies ──
    const proficientSkills = new Set([
      'Athletics',
      'Intimidation',
      'Perception',
      'Survival',
      'Stealth',
    ]);
    this._skills = createDefaultSkills().map((s) => ({
      ...s,
      isProficient: proficientSkills.has(s.name),
    }));

    // Mark Athletics as expertise
    this._skills = this._skills.map((s) =>
      s.name === 'Athletics' ? { ...s, isProficient: true, isExpertise: true } : s,
    );

    // ── Mock saving throws ──
    const proficientSaves = new Set<AbilityKey>(['strength', 'constitution']);
    this._savingThrows = createDefaultSavingThrows().map((s) => ({
      ...s,
      isProficient: proficientSaves.has(s.ability),
    }));

    // ── Mock traits ──
    this._traits = {
      personalityTraits: 'I always keep my word. I face problems head-on.',
      ideals: 'Might makes right. The strong protect the weak.',
      bonds: 'I will find my lost sister, taken by the Shadow Guild.',
      flaws: 'I am quick to anger and slow to forgive.',
    };

    // ── Mock narrative traits ──
    this._narrativeTraits = {
      likes: ['Gold', 'Strong Drink', 'A Good Fight'],
      temptations: ['Power', 'Revenge'],
      keys: ['Lost Sister', 'The Crown of Aldren'],
    };
  }
}

export const getCharacterSheetSandboxViewModel = (
  options: CharacterSheetViewModelOptions,
): CharacterSheetSandboxViewModelInterface => CharacterSheetSandboxViewModel.create(options);
