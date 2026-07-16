// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts
//
// Unit tests for OnboardingCoordinatorViewModel — state machine, persona
// assembly, ability score assignment, draft persistence, and step validation.
// Contract: C-319 Replace /setup with Fast Character Onboarding
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts
//
// biome-ignore-all lint/style/useNamingConvention: mock objects mirror PascalCase/snake_case constants from @aikami/constants

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// ── Svelte 5 runes polyfill (same as test_preload.ts) ──────────────────

(globalThis as Record<string, unknown>).$state = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.raw = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.snapshot = (value: unknown) => value;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;
const effectPolyfill = ((fn: () => void) => {
  fn();
}) as unknown as Record<string, unknown>;
effectPolyfill.root = (fn: () => void) => {
  fn();
  return () => {};
};
(globalThis as Record<string, unknown>).$effect = effectPolyfill;

// ── Mocks — must run before any imports that transitively touch $services ──

mock.module('@aikami/frontend/services', () => ({
  BaseFrontendClass: class {
    _options: { className: string };
    constructor(options: { className: string }) {
      this._options = options;
    }
    static create<O extends { className: string }>(this: new (o: O) => unknown, options: O) {
      return new this(options);
    }
    debug(..._args: unknown[]) {}
    info(..._args: unknown[]) {}
    log(..._args: unknown[]) {}
    warn(..._args: unknown[]) {}
    error(..._args: unknown[]) {}
  },
  BaseViewModel: class extends class {
    _options: { className: string };
    constructor(options: { className: string }) {
      this._options = options;
    }
    static create<O extends { className: string }>(this: new (o: O) => unknown, options: O) {
      return new this(options);
    }
    debug(..._args: unknown[]) {}
    info(..._args: unknown[]) {}
    log(..._args: unknown[]) {}
    warn(..._args: unknown[]) {}
    error(..._args: unknown[]) {}
  } {
    __mounted = false;
    errorMessage = undefined;
    get showLoadingView() {
      return false;
    }
    async initialize() {}
    async dispose() {}
    protected registerEffectRoot(_fn: () => void) {}
  },
  dialogService: {},
  routerService: { goToRoute: mock(async () => {}) },
  gameStateSyncService: {},
  firebaseAnalyticService: { logEvent: mock(async () => {}) },
}));

