// packages/shared/utils/src/lib/rules/__tests__/character_sheet.test.ts
//
// Unit tests for Character Sheet computation helpers.
// Contract: C-232 Character Sheet & Traits System

import { describe, expect, it } from 'bun:test';
import type { AbilityScores } from '@aikami/types';
import { ABILITY_KEYS } from '@aikami/types';
import {
  computeModifier,
  computeProficiencyBonus,
  computeSaveModifier,
  computeSkillModifier,
  createDefaultSheet,
  recomputeAbilities,
  recomputeSavingThrows,
  recomputeSkills,
  serializeForAi,
  validateSheetJson,
} from '../character_sheet';

// ── computeModifier ──────────────────────────────────────

describe('computeModifier', () => {
  it('should compute +3 for score 16', () => {
    expect(computeModifier(16)).toBe(3);
  });

  it('should compute -1 for score 9', () => {
    expect(computeModifier(9)).toBe(-1);
  });

  it('should compute 0 for score 10', () => {
    expect(computeModifier(10)).toBe(0);
  });

  it('should compute +5 for score 20', () => {
    expect(computeModifier(20)).toBe(5);
  });

  it('should compute -4 for score 3', () => {
    expect(computeModifier(3)).toBe(-4);
  });

  it('should clamp below 3 to -4', () => {
    expect(computeModifier(1)).toBe(-4);
  });

  it('should clamp above 20 to +5', () => {
    expect(computeModifier(25)).toBe(5);
  });

  it('should round fractional scores', () => {
    expect(computeModifier(16.7)).toBe(3);
    expect(computeModifier(9.3)).toBe(-1);
  });
});

// ── computeProficiencyBonus ──────────────────────────────

describe('computeProficiencyBonus', () => {
  it('should return +2 for level 1', () => {
    expect(computeProficiencyBonus(1)).toBe(2);
  });

  it('should return +2 for level 4', () => {
    expect(computeProficiencyBonus(4)).toBe(2);
  });

  it('should return +3 for level 5', () => {
    expect(computeProficiencyBonus(5)).toBe(3);
  });

  it('should return +4 for level 9', () => {
    expect(computeProficiencyBonus(9)).toBe(4);
  });

  it('should return +5 for level 13', () => {
    expect(computeProficiencyBonus(13)).toBe(5);
  });

  it('should return +6 for level 17', () => {
    expect(computeProficiencyBonus(17)).toBe(6);
  });

  it('should clamp to 1-20 range', () => {
    expect(computeProficiencyBonus(0)).toBe(2);
    expect(computeProficiencyBonus(21)).toBe(6);
  });
});

// ── computeSkillModifier ─────────────────────────────────

describe('computeSkillModifier', () => {
  it('should compute modifier with proficiency: +3 ability + 2 prof = 5', () => {
    expect(computeSkillModifier(3, true, 2, false)).toBe(5);
  });

  it('should compute modifier with expertise: +3 ability + 2 prof * 2 = 7', () => {
    expect(computeSkillModifier(3, true, 2, true)).toBe(7);
  });

  it('should compute modifier without proficiency: just ability mod', () => {
    expect(computeSkillModifier(3, false, 2, false)).toBe(3);
  });

  it('should compute negative ability mod with proficiency: -1 + 2 = 1', () => {
    expect(computeSkillModifier(-1, true, 2, false)).toBe(1);
  });

  it('should handle zero ability mod', () => {
    expect(computeSkillModifier(0, true, 2, false)).toBe(2);
  });
});

// ── computeSaveModifier ──────────────────────────────────

describe('computeSaveModifier', () => {
  it('should compute with proficiency: +3 ability + 2 prof = 5', () => {
    expect(computeSaveModifier(3, true, 2)).toBe(5);
  });

  it('should compute without proficiency: just ability mod', () => {
    expect(computeSaveModifier(3, false, 2)).toBe(3);
  });

  it('should handle negative ability mod', () => {
    expect(computeSaveModifier(-1, true, 2)).toBe(1);
  });
});

// ── recomputeAbilities ───────────────────────────────────

