// apps/frontend/client/src/lib/views/combat/combat_ai_events.test.ts
//
// C-526 (Combat-06) ViewModel coverage for AI presentation (AC-7).
//
// The engine emits `COMBAT_INTENT_TELEGRAPHED` (a bounded, authored intention
// line for an AI actor) and `COMBAT_AI_DEGRADED` (the AI layer fell back).
// These assertions pin the half the engine cannot own: the UI surfaces both,
// attributes them to the acting combatant, and adds no mechanics — no command
// is ever sent because of either event.
//
// The harness injects a recording bridge double and calls the production
// listener registration — no engine, no overlay, no network, no model.
//
// Contract: C-526 AC-7

import { beforeEach, describe, expect, test } from 'bun:test';
import type { GameEvent } from '@aikami/frontend/engine';
import { type CombatViewModelOptions, createCombatViewModel } from './combat_view_model.svelte.ts';
import { createCombatTestOptions } from './testing/combat_fixtures.ts';

// ── Fixtures ───────────────────────────────────────────────────────────────

const GOBLIN = 'emberwatch:goblin-1';
const COMPANION = 'emberwatch:companion-1';

type BridgeDouble = {
  send: (command: Record<string, unknown>) => void;
  on: (type: string, handler: (event: never) => void) => () => void;
};

const createHarness = (overrides: Partial<CombatViewModelOptions> = {}) => {
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, (event: never) => void>();
  const bridge: BridgeDouble = {
    send: (command) => {
      sent.push(command);
    },
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {};
    },
  };
  const viewModel = createCombatViewModel(createCombatTestOptions(overrides));
  (viewModel as unknown as { _bridge: BridgeDouble })._bridge = bridge;
  (viewModel as unknown as { _registerListeners: () => void })._registerListeners();

  const emit = (event: GameEvent): void => {
    const handler = handlers.get(event.type);
    if (handler) {
      (handler as (value: GameEvent) => void)(event);
    }
  };
  return { viewModel, sent, emit };
};

/** Publishes the engine's own display names, the way a resolved turn does. */
const publishNames = (target: ReturnType<typeof createHarness>, names: Record<string, string>) => {
  target.emit({ type: 'COMBAT_EVENTS_RESOLVED', events: [], names } as unknown as GameEvent);
};

let harness: ReturnType<typeof createHarness>;

beforeEach(() => {
  harness = createHarness();
});

// ── AC-7: readable intent ──────────────────────────────────────────────────

describe('C-526 AC-7: an AI intention is readable', () => {
  test('a telegraph is surfaced with the acting combatant name', () => {
    publishNames(harness, { [GOBLIN]: 'Goblin Scout' });
    harness.emit({
      type: 'COMBAT_INTENT_TELEGRAPHED',
      encounterId: 'emberwatch/proof_encounter',
      actorId: GOBLIN,
      line: 'preparing an attack on Hero',
    } as unknown as GameEvent);

    const entry = harness.viewModel.combatLog[0];
    expect(entry?.actor).toBe('Goblin Scout');
    expect(entry?.actionText).toContain('preparing an attack on Hero');
  });

  test('an unnamed actor falls back to its engine id, never another name', () => {
    publishNames(harness, { [GOBLIN]: 'Goblin Scout' });
    harness.emit({
      type: 'COMBAT_INTENT_TELEGRAPHED',
      encounterId: 'emberwatch/proof_encounter',
      actorId: COMPANION,
      line: 'manoeuvring for position',
    } as unknown as GameEvent);

    expect(harness.viewModel.combatLog[0]?.actor).toBe(COMPANION);
  });

  test('an empty telegraph line adds nothing to the log', () => {
    harness.emit({
      type: 'COMBAT_INTENT_TELEGRAPHED',
      encounterId: 'emberwatch/proof_encounter',
      actorId: GOBLIN,
      line: '',
    } as unknown as GameEvent);

    expect(harness.viewModel.combatLog).toHaveLength(0);
  });

  test('a telegraph commits no command', () => {
    publishNames(harness, { [GOBLIN]: 'Goblin Scout' });
    // The ViewModel's own registration traffic (sync request) is not the
    // subject: only what these events add is.
    const before = harness.sent.length;
    harness.emit({
      type: 'COMBAT_INTENT_TELEGRAPHED',
      encounterId: 'emberwatch/proof_encounter',
      actorId: GOBLIN,
      line: 'bracing for the next blow',
    } as unknown as GameEvent);

    expect(harness.sent.slice(before)).toEqual([]);
  });
});

// ── AC-7: degradation is visible ───────────────────────────────────────────

describe('C-526 AC-7: degradation is visible', () => {
  const labelFor = {
    disabled: 'agent layer off',
    offline: 'no model available',
    timeout: 'model timed out',
    invalid: 'model reply unusable',
    stale: 'decision out of date',
  } as const;

  test.each(Object.keys(labelFor) as Array<keyof typeof labelFor>)(
    'the "%s" reason reaches the log with readable wording',
    (reason) => {
      publishNames(harness, { [GOBLIN]: 'Goblin Scout' });
      harness.emit({
        type: 'COMBAT_AI_DEGRADED',
        encounterId: 'emberwatch/proof_encounter',
        actorId: GOBLIN,
        reason,
      } as unknown as GameEvent);

      const entry = harness.viewModel.combatLog[0];
      expect(entry?.actor).toBe('Goblin Scout');
      // The reason is engine telemetry made readable. Every reason ends on the
      // same deterministic planner, so the entry must never imply a rules
      // change — only that the model is out of the loop.
      expect(entry?.actionText).toBe(`Deterministic AI — ${labelFor[reason]}`);
    },
  );

  test('degradation commits no command either', () => {
    const before = harness.sent.length;
    harness.emit({
      type: 'COMBAT_AI_DEGRADED',
      encounterId: 'emberwatch/proof_encounter',
      actorId: GOBLIN,
      reason: 'timeout',
    } as unknown as GameEvent);

    expect(harness.sent.slice(before)).toEqual([]);
  });
});