// Re-export constants directly (Bun test doesn't resolve tsconfig paths in worktree)
mock.module('@aikami/constants', () => ({
  ABILITY_LABELS: {
    strength: { label: 'STR', description: 'Physical power' },
    dexterity: { label: 'DEX', description: 'Agility' },
    constitution: { label: 'CON', description: 'Endurance' },
    intelligence: { label: 'INT', description: 'Reasoning' },
    wisdom: { label: 'WIS', description: 'Perception' },
    charisma: { label: 'CHA', description: 'Personality' },
  },
  APPEARANCE_PRESETS: [
    { id: 'p1', label: 'Preset1', description: 'Desc1' },
    { id: 'p2', label: 'Preset2', description: 'Desc2' },
    { id: 'p3', label: 'Preset3', description: 'Desc3' },
    { id: 'p4', label: 'Preset4', description: 'Desc4' },
    { id: 'p5', label: 'Preset5', description: 'Desc5' },
    { id: 'p6', label: 'Preset6', description: 'Desc6' },
    { id: 'p7', label: 'Preset7', description: 'Desc7' },
    { id: 'p8', label: 'Preset8', description: 'Desc8' },
  ],
  CLASS_PRESETS: [
    {
      id: 'fighter',
      label: 'Fighter',
      description: 'Martial combat',
      playStyleIds: ['melee'],
      primaryAbility: 'strength',
      secondaryAbility: 'constitution',
      suggestedEquipment: ['Sword'],
    },
    {
      id: 'wizard',
      label: 'Wizard',
      description: 'Arcane magic',
      playStyleIds: ['magic'],
      primaryAbility: 'intelligence',
      secondaryAbility: 'constitution',
      suggestedEquipment: ['Spellbook'],
    },
    {
      id: 'rogue',
      label: 'Rogue',
      description: 'Stealth',
      playStyleIds: ['stealth'],
      primaryAbility: 'dexterity',
      secondaryAbility: 'intelligence',
      suggestedEquipment: ['Dagger'],
    },
    {
      id: 'cleric',
      label: 'Cleric',
      description: 'Divine magic',
      playStyleIds: ['support'],
      primaryAbility: 'wisdom',
      secondaryAbility: 'strength',
      suggestedEquipment: ['Mace'],
    },
    {
      id: 'ranger',
      label: 'Ranger',
      description: 'Wilderness',
      playStyleIds: ['ranged'],
      primaryAbility: 'dexterity',
      secondaryAbility: 'wisdom',
      suggestedEquipment: ['Bow'],
    },
    {
      id: 'bard',
      label: 'Bard',
      description: 'Performer',
      playStyleIds: ['magic'],
      primaryAbility: 'charisma',
      secondaryAbility: 'dexterity',
      suggestedEquipment: ['Lute'],
    },
    {
      id: 'paladin',
      label: 'Paladin',
      description: 'Holy warrior',
      playStyleIds: ['melee'],
      primaryAbility: 'strength',
      secondaryAbility: 'charisma',
      suggestedEquipment: ['Sword'],
    },
    {
      id: 'druid',
      label: 'Druid',
      description: 'Nature priest',
      playStyleIds: ['magic'],
      primaryAbility: 'wisdom',
      secondaryAbility: 'constitution',
      suggestedEquipment: ['Staff'],
    },
  ],
  DND_STANDARD_ARRAY: [15, 14, 13, 12, 10, 8],
  ONBOARDING_STEPS: ['identity', 'play_style', 'appearance', 'review'],
  PLAY_STYLE_TAGS: [
    { id: 'melee', label: 'Melee', description: 'Melee' },
    { id: 'ranged', label: 'Ranged', description: 'Ranged' },
    { id: 'magic', label: 'Magic', description: 'Magic' },
    { id: 'support', label: 'Support', description: 'Support' },
    { id: 'stealth', label: 'Stealth', description: 'Stealth' },
    { id: 'social', label: 'Social', description: 'Social' },
  ],
  PRONOUN_SETS: [
    { id: 'he_him', subjective: 'he', objective: 'him', possessive: 'his', reflexive: 'himself' },
    { id: 'she_her', subjective: 'she', objective: 'her', possessive: 'her', reflexive: 'herself' },
    {
      id: 'they_them',
      subjective: 'they',
      objective: 'them',
      possessive: 'their',
      reflexive: 'themself',
    },
  ],
  RANDOM_BACKGROUNDS: ['BgA', 'BgB', 'BgC', 'BgD', 'BgE', 'BgF', 'BgG', 'BgH'],
  RANDOM_FANTASY_NAMES: [
    'N0',
    'N1',
    'N2',
    'N3',
    'N4',
    'N5',
    'N6',
    'N7',
    'N8',
    'N9',
    'N10',
    'N11',
    'N12',
    'N13',
    'N14',
    'N15',
    'N16',
    'N17',
    'N18',
    'N19',
    'N20',
    'N21',
    'N22',
    'N23',
    'N24',
  ],
  RANDOM_PERSONALITIES: ['PA', 'PB', 'PC', 'PD', 'PE', 'PF'],
  SPECIES_OPTIONS: [
    { id: 'human', label: 'Human', description: 'Human', suggestedClasses: ['fighter'] },
    { id: 'elf', label: 'Elf', description: 'Elf', suggestedClasses: ['wizard'] },
    { id: 'dwarf', label: 'Dwarf', description: 'Dwarf', suggestedClasses: ['fighter'] },
    { id: 'halfling', label: 'Halfling', description: 'Halfling', suggestedClasses: ['rogue'] },
    { id: 'tiefling', label: 'Tiefling', description: 'Tiefling', suggestedClasses: ['wizard'] },
    {
      id: 'dragonborn',
      label: 'Dragonborn',
      description: 'Dragonborn',
      suggestedClasses: ['paladin'],
    },
    { id: 'gnome', label: 'Gnome', description: 'Gnome', suggestedClasses: ['wizard'] },
    { id: 'half_orc', label: 'Half-Orc', description: 'Half-Orc', suggestedClasses: ['fighter'] },
  ],
  STARTER_HEROES: [
    {
      id: 'starter_thaldrin',
      name: 'Thaldrin',
      pronouns: {
        id: 'he_him',
        subjective: 'he',
        objective: 'him',
        possessive: 'his',
        reflexive: 'himself',
      },
      race: 'Human',
      class: 'Fighter',
      alignment: 'Lawful Good',
      abilityScores: {
        strength: 15,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 13,
        charisma: 8,
      },
      equipment: ['Longsword'],
      appearance: 'Tall',
      personalityTraits: 'Disciplined',
      background: 'Former guard',
      flavorText: 'Protector',
      illustrationAsset: 'test',
    },
    {
      id: 'starter_lyra',
      name: 'Lyra',
      pronouns: {
        id: 'she_her',
        subjective: 'she',
        objective: 'her',
        possessive: 'her',
        reflexive: 'herself',
      },
      race: 'Elf',
      class: 'Wizard',
      alignment: 'Neutral Good',
      abilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 15,
        wisdom: 13,
        charisma: 10,
      },
      equipment: ['Spellbook'],
      appearance: 'Slender',
      personalityTraits: 'Curious',
      background: 'Scholar',
      flavorText: 'Scholar',
      illustrationAsset: 'test',
    },
    {
      id: 'starter_zeph',
      name: 'Zeph',
      pronouns: {
        id: 'they_them',
        subjective: 'they',
        objective: 'them',
        possessive: 'their',
        reflexive: 'themself',
      },
      race: 'Tiefling',
      class: 'Rogue',
      alignment: 'Chaotic Good',
      abilityScores: {
        strength: 10,
        dexterity: 15,
        constitution: 12,
        intelligence: 13,
        wisdom: 8,
        charisma: 14,
      },
      equipment: ['Shortsword'],
      appearance: 'Lean',
      personalityTraits: 'Charming',
      background: 'Street urchin',
      flavorText: 'Scoundrel',
      illustrationAsset: 'test',
    },
  ],
}));

