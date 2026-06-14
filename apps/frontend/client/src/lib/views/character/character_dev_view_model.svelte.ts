// apps/frontend/client/src/lib/views/character/character_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock data without hitting the AI backend.
// NEVER import this file from production code or non-(dev) routes.

import type { PersonaData } from '@aikami/types';
import { characterCreationService } from '$services';
import {
  CharacterViewModel,
  type CharacterViewModelOptions,
} from './character_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CHARACTER: PersonaData = {
  id: 'dev-mock-001',
  name: 'Lysandra Shadowmere',
  race: 'Half-Elf',
  class: 'Warlock',
  subclass: 'The Great Old One',
  level: 3,
  experiencePoints: 900,
  alignment: 'Chaotic Neutral',
  background:
    'A scholar who stumbled upon a forbidden tome and forged a pact with an eldritch entity.',
  abilityScores: {
    strength: 8,
    dexterity: 14,
    constitution: 12,
    intelligence: 16,
    wisdom: 10,
    charisma: 18,
  },
  hitPoints: 24,
  hitPointsMax: 24,
  temporaryHitPoints: 0,
  armorClass: 13,
  speed: 30,
  initiative: 2,
  proficiencyBonus: 2,
  skills: [
    { name: 'Arcana', ability: 'intelligence', isProficient: true, isExpertise: false },
    { name: 'Deception', ability: 'charisma', isProficient: true, isExpertise: false },
    { name: 'Investigation', ability: 'intelligence', isProficient: true, isExpertise: false },
    { name: 'Stealth', ability: 'dexterity', isProficient: true, isExpertise: false },
  ],
  savingThrows: [
    { ability: 'wisdom', isProficient: true, isExpertise: false },
    { ability: 'charisma', isProficient: true, isExpertise: false },
  ],
  proficiencies: ['Arcana', 'Deception', 'Investigation', 'Stealth'],
  languages: ['Common', 'Elvish', 'Deep Speech'],
  equipment: ['Arcane focus (crystal)', "Scholar's pack", 'Dagger', 'Leather armor'],
  inventory: ['Forbidden tome (locked)', 'Silver ring', 'Vial of ink', 'Parchment (5)'],
  personalityTraits:
    'I speak in riddles and often pause mid-sentence as if listening to whispers only I can hear.',
  ideals: 'Knowledge is power. The more secrets I uncover, the closer I get to true understanding.',
  bonds:
    'My patron whispers fragments of cosmic truth — I am both terrified and addicted to the revelations.',
  flaws: 'I trust no one completely. The voices have warned me about betrayal one too many times.',
  appearance: {
    physicalDescription:
      'A tall half-elf woman with pale skin, storm-gray eyes that seem to flicker with faint violet light, and long silver-white hair that moves as if touched by an unseen breeze.',
    distinguishingMarks:
      'Dark purple robes with silver embroidery depicting constellations and eldritch symbols.',
    age: '24',
    height: '5\'10"',
    weight: '135 lbs',
    eyeColor: 'Storm-gray with violet flecks',
    hairColor: 'Silver-white',
    skinColor: 'Pale ivory',
  },
  avatarUrl: 'https://placehold.co/400x400/2a1a4a/c9b8e8?text=Lysandra',
  isActive: true,
};

const MOCK_AVATAR_URL = 'https://placehold.co/400x400/2a1a4a/c9b8e8?text=Lysandra';

const MOCK_MESSAGES = [
  {
    role: 'system' as const,
    content: 'You are a Dungeon Master helping a player create a D&D 2024 character.',
  },
  {
    role: 'assistant' as const,
    content:
      'Welcome, brave adventurer! I am your Dungeon Master. Tell me — what kind of character do you envision?',
  },
  {
    role: 'user' as const,
    content:
      'I want to play a half-elf warlock who made a pact with a Great Old One after discovering a forbidden tome.',
  },
  {
    role: 'assistant' as const,
    content:
      'A fascinating concept! Half-elves make excellent warlocks, their dual heritage giving them both elven grace and human ambition. Tell me more about Lysandra — what drives her? Is she seeking power, knowledge, or perhaps she stumbled into this pact by accident?',
  },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CharacterDevViewModel extends CharacterViewModel {
  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.phase = 'CHAT';
    this.messages = [...MOCK_MESSAGES];
    await super.initialize();
  }

  // ── Dev: real AI-powered generation ─────────────────────────────────

  /** Triggers real AI-powered character generation (delegates to parent). */
  async dev(): Promise<void> {
    await super.generateCharacter();
  }

  /** Triggers mock character generation — bypasses AI entirely. */
  async mockGenerateCharacter(): Promise<void> {
    this.phase = 'GENERATING';

    await new Promise((resolve) => setTimeout(resolve, 800));

    characterCreationService.persona = { ...MOCK_CHARACTER };
    characterCreationService.avatarUrl = MOCK_AVATAR_URL;
    this.phase = 'TWEAK';
  }

  // ── Dev-only methods ──────────────────────────────────────────────────

  /** Sets the ViewModel into an error state, clearing all persona data. */
  forceErrorState(): void {
    this.phase = 'CHAT';
    this.errorMessage = 'Forced error state for testing.';
    characterCreationService.persona = undefined;
    characterCreationService.avatarUrl = '';
  }

  /** Injects deliberately malformed/junk data for edge-case testing. */
  injectJunkData(): void {
    this.phase = 'TWEAK';
    characterCreationService.persona = {
      id: 'junk-001',
      name: '',
      level: -1,
      experiencePoints: -1,
      hitPoints: 0,
      hitPointsMax: 0,
      temporaryHitPoints: 0,
      armorClass: -1,
      speed: -1,
      proficiencyBonus: -1,
      abilityScores: {
        strength: 0,
        dexterity: 0,
        constitution: 0,
        intelligence: 0,
        wisdom: 0,
        charisma: 0,
      },
      savingThrows: [],
      skills: [],
      proficiencies: [],
      languages: [],
      equipment: [],
      inventory: [],
      appearance: {
        physicalDescription: '',
        distinguishingMarks: '',
        age: '9999',
      },
      avatarUrl: '',
      isActive: false,
    };
    characterCreationService.avatarUrl = '';
  }
}

/**
 * Factory function — returns a CharacterDevViewModel with mock data.
 * Only use in (dev) routes or tests.
 */
export const getCharacterDevViewModel = (
  options: CharacterViewModelOptions,
): CharacterDevViewModel => {
  return new CharacterDevViewModel(options);
};
