// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts
//
// Onboarding-coordinator ViewModel tests.
//
// The coordinator receives its collaborators (campaign, persona, router, and
// the nested persona-create chat ViewModel) as typed capabilities, so these
// tests build plain doubles instead of mocking the global `$services` barrel.
//
// Covers the C-498 preset-first fast path plus the legacy migrations:
//   AC-1: default mode presents starter heroes as the primary affordance.
//   AC-2: selecting a preset opens a lightweight confirm (name + one
//         motivating choice) and enters the world WITHOUT the full sheet;
//         full editing is one explicit "customize everything" click away.

import { beforeEach, describe, expect, test } from 'bun:test';
import { STARTER_HEROES } from '@aikami/constants';
import type { Campaign, PersonaData } from '@aikami/types';
import { createPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';
import { createPersonaCreateHarness } from '$views/character/persona/create/testing/persona_create_fixtures.ts';
import {
  createOnboardingCoordinatorViewModel,
  type OnboardingCoordinatorViewModelInterface,
} from './onboarding_coordinator_view_model.svelte';

const campaign = (state: Campaign['state'] = 'creating'): Campaign => ({
  id: 'campaign-1',
  name: 'New Adventure',
  state,
  contentPackId: 'emberwatch',
  seed: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
});

type Harness = {
  state: {
    campaign: Campaign | undefined;
    persona: PersonaData | undefined;
    avatarUrl: string;
  };
  ops: {
    startNewCampaign: number;
    completeSetup: number;
    updatePersona: string[];
    setActivePersona: string[];
    routeCalls: string[];
  };
};

const createHarness = (): Harness => {
  const state: Harness['state'] = {
    campaign: undefined,
    persona: undefined,
    avatarUrl: '',
  };
  const ops: Harness['ops'] = {
    startNewCampaign: 0,
    completeSetup: 0,
    updatePersona: [],
    setActivePersona: [],
    routeCalls: [],
  };
  return { state, ops };
};

const createVm = (harness: Harness): OnboardingCoordinatorViewModelInterface => {
  const personaHarness = createPersonaCreateHarness();
  const chatViewModel = createPersonaCreateViewModel({
    className: 'PersonaCreateViewModel',
    ...personaHarness.capabilities,
  });

  return createOnboardingCoordinatorViewModel({
    className: 'OnboardingCoordinatorViewModel',
    campaign: {
      get activeCampaign() {
        return harness.state.campaign;
      },
      startNewCampaign: async () => {
        harness.ops.startNewCampaign++;
        const created = campaign();
        harness.state.campaign = created;
        return created;
      },
      completeSetup: () => {
        harness.ops.completeSetup++;
      },
    },
    personaCreation: {
      get persona() {
        return harness.state.persona;
      },
      set persona(value) {
        harness.state.persona = value;
      },
      get avatarUrl() {
        return harness.state.avatarUrl;
      },
    },
    personas: {
      updatePersona: async (personaId) => {
        harness.ops.updatePersona.push(personaId);
      },
      setActivePersona: async (personaId) => {
        harness.ops.setActivePersona.push(personaId);
      },
    },
    router: {
      goToRoute: async (route) => {
        harness.ops.routeCalls.push(route);
      },
    },
    chatViewModel,
  });
};

describe('OnboardingCoordinatorViewModel', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
    try {
      localStorage.removeItem('aikami-onboarding-draft');
    } catch {
      // best effort
    }
  });

  test('AC-1: default mode is presets with starter heroes primary', () => {
    const vm = createVm(harness);

    expect(vm.mode).toBe('presets');
    expect(vm.chatViewModel).toBeDefined();
    expect(vm.starterHeroes.map((hero) => hero.id)).toContain('starter_thaldrin');
  });

  test('AC-1: AI chat is a secondary path reachable via startChat', () => {
    const vm = createVm(harness);

    vm.startChat();

    expect(vm.mode).toBe('chat');
  });

  test('AC-2: selecting a preset opens the fast-path confirm, not the full sheet', async () => {
    const vm = createVm(harness);
    const thaldrin = STARTER_HEROES[0];

    await vm.selectPreset(thaldrin);

    expect(vm.mode).toBe('preset_confirm');
    expect(vm.selectedHero?.id).toBe(thaldrin.id);
    expect(vm.presetName).toBe(thaldrin.name);
    expect(vm.mode).not.toBe('review');
    expect(vm.persona).toBeDefined();
    expect(harness.state.persona?.name).toBe(thaldrin.name);
  });

  test('AC-2: confirmPresetAndEnter applies name + motivation and enters the world', async () => {
    harness.state.campaign = campaign();
    const vm = createVm(harness);
    await vm.selectPreset(STARTER_HEROES[0]);

    vm.setPresetName('Aldric the Bold');
    vm.setMotivation('redemption');

    await vm.confirmPresetAndEnter();

    expect(harness.state.persona?.name).toBe('Aldric the Bold');
    expect(harness.state.persona?.background).toBe(
      'Driven to atone for a past failure through heroic deeds.',
    );
    expect(harness.ops.routeCalls).toContain('game');
    expect(harness.ops.completeSetup).toBe(1);
    expect(vm.mode).not.toBe('review');
  });

  test('AC-2: "none" motivation keeps the preset background', async () => {
    harness.state.campaign = campaign();
    const vm = createVm(harness);
    const thaldrin = STARTER_HEROES[0];
    await vm.selectPreset(thaldrin);

    vm.setMotivation('none');
    await vm.confirmPresetAndEnter();

    expect(harness.state.persona?.background).toBe(thaldrin.background);
  });

  test('AC-2: fast-path confirmation requires a name and explicit known motivation', async () => {
    harness.state.campaign = campaign();
    const vm = createVm(harness);
    await vm.selectPreset(STARTER_HEROES[0]);

    expect(vm.canConfirmPreset).toBe(false);
    await vm.confirmPresetAndEnter();
    expect(harness.ops.routeCalls).toHaveLength(0);

    vm.setPresetName('   ');
    vm.setMotivation('unknown');
    expect(vm.canConfirmPreset).toBe(false);
    await vm.confirmPresetAndEnter();
    expect(harness.ops.routeCalls).toHaveLength(0);

    vm.setPresetName('Thaldrin');
    vm.setMotivation('none');
    expect(vm.canConfirmPreset).toBe(true);
  });

  test('AC-2: customizeEverything leaves the fast path for the full review sheet', async () => {
    const vm = createVm(harness);
    await vm.selectPreset(STARTER_HEROES[0]);

    vm.customizeEverything();

    expect(vm.mode).toBe('review');
  });

  test('AC-2: rename does not break the LPC appearance identity', async () => {
    const vm = createVm(harness);
    const thaldrin = STARTER_HEROES[0];
    await vm.selectPreset(thaldrin);

    vm.setPresetName('Renamed Hero');
    const persona = harness.state.persona as {
      appearance: { lpcRecipe: Record<string, string>; paletteOverrides: Record<string, string> };
    };
    expect(persona.appearance.lpcRecipe).toEqual(thaldrin.lpcRecipe);
    expect(persona.appearance.paletteOverrides).toEqual(thaldrin.paletteOverrides ?? {});
  });

  test('startCustom switches to the manual steps flow', () => {
    const vm = createVm(harness);

    vm.startCustom();

    expect(vm.mode).toBe('manual_steps');
    expect(vm.step).toBe('identity');
    expect(vm.hasDraft).toBe(true);
  });

  test('nextStep advances only when the identity form is valid', () => {
    const vm = createVm(harness);
    vm.startCustom();

    vm.nextStep();
    expect(vm.step).toBe('identity');

    vm.setName('Aria');
    vm.setRaceId(vm.speciesOptions[0].id);
    vm.nextStep();
    expect(vm.step).toBe('play_style');
  });

  test('adjustAbilityScore enforces the standard-array budget', () => {
    const vm = createVm(harness);
    vm.abilityScores = {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    };

    vm.adjustAbilityScore('strength', 1);
    expect(vm.abilityScores.strength).toBe(15);

    vm.adjustAbilityScore('charisma', -1);
    expect(vm.abilityScores.charisma).toBe(8);
  });

  test('confirmAndEnter persists the persona and routes to the game', async () => {
    harness.state.campaign = campaign();
    const vm = createVm(harness);
    await vm.selectPreset(STARTER_HEROES[0]);
    const personaId = harness.state.persona?.id;

    await vm.confirmAndEnter();

    expect(harness.ops.updatePersona).toContain(personaId);
    expect(harness.ops.setActivePersona).toContain(personaId);
    expect(harness.ops.completeSetup).toBe(1);
    expect(harness.ops.routeCalls).toContain('game');
  });

  test('backToChat returns to chat mode', () => {
    const vm = createVm(harness);
    vm.startCustom();

    vm.backToChat();

    expect(vm.mode).toBe('chat');
  });
});
