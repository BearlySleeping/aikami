// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts
//
// Onboarding-coordinator ViewModel tests.
//
// The coordinator receives its collaborators (campaign, persona, router, and
// the nested persona-create chat ViewModel) as typed capabilities, so these
// tests build plain doubles instead of mocking the global `$services` barrel.

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
  });

  test('starts in chat mode with the injected chat ViewModel', () => {
    const vm = createVm(harness);

    expect(vm.mode).toBe('chat');
    expect(vm.chatViewModel).toBeDefined();
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

  test('selectPreset assembles a persona and switches to review', async () => {
    const vm = createVm(harness);

    await vm.selectPreset(STARTER_HEROES[0]);

    expect(vm.mode).toBe('review');
    expect(harness.state.persona?.name).toBe(STARTER_HEROES[0].name);
    expect(vm.hasPersona).toBe(true);
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