mock.module('@aikami/types', () => ({}));

mock.module('$app/navigation', () => ({
  goto: mock(async () => {}),
}));

mock.module('$services', () => ({
  campaignService: {
    activeCampaign: {
      id: 'test-campaign-id',
      state: 'creating',
      personaId: undefined,
      capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
    },
    startNewCampaign: mock(async () => ({ id: 'test-campaign-id', state: 'creating' })),
    completeSetup: mock(() => {}),
    loadCampaign: mock(async () => ({ id: 'test-campaign-id', state: 'playing' })),
  },
  routerService: {
    goToRoute: mock(async () => {}),
  },
  aiSettingsService: {
    textProvider: { apiKey: 'mock', endpoint: 'http://localhost:11434', model: 'llama3' },
    imageProvider: { apiKey: '', endpoint: '' },
    ttsProvider: { apiKey: '', endpoint: '' },
  },
}));

// ── Import constants directly (avoid @aikami aliases for worktree compat) ──

import {
  CLASS_PRESETS,
  DND_STANDARD_ARRAY,
  PRONOUN_SETS,
  STARTER_HEROES,
} from '../../../../../../../packages/shared/constants/src/lib/characters';

// ── Shape for assembled personas ────────────────────────────────────────

type AssembledPersona = Record<string, unknown> & {
  id: string;
  name: string;
  race?: string;
  class?: string;
  alignment?: string;
  abilityScores?: Record<string, number>;
  equipment?: string[];
  appearance?: { physicalDescription?: string };
  notes?: string;
  background?: string;
  personalityTraits?: string;
  hitPoints?: number;
  armorClass?: number;
  speed?: number;
};

// ── localStorage polyfill ───────────────────────────────────────────────

const _store = new Map<string, string>();

beforeEach(() => {
  _store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => _store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      _store.set(key, value);
    },
    removeItem: (key: string) => {
      _store.delete(key);
    },
    clear: () => {
      _store.clear();
    },
    key: () => null,
    get length() {
      return _store.size;
    },
  };
});

afterEach(() => {
  _store.clear();
  delete (globalThis as Record<string, unknown>).localStorage;
});

// ── Helpers ─────────────────────────────────────────────────────────────

