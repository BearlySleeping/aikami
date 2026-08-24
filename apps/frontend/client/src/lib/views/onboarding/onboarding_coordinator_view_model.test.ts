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
}));

// @aikami/constants resolves correctly via tsconfig paths — no mock needed

mock.module('@aikami/types', () => ({}));

mock.module('@aikami/frontend/engine', () => ({}));

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
  personaService: {
    updatePersona: mock(async () => {}),
    setActivePersona: mock(async () => {}),
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

  it('cannot set all scores to 15 (total budget enforced)', () => {
    const vm = getVM({ className: 'TestVM' });
    // Start from the standard array (sum = 72 = budget)
    vm.abilityScores = {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    };
    expect(vm.abilityScoreTotal).toBe(vm.abilityScoreBudget);
    // At budget, no further increases are allowed
    vm.adjustAbilityScore('charisma', 1);
    expect(vm.abilityScores.charisma).toBe(8);
  });

  it('allows increases while under the total budget', () => {
    const vm = getVM({ className: 'TestVM' });
    // All 10s = 60, budget 72 → 12 points of headroom
    vm.adjustAbilityScore('strength', 1);
    expect(vm.abilityScores.strength).toBe(11);
    expect(vm.abilityScoreTotal).toBe(61);
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
    // Override scores to known values to avoid shuffle randomness.
    // Keep the total (68) under the 72 budget so the +4 intelligence
    // increases below are allowed.
    vm.abilityScores = {
      strength: 15,
      dexterity: 13,
      constitution: 14,
      intelligence: 10,
      wisdom: 8,
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
});

describe('OnboardingCoordinatorViewModel — randomize', () => {
  it('fills all fields with non-empty values', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.randomizeCharacter();
    expect(vm.name.length).toBeGreaterThan(0);
    expect(vm.raceId.length).toBeGreaterThan(0);
    expect(vm.classId.length).toBeGreaterThan(0);
    expect(vm.alignment.length).toBeGreaterThan(0);
    expect(vm.appearanceDescription.length).toBeGreaterThan(0);
    expect(vm.background.length).toBeGreaterThan(0);
    expect(vm.personalityTraits.length).toBeGreaterThan(0);
  });

  it('uses valid race/class IDs', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.randomizeCharacter();
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
    vm.setRaceId('elf');
    const draft = JSON.parse(localStorage.getItem('aikami-onboarding-draft') ?? '{}');
    expect(draft.name).toBe('Eldrin');
    expect(draft.raceId).toBe('elf');
  });

  it('draft is recovered from localStorage', async () => {
    const preDraft = {
      step: 'play_style',
      name: 'RecoveryTest',
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

  it('_assemblePersonaFromStarter includes the hero LPC recipe', () => {
    const vm = getVM({ className: 'TestVM' });
    const internal = getInternal(vm);
    for (const hero of STARTER_HEROES) {
      const p = internal._assemblePersonaFromStarter(hero) as AssembledPersona;
      const appearance = p.appearance as Record<string, unknown> | undefined;
      const recipe = appearance?.lpcRecipe as Record<string, string> | undefined;
      expect(recipe).toBeDefined();
      expect(recipe?.head).toBe(hero.lpcRecipe.head);
      expect(recipe?.body).toBe(hero.lpcRecipe.body);
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

  it('_attachPersonaToCampaign persists persona to the stores the game reads', async () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('PersistHero');
    vm.setRaceId('human');
    vm.setClassId('fighter');
    const internal = getInternal(vm);
    const persona = internal._assemblePersonaFromDraft() as AssembledPersona;

    await internal._attachPersonaToCampaign(persona);

    // Written to the legacy `aikami-characters` list
    const stored = localStorage.getItem('aikami-characters');
    expect(stored).not.toBeNull();
    const characters = JSON.parse(stored ?? '[]') as Array<{ persona: { id: string } }>;
    expect(characters.some((c) => c.persona.id === persona.id)).toBe(true);

    // Persisted to the local personas table + marked active
    const { personaService } = await import('$services');
    expect(personaService.updatePersona).toHaveBeenCalled();
    expect(personaService.setActivePersona).toHaveBeenCalledWith(persona.id);
  });

  it('_attachPersonaToCampaign creates a campaign when none is active (refresh on /setup)', async () => {
    const { campaignService } = await import('$services');
    const original = campaignService.activeCampaign;
    // Simulate a refresh on /setup where no active campaign exists
    campaignService.activeCampaign = undefined;

    try {
      const vm = getVM({ className: 'TestVM' });
      vm.startCustom();
      vm.setName('RefreshHero');
      vm.setRaceId('human');
      vm.setClassId('fighter');
      const internal = getInternal(vm);
      const persona = internal._assemblePersonaFromDraft() as AssembledPersona;

      await internal._attachPersonaToCampaign(persona);

      expect(campaignService.startNewCampaign).toHaveBeenCalled();
    } finally {
      campaignService.activeCampaign = original;
    }
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

// ── LPC Appearance Tests (C-325) ─────────────────────────────────────

describe('OnboardingCoordinatorViewModel — LPC recipe defaults', () => {
  it('initializes with DEFAULT_LPC_RECIPE', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(Object.keys(vm.lpcRecipe).length).toBeGreaterThanOrEqual(6);
    expect(vm.lpcRecipe.head).toBe('head/heads/human_male');
    expect(vm.lpcRecipe.body).toBe('body/bodies_male');
  });

  it('paletteOverrides start empty', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(Object.keys(vm.paletteOverrides).length).toBe(0);
  });

  it('selectedPresetId starts undefined', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.selectedPresetId).toBeUndefined();
  });

  it('previewPlaying starts false', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.previewPlaying).toBe(false);
  });

  it('lpcPreviewRecipes returns recipes for all engine slots', () => {
    const vm = getVM({ className: 'TestVM' });
    const recipes = vm.lpcPreviewRecipes;
    expect(recipes.length).toBeGreaterThanOrEqual(6);
    for (const recipe of recipes) {
      expect(recipe.slot).toBeDefined();
      expect(recipe.assetId).toBeDefined();
      expect(recipe.hexPalette).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('OnboardingCoordinatorViewModel — LPC preset selection', () => {
  it('selectAppearancePreset applies all layers from preset', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p1');
    expect(vm.selectedPresetId).toBe('p1');
    expect(vm.lpcRecipe.head).toBe('head/heads/human_male');
    expect(vm.lpcRecipe.body).toBe('body/bodies_male');
    expect(vm.lpcRecipe.hair).toBe('hair/bangs_adult');
  });

  it('selectAppearancePreset applies paletteOverrides when present', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p2');
    expect(vm.selectedPresetId).toBe('p2');
    expect(vm.paletteOverrides.hair).toBe('C0C0C0');
  });

  it('selectAppearancePreset clears paletteOverrides when preset has none', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p2'); // has paletteOverrides
    vm.selectAppearancePreset('p1'); // no paletteOverrides
    expect(vm.selectedPresetId).toBe('p1');
    expect(Object.keys(vm.paletteOverrides).length).toBe(0);
  });

  it('selectAppearancePreset updates appearanceDescription', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p5');
    expect(vm.appearanceDescription).toBe('Desc5');
  });
});

describe('OnboardingCoordinatorViewModel — LPC layer setters', () => {
  it('setLpcLayer updates a single slot', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setLpcLayer('hair', 'hair/mohawk_adult');
    expect(vm.lpcRecipe.hair).toBe('hair/mohawk_adult');
  });

  it('setLpcLayer clears selectedPresetId', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p1');
    expect(vm.selectedPresetId).toBe('p1');
    vm.setLpcLayer('hair', 'hair/mohawk_adult');
    expect(vm.selectedPresetId).toBeUndefined();
  });

  it('setLpcLayer does not affect other slots', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p1');
    const originalBody = vm.lpcRecipe.body;
    vm.setLpcLayer('hair', 'hair/longhawk_adult');
    expect(vm.lpcRecipe.body).toBe(originalBody);
  });
});

describe('OnboardingCoordinatorViewModel — LPC palette overrides', () => {
  it('setPaletteOverride stores hex color', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setPaletteOverride('hair', 'FF44AA');
    expect(vm.paletteOverrides.hair).toBe('FF44AA');
  });

  it('setPaletteOverride updates lpcPreviewRecipes with palette LUT', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.setPaletteOverride('hair', 'FF44AA');
    const recipes = vm.lpcPreviewRecipes;
    const hairRecipe = recipes.find((r) => r.slot === 'hair');
    expect(hairRecipe).toBeDefined();
    if (hairRecipe) {
      // Palette LUT should contain FF, 44, AA, and opaque alpha (255)
      // Check first palette entry (offset 0)
      expect(hairRecipe.hexPalette[0]).toBe(0xff); // R
      expect(hairRecipe.hexPalette[1]).toBe(0x44); // G
      expect(hairRecipe.hexPalette[2]).toBe(0xaa); // B
      expect(hairRecipe.hexPalette[3]).toBe(255); // A
    }
  });

  it('setPaletteOverride clears selectedPresetId', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p1');
    expect(vm.selectedPresetId).toBe('p1');
    vm.setPaletteOverride('hair', 'AABBCC');
    expect(vm.selectedPresetId).toBeUndefined();
  });
});

