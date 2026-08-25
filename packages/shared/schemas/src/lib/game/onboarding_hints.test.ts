// packages/shared/schemas/src/lib/game/onboarding_hints.test.ts
//
// Unit tests for OnboardingHintStepSchema — widened action shape, legacy
// normalisation, requiresModel field (C-422 AC-1).

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  OnboardingHintStepSchema,
  normaliseLegacyStep,
  type OnboardingHintStep,
} from './onboarding_hints.ts';

// ---------------------------------------------------------------------------
// Emberwatch manifest — must parse unchanged (legacy bare-string actions)
// ---------------------------------------------------------------------------

const LEGACY_STEPS = [
  { id: 'hint_move', action: 'move_up', text: 'Use {key} to move', trigger: 'map_loaded' },
  { id: 'hint_interact', action: 'interact', text: 'Press {key} to interact', trigger: 'near_interactable' },
  { id: 'hint_quest_log', action: 'open_quest_log', text: 'Press {key} for quest log', trigger: 'after_previous' },
  { id: 'hint_inventory', action: 'open_inventory', text: 'Press {key} for inventory', trigger: 'after_previous' },
  { id: 'hint_pause', action: 'open_menu', text: 'Press {key} to pause', trigger: 'after_previous' },
] as const;

describe('OnboardingHintStepSchema', () => {
  // ── Legacy bare-string action normalisation (AC-1) ──

  test('should parse legacy bare-string action and normalise to kind:input', () => {
    for (const step of LEGACY_STEPS) {
      const normalised = normaliseLegacyStep(step as Record<string, unknown>);
      const result = Value.Parse(OnboardingHintStepSchema, normalised);
      expect(result.action).toEqual({ kind: 'input', actionId: step.action });
    }
  });

  test('should parse legacy Emberwatch manifest without errors', () => {
    const section = { steps: [...LEGACY_STEPS] };
    const normalised = normaliseLegacyStep(section.steps[0] as Record<string, unknown>);
    const result = Value.Parse(OnboardingHintStepSchema, normalised);
    expect(result).toBeDefined();
    expect(result.id).toBe('hint_move');
  });

  test('normaliseLegacyStep should convert bare string to kind:input', () => {
    const normalised = normaliseLegacyStep({ id: 'test', action: 'interact', text: 'Test', trigger: 'map_loaded' });
    expect(normalised.action).toEqual({ kind: 'input', actionId: 'interact' });
  });

  test('normaliseLegacyStep should leave already-normalised steps unchanged', () => {
    const step = {
      id: 'test',
      action: { kind: 'input' as const, actionId: 'move_up' as const },
      text: 'Test',
      trigger: 'map_loaded' as const,
    };
    const normalised = normaliseLegacyStep(step);
    expect(normalised.action).toEqual({ kind: 'input', actionId: 'move_up' });
  });

  // ── New discriminated action shape (AC-1) ──

  test('should validate kind:input step', () => {
    const step = {
      id: 'hint_move',
      action: { kind: 'input', actionId: 'move_up' },
      text: 'Press {key} to move',
      trigger: 'map_loaded',
    };
    const result = Value.Parse(OnboardingHintStepSchema, step);
    expect(result.action).toEqual({ kind: 'input', actionId: 'move_up' });
  });

  test('should validate kind:event step', () => {
    const step = {
      id: 'hint_dialogue',
      action: { kind: 'event', eventId: 'npc_dialogue_opened' },
      text: 'Talk to an NPC to learn more',
      trigger: 'after_previous',
    };
    const result = Value.Parse(OnboardingHintStepSchema, step);
    expect(result.action).toEqual({ kind: 'event', eventId: 'npc_dialogue_opened' });
  });

  test('should reject invalid action kind', () => {
    const step = {
      id: 'hint_bad',
      action: { kind: 'unknown', actionId: 'move_up' },
      text: 'Bad',
      trigger: 'map_loaded',
    };
    expect(() => Value.Parse(OnboardingHintStepSchema, step)).toThrow();
  });

  test('should reject invalid input action id', () => {
    const step = {
      id: 'hint_bad',
      action: { kind: 'input', actionId: 'nonexistent_action' },
      text: 'Bad',
      trigger: 'map_loaded',
    };
    expect(() => Value.Parse(OnboardingHintStepSchema, step)).toThrow();
  });

  // ── requiresModel field (AC-5) ──

  test('should accept requiresModel: true', () => {
    const step = {
      id: 'hint_combat',
      action: { kind: 'event', eventId: 'combat_ended' },
      text: 'Win a combat encounter',
      trigger: 'after_previous',
      requiresModel: true,
    };
    const result = Value.Parse(OnboardingHintStepSchema, step);
    expect(result.requiresModel).toBe(true);
  });

  test('should default requiresModel to undefined when absent', () => {
    const step = {
      id: 'hint_move',
      action: { kind: 'input', actionId: 'move_up' },
      text: 'Move',
      trigger: 'map_loaded',
    };
    const result = Value.Parse(OnboardingHintStepSchema, step);
    expect(result.requiresModel).toBeUndefined();
  });

  // ── Trigger validation ──

  test('should reject invalid trigger value', () => {
    const step = {
      id: 'hint_bad',
      action: { kind: 'input', actionId: 'move_up' },
      text: 'Bad',
      trigger: 'invalid_trigger',
    };
    expect(() => Value.Parse(OnboardingHintStepSchema, step)).toThrow();
  });

  // ── TypeScript type check ──

  test('should produce correct TypeScript types', () => {
    const inputStep: OnboardingHintStep = {
      id: 'test',
      action: { kind: 'input', actionId: 'interact' },
      text: 'Press {key} to interact',
      trigger: 'map_loaded',
    };
    expect(inputStep.action.kind).toBe('input');

    const eventStep: OnboardingHintStep = {
      id: 'test2',
      action: { kind: 'event', eventId: 'npc_dialogue_opened' },
      text: 'Talk to NPCs',
      trigger: 'after_previous',
    };
    expect(eventStep.action.kind).toBe('event');
  });
});