type OnboardingCoordinatorViewModelInterface = Awaited<
  ReturnType<typeof import('./onboarding_coordinator_view_model.svelte')>
>['OnboardingCoordinatorViewModelInterface'];

type GetOnboardingCoordinatorViewModel = Awaited<
  ReturnType<typeof import('./onboarding_coordinator_view_model.svelte')>
>['getOnboardingCoordinatorViewModel'];

let getVM: GetOnboardingCoordinatorViewModel;

beforeEach(async () => {
  const mod = await import('./onboarding_coordinator_view_model.svelte');
  getVM = mod.getOnboardingCoordinatorViewModel;
});

/**
 * Accesses private methods on the ViewModel for white-box testing.
 */
const getInternal = (vm: OnboardingCoordinatorViewModelInterface) =>
  vm as unknown as Record<string, (...args: unknown[]) => unknown>;

// ── Tests ───────────────────────────────────────────────────────────────

describe('OnboardingCoordinatorViewModel — initial state', () => {
  it('starts in starter_select mode', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.mode).toBe('starter_select');
  });

  it('has default step as identity', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.step).toBe('identity');
  });

  it('exposes three starter heroes', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.starterHeroes.length).toBe(3);
  });

  it('defaults pronoun to he_him', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.pronounId).toBe('he_him');
  });

  it('defaults alignment to True Neutral', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.alignment).toBe('True Neutral');
  });

  it('defaults ability scores to 10 across all six abilities', () => {
    const vm = getVM({ className: 'TestVM' });
    const keys = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    for (const key of keys) {
      expect(vm.abilityScores[key]).toBe(10);
    }
  });
});

describe('OnboardingCoordinatorViewModel — step computation', () => {
  it('stepIndex returns 0 for identity step', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.stepIndex).toBe(0);
  });

  it('stepIndex returns correct index for each step after traversal', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    expect(vm.stepIndex).toBe(0);

    vm.setName('Test');
    vm.setRaceId('human');
    vm.nextStep();
    expect(vm.step).toBe('play_style');
    expect(vm.stepIndex).toBe(1);

    vm.setClassId('fighter');
    vm.nextStep();
    expect(vm.step).toBe('appearance');
    expect(vm.stepIndex).toBe(2);

    vm.nextStep();
    expect(vm.step).toBe('review');
    expect(vm.stepIndex).toBe(3);
  });
});

describe('OnboardingCoordinatorViewModel — canGoNext', () => {
  it('returns false in starter_select mode', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.canGoNext).toBe(false);
  });

  it('returns false with empty name', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    expect(vm.canGoNext).toBe(false);
  });

  it('returns false with name but no race', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Aria');
    expect(vm.canGoNext).toBe(false);
  });

  it('returns false for whitespace-only name', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('   ');
    vm.setRaceId('human');
    expect(vm.canGoNext).toBe(false);
  });

  it('returns true with valid name and race', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Aria');
    vm.setRaceId('elf');
    expect(vm.canGoNext).toBe(true);
  });

  it('returns false in play_style without class', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Aria');
    vm.setRaceId('elf');
    vm.nextStep();
    expect(vm.step).toBe('play_style');
    expect(vm.canGoNext).toBe(false);
  });
});

describe('OnboardingCoordinatorViewModel — step navigation', () => {
  it('startCustom sets mode to custom and step to identity', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    expect(vm.mode).toBe('custom');
    expect(vm.step).toBe('identity');
  });

  it('previousStep does not go below identity', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.previousStep();
    expect(vm.step).toBe('identity');
  });

  it('nextStep does not advance past review', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Aria');
    vm.setRaceId('elf');
    vm.nextStep();
    vm.setClassId('fighter');
    vm.nextStep();
    vm.nextStep();
    vm.nextStep();
    expect(vm.step).toBe('review');
  });

  it('full traversal identity → play_style → appearance → review', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Aria');
    vm.setRaceId('elf');
    vm.nextStep();
    expect(vm.step).toBe('play_style');
    vm.setClassId('wizard');
    vm.nextStep();
    expect(vm.step).toBe('appearance');
    vm.nextStep();
    expect(vm.step).toBe('review');
  });

  it('previousStep preserves state', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Thorn');
    vm.setRaceId('dwarf');
    vm.nextStep();
    vm.setClassId('cleric');
    vm.nextStep();
    vm.previousStep();
    expect(vm.step).toBe('play_style');
    expect(vm.name).toBe('Thorn');
    expect(vm.classId).toBe('cleric');
  });
});