describe('OnboardingCoordinatorViewModel — LPC toggle animation', () => {
  it('togglePreviewAnimation toggles previewPlaying', () => {
    const vm = getVM({ className: 'TestVM' });
    expect(vm.previewPlaying).toBe(false);
    vm.togglePreviewAnimation();
    expect(vm.previewPlaying).toBe(true);
    vm.togglePreviewAnimation();
    expect(vm.previewPlaying).toBe(false);
  });
});

describe('OnboardingCoordinatorViewModel — LPC draft persistence', () => {
  it('draft includes lpcRecipe after startCustom', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    const draft = JSON.parse(localStorage.getItem('aikami-onboarding-draft') ?? '{}');
    expect(draft.lpcRecipe).toBeDefined();
    expect(draft.lpcRecipe.head).toBe('head/heads/human_male');
  });

  it('draft includes paletteOverrides and selectedPresetId', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.selectAppearancePreset('p2');
    const draft = JSON.parse(localStorage.getItem('aikami-onboarding-draft') ?? '{}');
    expect(draft.selectedPresetId).toBe('p2');
    expect(draft.paletteOverrides.hair).toBe('C0C0C0');
  });

  it('draft recovery restores LPC recipe', async () => {
    const preDraft = {
      step: 'appearance' as const,
      name: 'LpcTest',
      raceId: 'human',
      classId: 'fighter',
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
      lpcRecipe: {
        head: 'head/heads/human_female',
        body: 'body/bodies_female',
        hair: 'hair/bob_adult',
      },
      paletteOverrides: { hair: 'FF0000' },
      selectedPresetId: 'test_preset',
    };
    localStorage.setItem('aikami-onboarding-draft', JSON.stringify(preDraft));
    const vm = getVM({ className: 'TestVM' });
    await vm.initialize();
    expect(vm.lpcRecipe.head).toBe('head/heads/human_female');
    expect(vm.lpcRecipe.hair).toBe('hair/bob_adult');
    expect(vm.paletteOverrides.hair).toBe('FF0000');
    expect(vm.selectedPresetId).toBe('test_preset');
  });

  it('draft recovery defaults to DEFAULT_LPC_RECIPE when lpcRecipe is missing', async () => {
    const preDraft = {
      step: 'appearance' as const,
      name: 'NoLpc',
      raceId: 'human',
      classId: 'fighter',
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
    localStorage.setItem('aikami-onboarding-draft', JSON.stringify(preDraft));
    const vm = getVM({ className: 'TestVM' });
    await vm.initialize();
    expect(vm.lpcRecipe.head).toBe('head/heads/human_male');
    expect(vm.lpcRecipe.body).toBe('body/bodies_male');
  });
});

