// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_presentation.test.ts

import { describe, expect, test } from 'bun:test';
import { ABILITY_KEYS, ABILITY_LABELS } from '@aikami/types';
import { createDefaultSheet } from '@aikami/utils';
import {
  characterModifierTone,
  createCharacterSheetPresentationState,
  formatActivationCost,
  formatModifier,
  hasEarnedFeatures,
  toCharacterAbilityRows,
} from './character_sheet_presentation.svelte';

describe('character sheet presentation state', () => {
  test('defaults to read-only and toggles explicit editing', () => {
    const state = createCharacterSheetPresentationState();

    expect(state.isEditing).toBe(false);
    state.toggleEditing();
    expect(state.isEditing).toBe(true);
    state.toggleEditing();
    expect(state.isEditing).toBe(false);
  });

  test('developer surfaces may start in their already-authorized edit mode', () => {
    const state = createCharacterSheetPresentationState({ startEditing: true });

    expect(state.isEditing).toBe(true);
  });
});

describe('character sheet projections', () => {
  test('projects ability values and saving-throw proficiency', () => {
    const sheet = createDefaultSheet();
    const savingThrows = sheet.savingThrows.map((savingThrow, index) => ({
      ...savingThrow,
      isProficient: index === 0,
    }));
    const rows = toCharacterAbilityRows({
      abilities: sheet.abilities,
      savingThrows,
      abilityLabels: ABILITY_LABELS,
    });

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.score >= 3)).toBe(true);
    expect(rows.some((row) => row.isSavingThrowProficient)).toBe(true);
  });

  test('keeps canonical ability order when authored JSON properties are reordered', () => {
    const sheet = createDefaultSheet();
    const reorderedAbilities = {
      charisma: sheet.abilities.charisma,
      wisdom: sheet.abilities.wisdom,
      constitution: sheet.abilities.constitution,
      dexterity: sheet.abilities.dexterity,
      intelligence: sheet.abilities.intelligence,
      strength: sheet.abilities.strength,
    };
    const rows = toCharacterAbilityRows({
      abilities: reorderedAbilities,
      savingThrows: sheet.savingThrows,
      abilityLabels: ABILITY_LABELS,
    });

    expect(rows.map((row) => row.key)).toEqual(ABILITY_KEYS);
  });

  test('uses game numeric roles and signed modifiers', () => {
    expect(characterModifierTone(3)).toBe('game-numeric--positive');
    expect(characterModifierTone(-1)).toBe('game-numeric--negative');
    expect(characterModifierTone(0)).toBe('game-numeric--neutral');
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-2)).toBe('-2');
  });

  test('formats authored feature costs and detects earned features', () => {
    expect(formatActivationCost('ONE_ACTION')).toBe('One action');
    expect(hasEarnedFeatures([{ earned: false }, { earned: true }])).toBe(true);
    expect(hasEarnedFeatures([{ earned: false }])).toBe(false);
  });
});