describe('OnboardingCoordinatorViewModel — field setters', () => {
  it('setName updates name', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setName('Gandalf');
    expect(vm.name).toBe('Gandalf');
  });

  it('setPronounId updates pronoun', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setPronounId('she_her');
    expect(vm.pronounId).toBe('she_her');
  });

  it('setRaceId updates race', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setRaceId('tiefling');
    expect(vm.raceId).toBe('tiefling');
  });

  it('setClassId pre-fills ability scores', () => {
    const vm = getVM({ className: 'TestVM' });
    const fighter = CLASS_PRESETS.find((c) => c.id === 'fighter');
    if (!fighter) {
      throw new Error('fighter preset not found');
    }
    vm.setClassId('fighter');
    expect(vm.classId).toBe('fighter');
    expect(vm.abilityScores[fighter.primaryAbility]).toBe(DND_STANDARD_ARRAY[0]);
    expect(vm.abilityScores[fighter.secondaryAbility]).toBe(DND_STANDARD_ARRAY[1]);
  });

  it('setAppearanceDescription saves text', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setAppearanceDescription('Tall with silver hair');
    expect(vm.appearanceDescription).toBe('Tall with silver hair');
  });

  it('setBackground saves text', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setBackground('A wanderer from the north');
    expect(vm.background).toBe('A wanderer from the north');
  });

  it('setPersonalityTraits saves text', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setPersonalityTraits('Brave and reckless');
    expect(vm.personalityTraits).toBe('Brave and reckless');
  });
});

describe('OnboardingCoordinatorViewModel — ability scores', () => {
  it('adjustAbilityScore increments within bounds', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.abilityScores = { ...vm.abilityScores, strength: 12 };
    vm.adjustAbilityScore('strength', 1);
    expect(vm.abilityScores.strength).toBe(13);
  });

  it('adjustAbilityScore decrements within bounds', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.abilityScores = { ...vm.abilityScores, strength: 12 };
    vm.adjustAbilityScore('strength', -1);
    expect(vm.abilityScores.strength).toBe(11);
  });

  it('adjustAbilityScore does not go below 8', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.abilityScores = { ...vm.abilityScores, charisma: 8 };
    vm.adjustAbilityScore('charisma', -1);
    expect(vm.abilityScores.charisma).toBe(8);
  });

  it('adjustAbilityScore does not go above 15', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.abilityScores = { ...vm.abilityScores, dexterity: 15 };
    vm.adjustAbilityScore('dexterity', 1);
    expect(vm.abilityScores.dexterity).toBe(15);
  });
});

describe('OnboardingCoordinatorViewModel — standard array', () => {
  it('wizard: int=15, con=14', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setClassId('wizard');
    expect(vm.abilityScores.intelligence).toBe(15);
    expect(vm.abilityScores.constitution).toBe(14);
  });

  it('uses all six standard array values exactly once', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setClassId('rogue');
    const sorted = [...Object.values(vm.abilityScores)].sort((a, b) => b - a);
    expect(sorted).toEqual([15, 14, 13, 12, 10, 8]);
  });

  it('rogue: dex=15', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setClassId('rogue');
    expect(vm.abilityScores.dexterity).toBe(15);
  });

  it('cleric: wis=15, str=14', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setClassId('cleric');
    expect(vm.abilityScores.wisdom).toBe(15);
    expect(vm.abilityScores.strength).toBe(14);
  });

  it('does not overwrite manually adjusted scores on re-select', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setClassId('fighter');
    // Override scores to known values to avoid shuffle randomness
    vm.abilityScores = {
      strength: 15,
      dexterity: 13,
      constitution: 14,
      intelligence: 10,
      wisdom: 12,
      charisma: 8,
    };
    vm.adjustAbilityScore('intelligence', 2); // 10→12
    vm.adjustAbilityScore('intelligence', 2); // 12→14
    expect(vm.abilityScores.intelligence).toBe(14);
    vm.setClassId('wizard');
    vm.setClassId('fighter');
    expect(vm.abilityScores.intelligence).toBe(14);
  });
});

