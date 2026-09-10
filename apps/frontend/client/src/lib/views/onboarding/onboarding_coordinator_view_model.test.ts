// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts
// biome-ignore-all lint/style/useNamingConvention: Mock object properties mirror PascalCase class names from @aikami/frontend-services
//
// Unit tests for OnboardingCoordinatorViewModel — the C-498 preset-first
// fast path. Covers:
//   AC-1: default mode presents starter heroes as the primary affordance.
//   AC-2: selecting a preset opens a lightweight confirm (name + one
//         motivating choice) and enters the world WITHOUT the full sheet;
//         full editing is one explicit "customize everything" click away.
//
// Run with:
//   bun run test:unit -- src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { STARTER_HEROES } from '@aikami/constants';

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let mockPersona: unknown;
let activeCampaign: { state: string; personaId?: string } = { state: 'creating' };
let goToRouteCalls = 0;
let completeSetupCalls = 0;

const _MOCK_SVC = '$lib/services/index.ts';

const _setupServiceOverrides = (): void => {
  mock.module(_MOCK_SVC, () => ({
    campaignService: {
      get activeCampaign() {
        return activeCampaign;
      },
      startNewCampaign: mock(async () => ({ id: 'camp-1', state: 'creating' })),
      completeSetup: mock(() => {
        completeSetupCalls++;
      }),
    },
    personaCreationService: {
      get persona() {
        return mockPersona;
      },
      set persona(value: unknown) {
        mockPersona = value;
      },
      get avatarUrl() {
        return '';
      },
    },
    personaService: {
      updatePersona: mock(async () => {}),
      setActivePersona: mock(async () => {}),
    },
    routerService: {
      goToRoute: mock(async () => {
        goToRouteCalls++;
      }),
    },
  }));
};

// The coordinator builds a chat sub-ViewModel at construction; stub it out.
mock.module('$views/character/persona/create/persona_create_view_model.svelte', () => ({
  getPersonaCreateViewModel: () => ({
    initialize: mock(async () => {}),
    dispose: mock(async () => {}),
  }),
}));

// Apply before importing the coordinator module.
_setupServiceOverrides();

type CoordinatorInterface =
  import('./onboarding_coordinator_view_model.svelte').OnboardingCoordinatorViewModelInterface;

async function loadVm(): Promise<CoordinatorInterface> {
  const mod = await import('./onboarding_coordinator_view_model.svelte');
  return mod.getOnboardingCoordinatorViewModel({ className: 'OnboardingCoordinatorViewModel' });
}

// ---------------------------------------------------------------------------
// Tests: C-498 — A preset means the character is ready
// ---------------------------------------------------------------------------

describe('OnboardingCoordinatorViewModel — C-498', () => {
  beforeEach(() => {
    mockPersona = undefined;
    activeCampaign = { state: 'creating' };
    goToRouteCalls = 0;
    completeSetupCalls = 0;
    _setupServiceOverrides();
    try {
      localStorage.removeItem('aikami-onboarding-draft');
    } catch {
      // best effort
    }
  });

  test('AC-1: default mode is presets with starter heroes primary', async () => {
    const vm = await loadVm();
    expect(vm.mode).toBe('presets');
    expect(vm.starterHeroes.length).toBeGreaterThanOrEqual(3);
    // Starter heroes are the primary affordance — the default view renders them.
    expect(vm.starterHeroes.map((h) => h.id)).toContain('starter_thaldrin');
  });

  test('AC-1: AI chat is a secondary path reachable via startChat', async () => {
    const vm = await loadVm();
    expect(vm.mode).toBe('presets');
    vm.startChat();
    expect(vm.mode).toBe('chat');
  });

  test('AC-2: selecting a preset opens the fast-path confirm, not the full sheet', async () => {
    const vm = await loadVm();
    const thaldrin = STARTER_HEROES[0];

    await vm.selectPreset(thaldrin);

    // Assembles a persona and lands on the lightweight confirm step.
    expect(vm.mode).toBe('preset_confirm');
    expect(vm.selectedHero?.id).toBe(thaldrin.id);
    expect(vm.presetName).toBe(thaldrin.name);
    // NOT the full editable review sheet.
    expect(vm.mode).not.toBe('review');
    expect(vm.persona).toBeDefined();
  });

  test('AC-2: confirmPresetAndEnter applies name + motivation and enters the world', async () => {
    const vm = await loadVm();
    const thaldrin = STARTER_HEROES[0];
    await vm.selectPreset(thaldrin);

    vm.setPresetName('Aldric the Bold');
    vm.setMotivation('redemption');

    await vm.confirmPresetAndEnter();

    // Persona reflects the fast-path edits.
    const persona = vm.persona as unknown as { name: string; background: string };
    expect(persona.name).toBe('Aldric the Bold');
    expect(persona.background.length).toBeGreaterThan(0);
    // World entry was reached without the full sheet being a required step.
    expect(goToRouteCalls).toBe(1);
    expect(completeSetupCalls).toBe(1);
    expect(vm.mode).not.toBe('review');
  });

  test('AC-2: "none" motivation keeps the preset background', async () => {
    const vm = await loadVm();
    const thaldrin = STARTER_HEROES[0];
    await vm.selectPreset(thaldrin);

    vm.setMotivation('none');
    await vm.confirmPresetAndEnter();

    const persona = vm.persona as unknown as { background: string };
    expect(persona.background).toBe(thaldrin.background);
  });

  test('AC-2: customizeEverything leaves the fast path for the full review sheet', async () => {
    const vm = await loadVm();
    await vm.selectPreset(STARTER_HEROES[0]);

    vm.customizeEverything();
    expect(vm.mode).toBe('review');
  });

  test('AC-2: rename does not break the LPC appearance identity', async () => {
    const vm = await loadVm();
    const thaldrin = STARTER_HEROES[0];
    await vm.selectPreset(thaldrin);

    vm.setPresetName('Renamed Hero');
    const persona = vm.persona as unknown as {
      appearance: { lpcRecipe: Record<string, string>; paletteOverrides: Record<string, string> };
    };
    // lpcRecipe/paletteOverrides travel with the persona regardless of the name.
    expect(persona.appearance.lpcRecipe).toEqual(thaldrin.lpcRecipe);
    expect(persona.appearance.paletteOverrides).toEqual(thaldrin.paletteOverrides ?? {});
  });
});
