// packages/shared/constants/src/lib/characters.test.ts
//
// Unit tests for character onboarding constants.
// Contract: C-319 Replace /setup with Fast Character Onboarding

import { describe, expect, it } from 'bun:test';
import {
  ABILITY_LABELS,
  APPEARANCE_PRESETS,
  CLASS_PRESETS,
  DND_STANDARD_ARRAY,
  ONBOARDING_STEPS,
  PLAY_STYLE_TAGS,
  PRONOUN_SETS,
  RANDOM_BACKGROUNDS,
  RANDOM_FANTASY_NAMES,
  RANDOM_PERSONALITIES,
  SPECIES_OPTIONS,
  STARTER_HEROES,
} from './characters';

describe('Pronoun sets', () => {
  it('has exactly three pronoun sets', () => {
    expect(PRONOUN_SETS.length).toBe(3);
  });

  it('includes he/him, she/her, and they/them', () => {
    const ids = PRONOUN_SETS.map((p) => p.id);
    expect(ids).toContain('he_him');
    expect(ids).toContain('she_her');
    expect(ids).toContain('they_them');
  });

  it('all pronoun sets have required fields', () => {
    for (const pronoun of PRONOUN_SETS) {
      expect(pronoun.subjective.length).toBeGreaterThan(0);
      expect(pronoun.objective.length).toBeGreaterThan(0);
      expect(pronoun.possessive.length).toBeGreaterThan(0);
      expect(pronoun.reflexive.length).toBeGreaterThan(0);
    }
  });
});

describe('Play-style tags', () => {
  it('has six play-style tags', () => {
    expect(PLAY_STYLE_TAGS.length).toBe(6);
  });

  it('all tags have unique IDs', () => {
    const ids = PLAY_STYLE_TAGS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Class presets', () => {
  it('has eight class presets', () => {
    expect(CLASS_PRESETS.length).toBe(8);
  });

  it('all classes have unique IDs', () => {
    const ids = CLASS_PRESETS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every class has a valid primary and secondary ability', () => {
    const validAbilities = Object.keys(ABILITY_LABELS);
    for (const cls of CLASS_PRESETS) {
      expect(validAbilities).toContain(cls.primaryAbility);
      expect(validAbilities).toContain(cls.secondaryAbility);
      expect(cls.primaryAbility).not.toBe(cls.secondaryAbility);
    }
  });

  it('every class playStyleIds map to existing play-style tags', () => {
    const tagIds = new Set(PLAY_STYLE_TAGS.map((t) => t.id));
    for (const cls of CLASS_PRESETS) {
      for (const tagId of cls.playStyleIds) {
        expect(tagIds.has(tagId)).toBe(true);
      }
    }
  });

  it('every class has suggested equipment and description', () => {
    for (const cls of CLASS_PRESETS) {
      expect(cls.label.length).toBeGreaterThan(0);
      expect(cls.description.length).toBeGreaterThan(0);
      expect(cls.suggestedEquipment.length).toBeGreaterThan(0);
    }
  });
});

describe('Species options', () => {
  it('has eight species options', () => {
    expect(SPECIES_OPTIONS.length).toBe(8);
  });

  it('all species have unique IDs', () => {
    const ids = SPECIES_OPTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all species have at least one suggested class', () => {
    for (const species of SPECIES_OPTIONS) {
      expect(species.suggestedClasses.length).toBeGreaterThan(0);
    }
  });

  it('Dragonborn is in the species list', () => {
    const ids = SPECIES_OPTIONS.map((s) => s.id);
    expect(ids).toContain('dragonborn');
  });
});

describe('Starter heroes', () => {
  it('has exactly three starter heroes', () => {
    expect(STARTER_HEROES.length).toBe(3);
  });

  it('all starter heroes have unique IDs', () => {
    const ids = STARTER_HEROES.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all starter heroes have required fields', () => {
    for (const hero of STARTER_HEROES) {
      expect(hero.name.length).toBeGreaterThan(0);
      expect(hero.race.length).toBeGreaterThan(0);
      expect(hero.class.length).toBeGreaterThan(0);
      expect(hero.alignment.length).toBeGreaterThan(0);
      expect(hero.flavorText.length).toBeGreaterThan(0);
      expect(hero.background.length).toBeGreaterThan(0);
      expect(hero.personalityTraits.length).toBeGreaterThan(0);
      expect(hero.appearance.length).toBeGreaterThan(0);
      expect(hero.pronouns.subjective.length).toBeGreaterThan(0);
    }
  });

  it('starter heroes include Thaldrin (Fighter), Lyra (Wizard), and Zeph (Rogue)', () => {
    const byId = new Map(STARTER_HEROES.map((h) => [h.id, h]));
    expect(byId.get('starter_thaldrin')?.class).toBe('Fighter');
    expect(byId.get('starter_lyra')?.class).toBe('Wizard');
    expect(byId.get('starter_zeph')?.class).toBe('Rogue');
  });

  it('all starter heroes have exactly six ability scores', () => {
    for (const hero of STARTER_HEROES) {
      expect(Object.keys(hero.abilityScores).length).toBe(6);
    }
  });

  it('all starter heroes have ability scores within 8-15 range', () => {
    for (const hero of STARTER_HEROES) {
      for (const score of Object.values(hero.abilityScores)) {
        expect(score).toBeGreaterThanOrEqual(8);
        expect(score).toBeLessThanOrEqual(15);
      }
    }
  });

  it('all starter hero equipment lists are non-empty', () => {
    for (const hero of STARTER_HEROES) {
      expect(hero.equipment.length).toBeGreaterThan(0);
    }
  });
});

describe('D&D Standard Array', () => {
  it('has exactly six values sorted descending', () => {
    expect(DND_STANDARD_ARRAY.length).toBe(6);
    expect(DND_STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
  });
});

describe('Onboarding steps', () => {
  it('has four steps in correct order', () => {
    expect(ONBOARDING_STEPS).toEqual(['identity', 'play_style', 'appearance', 'review']);
  });
});

describe('Appearance presets', () => {
  it('has at least six appearance presets', () => {
    expect(APPEARANCE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it('all presets have unique IDs and non-empty labels', () => {
    const ids = APPEARANCE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of APPEARANCE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});

describe('Random names', () => {
  it('has at least 20 random names', () => {
    expect(RANDOM_FANTASY_NAMES.length).toBeGreaterThanOrEqual(20);
  });
});

describe('Random backgrounds', () => {
  it('has at least 8 random backgrounds', () => {
    expect(RANDOM_BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Random personalities', () => {
  it('has at least 6 random personalities', () => {
    expect(RANDOM_PERSONALITIES.length).toBeGreaterThanOrEqual(6);
  });
});

describe('Ability labels', () => {
  it('covers all six abilities', () => {
    const keys = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    for (const key of keys) {
      expect(ABILITY_LABELS[key as keyof typeof ABILITY_LABELS]).toBeDefined();
      expect(ABILITY_LABELS[key as keyof typeof ABILITY_LABELS].label.length).toBeGreaterThan(0);
    }
  });
});
