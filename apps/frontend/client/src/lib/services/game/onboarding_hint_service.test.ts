// apps/frontend/client/src/lib/services/game/onboarding_hint_service.test.ts
// biome-ignore-all lint/style/useNamingConvention: trigger field names match OnboardingHintStepSchema
//
// Unit tests for OnboardingHintService — hint state machine, persistence,
// reset/replay, trigger-based hint sequencing, progress, skip, events.
// Contract: C-327 AC-3, AC-4; C-422 AC-2, AC-5

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// $state, $derived, @aikami/frontend/services mocks are provided by test_preload.ts

const BASIC_ONBOARDING = {
  steps: [
    {
      id: 'hint_move',
      action: { kind: 'input' as const, actionId: 'move_up' as const },
      text: 'Press {key} to move up',
      trigger: 'map_loaded' as const,
    },
    {
      id: 'hint_interact',
      action: { kind: 'input' as const, actionId: 'interact' as const },
      text: 'Press {key} to interact with objects and people',
      trigger: 'after_previous' as const,
    },
    {
      id: 'hint_inventory',
      action: { kind: 'input' as const, actionId: 'open_inventory' as const },
      text: 'Press {key} to open your inventory',
      trigger: 'after_previous' as const,
    },
  ],
};

const NEAR_INTERACTABLE_ONBOARDING = {
  steps: [
    {
      id: 'hint_move',
      action: { kind: 'input' as const, actionId: 'move_up' as const },
      text: 'Move up',
      trigger: 'map_loaded' as const,
    },
    {
      id: 'hint_near',
      action: { kind: 'input' as const, actionId: 'interact' as const },
      text: 'Interact with nearby objects',
      trigger: 'near_interactable' as const,
    },
  ],
};

const MIXED_ONBOARDING = {
  steps: [
    {
      id: 'hint_move',
      action: { kind: 'input' as const, actionId: 'move_up' as const },
      text: 'Press {key} to move up',
      trigger: 'map_loaded' as const,
    },
    {
      id: 'hint_dialogue',
      action: { kind: 'event' as const, eventId: 'npc_dialogue_opened' },
      text: 'Talk to an NPC to learn more',
      trigger: 'after_previous' as const,
    },
    {
      id: 'hint_combat',
      action: { kind: 'event' as const, eventId: 'combat_ended' },
      text: 'Win a combat encounter',
      trigger: 'after_previous' as const,
    },
  ],
};