describe('OnboardingCoordinatorViewModel — persona assembly with LPC', () => {
  it('_assemblePersonaFromDraft includes lpcRecipe in appearance', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.setName('LpcHero');
    vm.setRaceId('human');
    vm.setClassId('fighter');
    vm.selectAppearancePreset('p3');
    const internal = vm as unknown as Record<string, (...args: unknown[]) => unknown>;
    const persona = internal._assemblePersonaFromDraft() as {
      appearance?: Record<string, unknown>;
    };
    expect(persona.appearance?.lpcRecipe).toBeDefined();
    const recipe = persona.appearance?.lpcRecipe as Record<string, string>;
    expect(recipe.head).toBe('head/heads/human_male');
  });
});

describe('OnboardingCoordinatorViewModel — randomize includes LPC', () => {
  it('randomize applies preset LPC layers', () => {
    const vm = getVM({ className: 'TestVM' });
    vm.startCustom();
    vm.randomizeCharacter();
    // Should have a non-default LPC recipe (from a preset)
    expect(Object.keys(vm.lpcRecipe).length).toBeGreaterThanOrEqual(6);
    expect(vm.selectedPresetId).toBeDefined();
    // Each preset has defined lpcLayers
    const preset = vm.appearancePresets.find((p) => p.id === vm.selectedPresetId);
    expect(preset).toBeDefined();
    if (preset) {
      // Verify the recipe matches the preset
      expect(vm.lpcRecipe.head).toBe(preset.lpcLayers.head);
      expect(vm.lpcRecipe.body).toBe(preset.lpcLayers.body);
      expect(vm.lpcRecipe.hair).toBe(preset.lpcLayers.hair);
      // Verify palette overrides match if preset has them
      if (preset.paletteOverrides) {
        for (const [slot, color] of Object.entries(preset.paletteOverrides)) {
          expect(vm.paletteOverrides[slot]).toBe(color);
        }
      }
    }
  });
});