describe('OnboardingCoordinatorViewModel — computed selections', () => {
  it('selectedClass matches preset', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setClassId('bard');
    expect(vm.selectedClass?.id).toBe('bard');
    expect(vm.selectedClass?.label).toBe('Bard');
  });

  it('selectedClass undefined when empty', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.selectedClass).toBeUndefined();
  });

  it('selectedRace matches preset', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setRaceId('dragonborn');
    expect(vm.selectedRace?.id).toBe('dragonborn');
  });

  it('selectedRace undefined when empty', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.selectedRace).toBeUndefined();
  });

  it('selectedPronoun matches set', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.selectedPronoun?.id).toBe('he_him');
    vm.setPronounId('they_them');
    expect(vm.selectedPronoun?.id).toBe('they_them');
  });
});

describe('OnboardingCoordinatorViewModel — randomize', () => {
  it('fills all fields with non-empty values', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.randomizeCharacter();
    expect(vm.name.length).toBeGreaterThan(0);
    expect(vm.pronounId.length).toBeGreaterThan(0);
    expect(vm.raceId.length).toBeGreaterThan(0);
    expect(vm.classId.length).toBeGreaterThan(0);
    expect(vm.alignment.length).toBeGreaterThan(0);
    expect(vm.appearanceDescription.length).toBeGreaterThan(0);
    expect(vm.background.length).toBeGreaterThan(0);
    expect(vm.personalityTraits.length).toBeGreaterThan(0);
  });

  it('uses valid pronoun/race/class IDs', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.randomizeCharacter();
    const pronounIds = PRONOUN_SETS.map((p) => p.id);
    expect(pronounIds).toContain(vm.pronounId);
    expect(vm.selectedRace).toBeDefined();
    expect(vm.selectedClass).toBeDefined();
  });

  it('assigns valid standard array scores', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.randomizeCharacter();
    const sorted = [...Object.values(vm.abilityScores)].sort((a, b) => b - a);
    expect(sorted).toEqual([15, 14, 13, 12, 10, 8]);
  });
});

describe('OnboardingCoordinatorViewModel — draft persistence', () => {
  it('draft is saved to localStorage on startCustom', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setName('TestHero');
    vm.startCustom();
    const raw = localStorage.getItem('aikami-onboarding-draft');
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw ?? '{}');
    expect(draft.step).toBe('identity');
    expect(draft.name).toBe('TestHero');
  });

  it('draft is saved on field setter calls (mid-step persistence)', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('Eldrin');
    vm.setPronounId('they_them');
    vm.setRaceId('elf');
    const draft = JSON.parse(localStorage.getItem('aikami-onboarding-draft') ?? '{}');
    expect(draft.name).toBe('Eldrin');
    expect(draft.pronounId).toBe('they_them');
    expect(draft.raceId).toBe('elf');
  });

  it('draft is recovered from localStorage', async () => {
    const preDraft = {
      step: 'play_style',
      name: 'RecoveryTest',
      pronounId: 'she_her',
      pronounDisplay: 'she/her',
      raceId: 'human',
      classId: 'rogue',
      alignment: 'Chaotic Good',
      abilityScores: {
        strength: 10,
        dexterity: 15,
        constitution: 12,
        intelligence: 13,
        wisdom: 8,
        charisma: 14,
      },
      appearanceDescription: 'Sneaky',
      background: 'Thief',
      personalityTraits: 'Cunning',
      equipment: [],
    };
    localStorage.setItem('aikami-onboarding-draft', JSON.stringify(preDraft));
    const vm = getVM({ className: 'TestVM' });
    await vm.initialize();
    expect(vm.mode).toBe('custom');
    expect(vm.step).toBe('play_style');
    expect(vm.name).toBe('RecoveryTest');
    expect(vm.raceId).toBe('human');
    expect(vm.classId).toBe('rogue');
  });

  it('draft recovery rejects stale race/class IDs', async () => {
    const staleDraft = {
      step: 'review',
      name: 'Stale',
      pronounId: 'he_him',
      pronounDisplay: 'he/him',
      raceId: 'nonexistent_race',
      classId: 'wizard',
      alignment: 'Neutral',
      abilityScores: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
      appearanceDescription: '',
      background: '',
      personalityTraits: '',
      equipment: [],
    };
    localStorage.setItem('aikami-onboarding-draft', JSON.stringify(staleDraft));
    const vm = getVM({ className: 'TestVM' });
    await vm.initialize();
    expect(vm.mode).toBe('starter_select');
    expect(localStorage.getItem('aikami-onboarding-draft')).toBeNull();
  });
});