describe('OnboardingHintService', () => {
  let service: import('./onboarding_hint_service.svelte.ts').OnboardingHintServiceInterface;
  const storageKey = 'aikami:onboarding:test-pack';

  beforeEach(async () => {
    localStorage.clear();

    const mod = await import('./onboarding_hint_service.svelte.ts');
    service = mod.onboardingHintService;

    // Load a basic onboarding section
    service.loadOnboarding({ packId: 'test-pack', onboarding: BASIC_ONBOARDING });
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Singleton ──

  test('should export singleton instance', () => {
    expect(service).toBeDefined();
    expect(typeof service.loadOnboarding).toBe('function');
    expect(typeof service.onActionPerformed).toBe('function');
  });

  // ── Load ──

  test('should set currentHint to first map_loaded hint on load', () => {
    expect(service.currentHint).toBeDefined();
    expect(service.currentHint?.id).toBe('hint_move');
    expect(service.currentHint?.action).toEqual({ kind: 'input', actionId: 'move_up' });
    expect(service.hintVisible).toBe(true);
  });

  test('should not be complete on initial load', () => {
    expect(service.isComplete).toBe(false);
  });

  // ── Action performed → learned (AC-3) ──

  test('should mark hint as learned and advance to next on action', () => {
    expect(service.currentHint?.id).toBe('hint_move');

    // Perform the taught action
    service.onActionPerformed('move_up');

    // Should advance to hint_interact
    expect(service.currentHint?.id).toBe('hint_interact');
    expect(service.hintVisible).toBe(true);
  });

  test('should not be affected by unrelated actions', () => {
    expect(service.currentHint?.id).toBe('hint_move');

    // Perform an action not taught by the current hint
    service.onActionPerformed('open_menu');

    // Current hint should still be 'hint_move'
    expect(service.currentHint?.id).toBe('hint_move');
    expect(service.hintVisible).toBe(true);
  });

  test('should complete after all hints learned', () => {
    service.onActionPerformed('move_up'); // learn hint_move → advance to hint_interact
    service.onActionPerformed('interact'); // learn hint_interact → advance to hint_inventory
    service.onActionPerformed('open_inventory'); // learn hint_inventory

    expect(service.isComplete).toBe(true);
    expect(service.currentHint).toBeUndefined();
    expect(service.hintVisible).toBe(false);
  });

  // ── near_interactable trigger (AC-3) ──

  test('should not show near_interactable hint until onInteractionTargetChanged', () => {
    service.loadOnboarding({ packId: 'near-pack', onboarding: NEAR_INTERACTABLE_ONBOARDING });

    // First hint (map_loaded) should show
    expect(service.currentHint?.id).toBe('hint_move');

    // Learn it
    service.onActionPerformed('move_up');

    // near_interactable hint should NOT show yet
    expect(service.currentHint).toBeUndefined();
    expect(service.hintVisible).toBe(false);

    // Trigger interaction target changed
    service.onInteractionTargetChanged();

    // Now it should show
    expect(service.currentHint?.id).toBe('hint_near');
    expect(service.hintVisible).toBe(true);
  });

  // ── Dismiss ──

  test('dismissCurrentHint should hide hint toast and advance to next hint', () => {
    expect(service.currentHint?.id).toBe('hint_move');
    expect(service.hintVisible).toBe(true);

    service.dismissCurrentHint();

    // After dismissal, the next eligible hint should be enqueued
    // hint_move was dismissed but not learned — _enqueuePendingHints will show it again
    expect(service.currentHint?.id).toBe('hint_move');
    expect(service.hintVisible).toBe(true);

    // Mark it as learned to advance
    service.onActionPerformed('move_up');

    // Should now show hint_interact
    expect(service.currentHint?.id).toBe('hint_interact');
    expect(service.hintVisible).toBe(true);
  });

  // ── Persistence (AC-4) ──

  test('should persist learned state to localStorage', () => {
    service.onActionPerformed('move_up');

    const raw = localStorage.getItem(storageKey);
    expect(raw).toBeDefined();
    if (!raw) {
      throw new Error('localStorage value was undefined');
    }
    const progress = JSON.parse(raw);
    expect(progress.packId).toBe('test-pack');
    expect(progress.learned.hint_move).toBe(true);
  });

  test('should restore learned state from localStorage on reload', () => {
    // Learn first two hints
    service.onActionPerformed('move_up');
    service.onActionPerformed('interact');

    // Simulate reload — create a new service load
    service.loadOnboarding({ packId: 'test-pack', onboarding: BASIC_ONBOARDING });

    // Should resume from hint_inventory (the third hint)
    expect(service.currentHint?.id).toBe('hint_inventory');
    expect(service.hintVisible).toBe(true);
  });

  test('completedAt should be set when all hints learned', () => {
    service.onActionPerformed('move_up');
    service.onActionPerformed('interact');
    service.onActionPerformed('open_inventory');

    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error('localStorage value was undefined');
    }
    const progress = JSON.parse(raw);
    expect(typeof progress.completedAt).toBe('number');
  });

  test('should be complete on reload if completedAt is present', () => {
    service.onActionPerformed('move_up');
    service.onActionPerformed('interact');
    service.onActionPerformed('open_inventory');
    expect(service.isComplete).toBe(true);

    // Reload
    service.loadOnboarding({ packId: 'test-pack', onboarding: BASIC_ONBOARDING });
    expect(service.isComplete).toBe(true);
    expect(service.currentHint).toBeUndefined();
    expect(service.hintVisible).toBe(false);
  });

  // ── Reset / Replay (AC-4) ──

  test('resetOnboarding should clear learned state and re-enqueue first hint', () => {
    // Learn all hints
    service.onActionPerformed('move_up');
    service.onActionPerformed('interact');
    service.onActionPerformed('open_inventory');
    expect(service.isComplete).toBe(true);

    // Reset
    service.resetOnboarding();

    expect(service.isComplete).toBe(false);
    expect(service.currentHint?.id).toBe('hint_move');
    expect(service.hintVisible).toBe(true);

    // localStorage should reflect reset
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error('localStorage value was undefined');
    }
    const progress = JSON.parse(raw);
    expect(progress.learned).toEqual({});
    expect(progress.completedAt).toBeUndefined();
  });

  // ── Edge cases ──

  test('should be no-op when performing actions after completion', () => {
    service.onActionPerformed('move_up');
    service.onActionPerformed('interact');
    service.onActionPerformed('open_inventory');
    expect(service.isComplete).toBe(true);

    // Should not throw
    expect(() => service.onActionPerformed('move_up')).not.toThrow();
    expect(service.isComplete).toBe(true);
  });

  test('should handle loading onboarding with no steps gracefully', () => {
    expect(() =>
      service.loadOnboarding({ packId: 'empty-pack', onboarding: { steps: [] } }),
    ).not.toThrow();
  });

  // ── stepIndex / totalSteps (C-422 AC-2) ──

  test('should expose stepIndex and totalSteps', () => {
    expect(service.totalSteps).toBe(3);
    expect(service.stepIndex).toBe(0); // hint_move is at index 0

    service.onActionPerformed('move_up');
    expect(service.stepIndex).toBe(1); // hint_interact is at index 1

    service.onActionPerformed('interact');
    expect(service.stepIndex).toBe(2); // hint_inventory is at index 2
  });

  test('stepIndex should be -1 when no hint is active', () => {
    service.loadOnboarding({ packId: 'empty-pack', onboarding: { steps: [] } });
    expect(service.stepIndex).toBe(-1);
  });

  test('totalSteps should be 0 for empty onboarding', () => {
    service.loadOnboarding({ packId: 'empty-pack', onboarding: { steps: [] } });
    expect(service.totalSteps).toBe(0);
  });

  // ── skipOnboarding (C-422 AC-2) ──

  test('skipOnboarding should mark all steps as learned and complete', () => {
    expect(service.isComplete).toBe(false);

    service.skipOnboarding();

    expect(service.isComplete).toBe(true);
    expect(service.currentHint).toBeUndefined();
    expect(service.hintVisible).toBe(false);

    // Should persist
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      throw new Error('localStorage value was undefined');
    }
    const progress = JSON.parse(raw);
    expect(progress.learned.hint_move).toBe(true);
    expect(progress.learned.hint_interact).toBe(true);
    expect(progress.learned.hint_inventory).toBe(true);
    expect(typeof progress.completedAt).toBe('number');
  });

  test('skipOnboarding should be idempotent', () => {
    service.skipOnboarding();
    expect(service.isComplete).toBe(true);

    // Should not throw on second call
    expect(() => service.skipOnboarding()).not.toThrow();
    expect(service.isComplete).toBe(true);
  });

  // ── onEventPerformed (C-422 AC-2) ──

  test('onEventPerformed should advance through event steps', () => {
    service.loadOnboarding({ packId: 'mixed-pack', onboarding: MIXED_ONBOARDING });

    // First hint is input (move_up)
    expect(service.currentHint?.id).toBe('hint_move');
    expect(service.currentHint?.action).toEqual({ kind: 'input', actionId: 'move_up' });

    // Learn it
    service.onActionPerformed('move_up');

    // Second hint is event (npc_dialogue_opened)
    expect(service.currentHint?.id).toBe('hint_dialogue');
    expect(service.currentHint?.action).toEqual({ kind: 'event', eventId: 'npc_dialogue_opened' });

    // Fire the event
    service.onEventPerformed('npc_dialogue_opened');

    // Third hint is event (combat_ended)
    expect(service.currentHint?.id).toBe('hint_combat');

    // Fire the event
    service.onEventPerformed('combat_ended');

    expect(service.isComplete).toBe(true);
  });

  test('onEventPerformed should not affect input hints', () => {
    service.loadOnboarding({ packId: 'mixed-pack', onboarding: MIXED_ONBOARDING });

    // Current hint is input — firing an unrelated event should do nothing
    service.onEventPerformed('combat_ended');
    expect(service.currentHint?.id).toBe('hint_move');
  });

  test('onActionPerformed should not affect event hints', () => {
    service.loadOnboarding({ packId: 'mixed-pack', onboarding: MIXED_ONBOARDING });

    // Advance past the first input hint
    service.onActionPerformed('move_up');

    // Now on event hint — performing an action should do nothing
    service.onActionPerformed('interact');
    expect(service.currentHint?.id).toBe('hint_dialogue');
  });

  test('onEventPerformed should be no-op after completion', () => {
    service.loadOnboarding({ packId: 'mixed-pack', onboarding: MIXED_ONBOARDING });

    service.onActionPerformed('move_up');
    service.onEventPerformed('npc_dialogue_opened');
    service.onEventPerformed('combat_ended');
    expect(service.isComplete).toBe(true);

    expect(() => service.onEventPerformed('combat_ended')).not.toThrow();
  });
});