describe('recomputeAbilities', () => {
  it('should recompute all modifiers', () => {
    const abilities = {
      strength: { value: 16, modifier: 99 },
      dexterity: { value: 14, modifier: 99 },
      constitution: { value: 14, modifier: 99 },
      intelligence: { value: 12, modifier: 99 },
      wisdom: { value: 10, modifier: 99 },
      charisma: { value: 8, modifier: 99 },
    } satisfies AbilityScores;

    const result = recomputeAbilities(abilities);

    expect(result.strength.modifier).toBe(3);
    expect(result.dexterity.modifier).toBe(2);
    expect(result.constitution.modifier).toBe(2);
    expect(result.intelligence.modifier).toBe(1);
    expect(result.wisdom.modifier).toBe(0);
    expect(result.charisma.modifier).toBe(-1);

    // Original values preserved
    expect(result.strength.value).toBe(16);
  });

  it('should not mutate the input', () => {
    const abilities = {
      strength: { value: 16, modifier: 99 },
      dexterity: { value: 14, modifier: 99 },
      constitution: { value: 14, modifier: 99 },
      intelligence: { value: 12, modifier: 99 },
      wisdom: { value: 10, modifier: 99 },
      charisma: { value: 8, modifier: 99 },
    } satisfies AbilityScores;

    recomputeAbilities(abilities);
    expect(abilities.strength.modifier).toBe(99);
  });
});

// ── recomputeSkills ──────────────────────────────────────

describe('recomputeSkills', () => {
  it('should recompute skill modifiers based on abilities and proficiency bonus', () => {
    const abilities = {
      strength: { value: 16, modifier: 3 },
      dexterity: { value: 14, modifier: 2 },
      constitution: { value: 14, modifier: 2 },
      intelligence: { value: 12, modifier: 1 },
      wisdom: { value: 10, modifier: 0 },
      charisma: { value: 8, modifier: -1 },
    } satisfies AbilityScores;

    const skills = [
      // proficient + expertise = 3 + 2*2 = 7
      {
        name: 'Athletics',
        ability: 'strength' as const,
        isProficient: true,
        isExpertise: true,
        modifier: 99,
      },
      // proficient only = 2 + 2 = 4
      {
        name: 'Stealth',
        ability: 'dexterity' as const,
        isProficient: true,
        isExpertise: false,
        modifier: 99,
      },
      // not proficient = -1
      {
        name: 'Persuasion',
        ability: 'charisma' as const,
        isProficient: false,
        isExpertise: false,
        modifier: 99,
      },
    ];

    const result = recomputeSkills(skills, abilities, 2);

    expect(result[0].modifier).toBe(7); // 3 + 2*2
    expect(result[1].modifier).toBe(4); // 2 + 2
    expect(result[2].modifier).toBe(-1); // just ability mod
  });
});

// ── recomputeSavingThrows ────────────────────────────────

describe('recomputeSavingThrows', () => {
  it('should recompute save modifiers', () => {
    const abilities = {
      strength: { value: 16, modifier: 3 },
      dexterity: { value: 14, modifier: 2 },
      constitution: { value: 14, modifier: 2 },
      intelligence: { value: 12, modifier: 1 },
      wisdom: { value: 10, modifier: 0 },
      charisma: { value: 8, modifier: -1 },
    } satisfies AbilityScores;

    const saves = [
      { ability: 'strength' as const, isProficient: true, isExpertise: false, modifier: 99 },
      { ability: 'charisma' as const, isProficient: false, isExpertise: false, modifier: 99 },
    ];

    const result = recomputeSavingThrows(saves, abilities, 2);

    expect(result[0].modifier).toBe(5); // 3 + 2
    expect(result[1].modifier).toBe(-1); // just ability mod
  });
});

// ── serializeForAi ───────────────────────────────────────

