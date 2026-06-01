import { describe, expect, test } from 'bun:test';
import {
  AbilityTypeSchema,
  DEFAULT_SAVING_THROWS,
  DEFAULT_SKILLS,
  SavingThrowSchema,
  SKILL_ABILITY_MAP,
  SkillSchema,
} from './skills.ts';

describe('AbilityTypeSchema', () => {
  test('should parse valid ability types', () => {
    expect(AbilityTypeSchema.parse('strength')).toBe('strength');
    expect(AbilityTypeSchema.parse('dexterity')).toBe('dexterity');
    expect(AbilityTypeSchema.parse('charisma')).toBe('charisma');
  });

  test('should reject invalid ability types', () => {
    expect(() => AbilityTypeSchema.parse('power')).toThrow();
    expect(() => AbilityTypeSchema.parse('STR')).toThrow();
  });
});

describe('SkillSchema', () => {
  test('should parse valid skill data', () => {
    const skill = {
      name: 'Athletics',
      ability: 'strength' as const,
      isProficient: true,
      isExpertise: false,
    };
    const result = SkillSchema.parse(skill);
    expect(result.name).toBe('Athletics');
    expect(result.isProficient).toBe(true);
  });

  test('should have default values for optional fields', () => {
    const skill = {
      name: 'Acrobatics',
      ability: 'dexterity' as const,
    };
    const result = SkillSchema.parse(skill);
    expect(result.isProficient).toBe(false);
    expect(result.isExpertise).toBe(false);
  });

  test('should reject invalid ability in skill', () => {
    const skill = {
      name: 'Athletics',
      ability: 'invalid',
      isProficient: true,
    };
    expect(() => SkillSchema.parse(skill)).toThrow();
  });
});

describe('SavingThrowSchema', () => {
  test('should parse valid saving throw data', () => {
    const save = {
      ability: 'dexterity' as const,
      isProficient: true,
      isExpertise: false,
    };
    const result = SavingThrowSchema.parse(save);
    expect(result.ability).toBe('dexterity');
    expect(result.isProficient).toBe(true);
  });

  test('should have default values for optional fields', () => {
    const save = { ability: 'wisdom' as const };
    const result = SavingThrowSchema.parse(save);
    expect(result.isProficient).toBe(false);
    expect(result.isExpertise).toBe(false);
  });
});

describe('SKILL_ABILITY_MAP', () => {
  test('should map strength skills correctly', () => {
    expect(SKILL_ABILITY_MAP.athletics).toBe('strength');
  });

  test('should map dexterity skills correctly', () => {
    expect(SKILL_ABILITY_MAP.acrobatics).toBe('dexterity');
    expect(SKILL_ABILITY_MAP['sleight of hand']).toBe('dexterity');
    expect(SKILL_ABILITY_MAP.stealth).toBe('dexterity');
  });

  test('should map intelligence skills correctly', () => {
    expect(SKILL_ABILITY_MAP.arcana).toBe('intelligence');
    expect(SKILL_ABILITY_MAP.history).toBe('intelligence');
    expect(SKILL_ABILITY_MAP.investigation).toBe('intelligence');
    expect(SKILL_ABILITY_MAP.nature).toBe('intelligence');
    expect(SKILL_ABILITY_MAP.religion).toBe('intelligence');
  });

  test('should map wisdom skills correctly', () => {
    expect(SKILL_ABILITY_MAP.animalHandling).toBe('wisdom');
    expect(SKILL_ABILITY_MAP.insight).toBe('wisdom');
    expect(SKILL_ABILITY_MAP.medicine).toBe('wisdom');
    expect(SKILL_ABILITY_MAP.perception).toBe('wisdom');
    expect(SKILL_ABILITY_MAP.survival).toBe('wisdom');
  });

  test('should map charisma skills correctly', () => {
    expect(SKILL_ABILITY_MAP.deception).toBe('charisma');
    expect(SKILL_ABILITY_MAP.intimidation).toBe('charisma');
    expect(SKILL_ABILITY_MAP.performance).toBe('charisma');
    expect(SKILL_ABILITY_MAP.persuasion).toBe('charisma');
  });
});

describe('DEFAULT_SKILLS', () => {
  test('should have 18 skills', () => {
    expect(DEFAULT_SKILLS).toHaveLength(18);
  });

  test('should have all skills as non-proficient by default', () => {
    for (const skill of DEFAULT_SKILLS) {
      expect(skill.isProficient).toBe(false);
      expect(skill.isExpertise).toBe(false);
    }
  });

  test('should include all core D&D skills', () => {
    const skillNames = DEFAULT_SKILLS.map((s) => s.name.toLowerCase());
    expect(skillNames).toContain('athletics');
    expect(skillNames).toContain('acrobatics');
    expect(skillNames).toContain('stealth');
    expect(skillNames).toContain('arcana');
    expect(skillNames).toContain('persuasion');
    expect(skillNames).toContain('deception');
  });
});

describe('DEFAULT_SAVING_THROWS', () => {
  test('should have 6 saving throws', () => {
    expect(DEFAULT_SAVING_THROWS).toHaveLength(6);
  });

  test('should have all abilities represented', () => {
    const abilities = DEFAULT_SAVING_THROWS.map((s) => s.ability);
    expect(abilities).toContain('strength');
    expect(abilities).toContain('dexterity');
    expect(abilities).toContain('constitution');
    expect(abilities).toContain('intelligence');
    expect(abilities).toContain('wisdom');
    expect(abilities).toContain('charisma');
  });

  test('should have all saves as non-proficient by default', () => {
    for (const save of DEFAULT_SAVING_THROWS) {
      expect(save.isProficient).toBe(false);
      expect(save.isExpertise).toBe(false);
    }
  });
});