describe('OnboardingCoordinatorViewModel — persona assembly', () => {
  it('_assemblePersonaFromStarter creates Thaldrin correctly', () => {
    const vm = getVM({ className: 'TestVM' });
    const internal = getInternal(vm);
    const p = internal._assemblePersonaFromStarter(STARTER_HEROES[0]) as AssembledPersona;
    expect(p.id.length).toBeGreaterThan(0);
    expect(p.name).toBe('Thaldrin');
    expect(p.race).toBe('Human');
    expect(p.class).toBe('Fighter');
    expect(p.alignment).toBe('Lawful Good');
    expect(p.abilityScores?.strength).toBe(15);
    expect(p.equipment).toContain('Longsword');
    expect(p.notes).toContain('he/him');
  });

  it('_assemblePersonaFromStarter has required fields for all heroes', () => {
    const vm = getVM({ className: 'TestVM' });
    const internal = getInternal(vm);
    for (const hero of STARTER_HEROES) {
      const p = internal._assemblePersonaFromStarter(hero) as AssembledPersona;
      expect(p.id).toBeDefined();
      expect(p.name).toBeDefined();
      expect(p.hitPoints).toBeDefined();
      expect(p.armorClass).toBeDefined();
    }
  });

  it('_assemblePersonaFromDraft uses current state', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('CustomHero');
    vm.setRaceId('dwarf');
    vm.setClassId('paladin');
    vm.setAppearanceDescription('Golden beard');
    vm.setBackground('Exiled prince');
    vm.setPersonalityTraits('Honorable');
    const internal = getInternal(vm);
    const p = internal._assemblePersonaFromDraft() as AssembledPersona;
    expect(p.name).toBe('CustomHero');
    expect(p.race).toBe('Dwarf');
    expect(p.class).toBe('Paladin');
    expect(p.appearance?.physicalDescription).toBe('Golden beard');
    expect(p.background).toBe('Exiled prince');
    expect(p.personalityTraits).toBe('Honorable');
  });

  it('each starter hero produces a unique persona ID', () => {
    const vm = getVM({ className: 'TestVM' });
    const internal = getInternal(vm);
    const ids = STARTER_HEROES.map(
      (h) => (internal._assemblePersonaFromStarter(h) as AssembledPersona).id,
    );
    expect(new Set(ids).size).toBe(3);
  });
});

describe('OnboardingCoordinatorViewModel — mode transitions', () => {
  it('startSessionZero sets mode', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startSessionZero();
    expect(vm.mode).toBe('session_zero');
  });

  it('startCustom resets from session_zero', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startSessionZero();
    vm.startCustom();
    expect(vm.mode).toBe('custom');
  });
});

describe('OnboardingCoordinatorViewModel — hasDraft', () => {
  it('false with empty store', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.hasDraft).toBe(false);
  });

  it('true after startCustom saves a draft', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    expect(vm.hasDraft).toBe(true);
  });
});

describe('OnboardingCoordinatorViewModel — isConfirming gate', () => {
  it('starts false', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.isConfirming).toBe(false);
  });
});

describe('OnboardingCoordinatorViewModel — constant accessors', () => {
  it('8 class presets', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.classPresets.length).toBe(8);
  });

  it('8 species options', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.speciesOptions.length).toBe(8);
  });

  it('3 pronoun sets', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.pronounSets.length).toBe(3);
  });

  it('6 ability labels', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(Object.keys(vm.abilityLabels).length).toBe(6);
  });

  it('6 play-style tags', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.playStyleTags.length).toBe(6);
  });

  it('8 appearance presets', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.appearancePresets.length).toBe(8);
  });
});