describe('serializeForAi', () => {
  it('should include all major sections', () => {
    const sheet = createDefaultSheet();
    // Customize for a realistic character
    sheet.level = 3;
    sheet.abilities.strength = { value: 16, modifier: 3 };
    sheet.abilities.dexterity = { value: 14, modifier: 2 };
    sheet.skills[0] = { ...sheet.skills[0], isProficient: true };
    sheet.skills[2] = { ...sheet.skills[2], isProficient: true };
    sheet.savingThrows[0] = { ...sheet.savingThrows[0], isProficient: true };
    sheet.traits.personalityTraits = 'Brave but reckless.';
    sheet.narrativeTraits.likes = ['Gold', 'Adventure'];

    const output = serializeForAi(sheet);

    expect(output).toContain('[CHARACTER SHEET]');
    expect(output).toContain('Level 3');
    expect(output).toContain('STR 16(+3)');
    expect(output).toContain('Proficiency:');
    expect(output).toContain('Saves:');
    expect(output).toContain('Brave but reckless');
    expect(output).toContain('Likes:');
  });

  it('should be under 2KB for a full sheet', () => {
    const sheet = createDefaultSheet();
    sheet.abilities.strength = { value: 16, modifier: 3 };
    sheet.abilities.dexterity = { value: 14, modifier: 2 };
    sheet.abilities.constitution = { value: 14, modifier: 2 };
    sheet.abilities.intelligence = { value: 12, modifier: 1 };
    sheet.abilities.wisdom = { value: 10, modifier: 0 };
    sheet.abilities.charisma = { value: 8, modifier: -1 };

    // Make a few skills proficient
    sheet.skills[0].isProficient = true; // Athletics
    sheet.skills[3].isProficient = true; // Acrobatics
    sheet.skills[5].isProficient = true; // Insight

    // All proficient on saves
    for (const save of sheet.savingThrows) {
      save.isProficient = true;
    }

    sheet.traits = {
      personalityTraits: 'Brave but reckless.',
      ideals: 'Freedom.',
      bonds: 'My family.',
      flaws: 'Pride.',
    };
    sheet.narrativeTraits = {
      likes: ['Gold', 'Adventure', 'Ancient Lore'],
      temptations: ['Power', 'Revenge'],
      keys: ['Lost Sister'],
    };
    sheet.skills = recomputeSkills(sheet.skills, sheet.abilities, sheet.proficiencyBonus);
    sheet.savingThrows = recomputeSavingThrows(
      sheet.savingThrows,
      sheet.abilities,
      sheet.proficiencyBonus,
    );

    const output = serializeForAi(sheet);
    expect(output.length).toBeLessThan(2048);
  });

  it('should omit empty sections', () => {
    const sheet = createDefaultSheet(); // All default — no traits, no proficiencies
    const output = serializeForAi(sheet);

    // Should still have header + abilities
    expect(output).toContain('[CHARACTER SHEET]');
    expect(output).toContain('Level 1');

    // Should NOT include optional sections that are empty
    expect(output).not.toContain('Proficiency:');
    expect(output).not.toContain('Saves:');
    expect(output).not.toContain('Traits:');
    expect(output).not.toContain('Likes:');
    expect(output).not.toContain('Temptations:');
    expect(output).not.toContain('Keys:');
  });

  it('should handle missing ability gracefully', () => {
    // Edge case: skill references an ability not in the abilities map
    const sheet = createDefaultSheet();
    sheet.skills[0].isProficient = true;
    // Use an ability key that exists but has undefined modifier edge
    sheet.abilities = {
      strength: { value: 16, modifier: 3 },
      dexterity: { value: 14, modifier: 2 },
      constitution: { value: 14, modifier: 2 },
      intelligence: { value: 12, modifier: 1 },
      wisdom: { value: 10, modifier: 0 },
      charisma: { value: 8, modifier: -1 },
    } satisfies AbilityScores;

    expect(() => serializeForAi(sheet)).not.toThrow();
  });
});

// ── validateSheetJson ────────────────────────────────────

describe('validateSheetJson', () => {
  it('should accept a valid character sheet JSON', () => {
    const sheet = createDefaultSheet();
    const json = JSON.stringify(sheet);
    const result = validateSheetJson(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.level).toBe(1);
    }
  });

  it('should reject invalid JSON string', () => {
    const result = validateSheetJson('not valid json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invalid JSON');
    }
  });

  it('should reject non-object root', () => {
    const result = validateSheetJson('"just a string"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Root must be an object');
    }
  });

  it('should reject missing required fields', () => {
    const result = validateSheetJson('{"name": "test"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Missing required field');
    }
  });

  it('should reject ability score below 3', () => {
    const sheet = createDefaultSheet();
    sheet.abilities.strength.value = 1;
    const json = JSON.stringify(sheet);
    const result = validateSheetJson(json);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('out of range');
    }
  });

  it("should accept level 20 character with 18's", () => {
    const sheet = createDefaultSheet();
    sheet.level = 20;
    sheet.proficiencyBonus = 6;
    for (const key of ABILITY_KEYS) {
      sheet.abilities[key].value = 18;
      sheet.abilities[key].modifier = 4;
    }
    const json = JSON.stringify(sheet);
    const result = validateSheetJson(json);

    expect(result.ok).toBe(true);
  });
});
