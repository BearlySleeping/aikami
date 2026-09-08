// apps/frontend/client/src/lib/services/game/player_state_service.test.ts
//
// Unit tests for the C-487 character-sheet source of truth on
// PlayerStateService. Verifies the real authored sheet (abilities, skill
// proficiency/expertise flags) is exposed through a service accessor, that the
// neutral fallback is a real neutral sheet (not a "Level 1 Fighter" string),
// and that the computed skill modifier matches the shared rules helpers.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig-override=tsconfig.test.json \
//     src/lib/services/game/player_state_service.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';
import type { GameCharacterSheet } from '@aikami/types';
import {
  computeModifier,
  computeProficiencyBonus,
  computeSkillModifier,
  createDefaultSheet,
} from '@aikami/utils';
import { playerStateService } from './player_state_service.svelte';

const sheetWithPersuasiveBard = (options?: { expertise?: boolean }): GameCharacterSheet => {
  const sheet = createDefaultSheet();
  sheet.abilities = {
    ...sheet.abilities,
    charisma: { value: 16, modifier: computeModifier(16) },
  };
  sheet.skills = sheet.skills.map((s) =>
    s.name === 'Persuasion'
      ? {
          ...s,
          isProficient: true,
          isExpertise: options?.expertise ?? false,
        }
      : s,
  );
  return sheet;
};

describe('PlayerStateService — C-487 character sheet source of truth', () => {
  beforeEach(() => {
    playerStateService.reset();
  });

  test('starts as a neutral sheet (all 10s → +0), never a string default', () => {
    const sheet = playerStateService.characterSheet;
    expect(sheet.abilities.charisma.value).toBe(10);
    expect(sheet.abilities.charisma.modifier).toBe(0);
    expect(sheet.skills.every((s) => !s.isProficient)).toBe(true);
    expect(playerStateService.isCharacterSheetAuthored).toBe(false);
    expect(playerStateService.characterSheetSummary).not.toBe('Level 1 Fighter');
    expect(playerStateService.characterSheetSummary).toContain('[CHARACTER SHEET]');
  });

  test('setAbilityScore recomputes the modifier and marks the sheet authored', () => {
    playerStateService.setAbilityScore({ key: 'charisma', value: 16 });
    expect(playerStateService.abilities.charisma.value).toBe(16);
    expect(playerStateService.abilities.charisma.modifier).toBe(3);
    expect(playerStateService.isCharacterSheetAuthored).toBe(true);
  });

  test('proficient Persuasion with CHA 16 totals +5 via the shared helper', () => {
    playerStateService.importCharacterSheet({ sheet: sheetWithPersuasiveBard() });
    const sheet = playerStateService.characterSheet;

    const abilityModifier = computeModifier(sheet.abilities.charisma.value);
    const proficiencyBonus = computeProficiencyBonus(sheet.level);
    const persuasion = sheet.skills.find((s) => s.name === 'Persuasion');

    expect(abilityModifier).toBe(3);
    expect(proficiencyBonus).toBe(2);
    expect(persuasion?.isProficient).toBe(true);
    expect(persuasion?.isExpertise).toBe(false);
    expect(computeSkillModifier(abilityModifier, true, proficiencyBonus, false)).toBe(5);
    expect(persuasion?.modifier).toBe(5);
  });

  test('expertise doubles the proficiency bonus (+7)', () => {
    playerStateService.importCharacterSheet({
      sheet: sheetWithPersuasiveBard({ expertise: true }),
    });
    const sheet = playerStateService.characterSheet;
    const persuasion = sheet.skills.find((s) => s.name === 'Persuasion');

    expect(persuasion?.isProficient).toBe(true);
    expect(persuasion?.isExpertise).toBe(true);
    expect(
      computeSkillModifier(
        computeModifier(sheet.abilities.charisma.value),
        true,
        computeProficiencyBonus(sheet.level),
        true,
      ),
    ).toBe(7);
    expect(persuasion?.modifier).toBe(7);
  });

  test('characterSheetSummary reflects the real authored abilities', () => {
    playerStateService.importCharacterSheet({ sheet: sheetWithPersuasiveBard() });
    expect(playerStateService.characterSheetSummary).toContain('CHA 16(+3)');
    expect(playerStateService.characterSheetSummary).toContain('Proficiency: Persuasion');
  });

  test('reset restores the neutral unauthored sheet', () => {
    playerStateService.importCharacterSheet({ sheet: sheetWithPersuasiveBard() });
    playerStateService.reset();

    expect(playerStateService.abilities.charisma.value).toBe(10);
    expect(playerStateService.skills.every((s) => !s.isProficient)).toBe(true);
    expect(playerStateService.isCharacterSheetAuthored).toBe(false);
  });
});
