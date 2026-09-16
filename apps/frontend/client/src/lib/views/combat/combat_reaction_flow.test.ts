// apps/frontend/client/src/lib/views/combat/combat_reaction_flow.test.ts
//
// C-532 AC-4: Ask / Auto / Never policies, no default time limit, an optional
// player-enabled timer that records Decline, and a stale choice that spends
// nothing.
//
// Contract: C-532 AC-4

import { describe, expect, it } from 'bun:test';
import type { ReactionPolicy } from '@aikami/types';
import {
  type CombatReactionFlowDeps,
  getCombatReactionFlowViewModel,
  REACTION_COST_MESSAGE_KEY,
} from './combat_reaction_flow.svelte.ts';

const ENCOUNTER_ID = 'emberwatch-1';
const RUN_ID = 'run:emberwatch-1:7';
const WINDOW_ID = 'rw:move:player:1:0:1';
const HOUND = 'emberwatch:ash_hound';
const PLAYER = 'player';

const OPENED = {
  type: 'COMBAT_REACTION_OPENED',
  encounterId: ENCOUNTER_ID,
  encounterRunId: RUN_ID,
  windowId: WINDOW_ID,
  windowVersion: 1,
  initiatingCommandId: 'move:player:1',
  moverId: PLAYER,
  reactionId: 'reaction.opportunity_attack',
  currentReactorId: HOUND,
  reactorQueue: [HOUND],
  triggerCell: { x: 0, y: 0 },
  reactionPolicy: 'ask' as const,
  abilityId: 'opportunity_strike',
  committedCells: [{ x: 1, y: 0 }],
};

const harness = (
  options: { policies?: Record<string, ReactionPolicy>; timer?: number | null } = {},
) => {
  const listeners = new Map<string, Array<(event: never) => void>>();
  const sent: Array<Record<string, unknown>> = [];
  const bridge = {
    send: (command: unknown) => sent.push(command as Record<string, unknown>),
    on: (type: string, handler: (event: never) => void) => {
      const bucket = listeners.get(type) ?? [];
      bucket.push(handler);
      listeners.set(type, bucket);
      return () => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== handler),
        );
      };
    },
  };
  const deps: CombatReactionFlowDeps = {
    bridge: () => bridge as never,
    readEncounterId: () => ENCOUNTER_ID,
    readRevision: () => 4,
    displayNameFor: (combatantId) => (combatantId === HOUND ? 'Ash Hound' : 'Hero'),
    abilityNameFor: () => 'Opportunity Strike',
    translate: (key) => `cost:${key}`,
    policyFor: (combatantId) => options.policies?.[combatantId],
    optionalTimerSeconds: () => options.timer ?? null,
  };
  const flow = getCombatReactionFlowViewModel({
    ...deps,
    className: 'CombatReactionFlowTest',
  });
  const detach = flow.attach();
  return {
    flow,
    sent,
    emit: (type: string, payload: Record<string, unknown>) => {
      for (const handler of listeners.get(type) ?? []) {
        (handler as (event: unknown) => void)(payload);
      }
    },
    detach,
  };
};

describe('AC-4 Ask opens a decision surface', () => {
  it('shows the attacker, target, ability, cost and consequence', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    expect(h.flow.decision.status).toBe('awaiting_player');
    expect(h.flow.decision.prompt).toMatchObject({
      windowId: WINDOW_ID,
      windowVersion: 1,
      reactorId: HOUND,
      reactorName: 'Ash Hound',
      targetId: PLAYER,
      targetName: 'Hero',
      abilityId: 'opportunity_strike',
      abilityName: 'Opportunity Strike',
      costMessageKey: REACTION_COST_MESSAGE_KEY,
      policy: 'ask',
    });
    expect(h.flow.decision.prompt?.consequence).toContain('Ash Hound');
    expect(h.flow.decision.prompt?.consequence).toContain('Opportunity Strike');
    expect(h.flow.decision.prompt?.consequence).toContain('Hero');
    h.detach();
  });

  it('has NO default time limit', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    expect(h.flow.decision.secondsRemaining).toBeNull();
    h.detach();
  });

  it('sends nothing until the player chooses', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    expect(h.sent).toEqual([]);
    h.detach();
  });

  it('submits an accept with window identity, version, run identity and revision', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    h.flow.accept();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      type: 'COMBAT_REACTION_SELECTED',
      encounterId: ENCOUNTER_ID,
      encounterRunId: RUN_ID,
      windowId: WINDOW_ID,
      windowVersion: 1,
      reactorId: HOUND,
      choice: 'accept',
      source: 'player',
      basedOnRevision: 4,
    });
    h.detach();
  });

  it('declines through the Escape path with source `player`', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    h.flow.decline();
    expect(h.sent[0]).toMatchObject({ choice: 'decline', source: 'player' });
    h.detach();
  });

  it('ignores a second choice for the same window', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    h.flow.accept();
    h.flow.decline();
    expect(h.sent).toHaveLength(1);
    h.detach();
  });
});

describe('AC-4 optional player-enabled timer', () => {
  it('records the expiry as an external `timeout` input, not a provider timeout', () => {
    const h = harness({ timer: 1 });
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    expect(h.flow.decision.secondsRemaining).toBe(1);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]).toMatchObject({ choice: 'decline', source: 'timeout' });
        h.detach();
        resolve();
      }, 1200);
    });
  });

  it('does not run a timer when the player has not enabled one', () => {
    const h = harness({ timer: null });
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(h.sent).toEqual([]);
        expect(h.flow.decision.status).toBe('awaiting_player');
        h.detach();
        resolve();
      }, 1200);
    });
  });
});

describe('AC-4 Auto and Never policies', () => {
  it('auto accepts without showing the surface', () => {
    const h = harness({ policies: { [HOUND]: 'auto' } });
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    expect(h.flow.decision.status).toBe('resolved');
    expect(h.sent[0]).toMatchObject({ choice: 'accept', source: 'ai_policy' });
    h.detach();
  });

  it('never declines without showing the surface', () => {
    const h = harness({ policies: { [HOUND]: 'never' } });
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    expect(h.flow.decision.status).toBe('resolved');
    expect(h.sent[0]).toMatchObject({ choice: 'decline', source: 'ai_policy' });
    h.detach();
  });

  it('honours the event policy when the client has no override', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', { ...OPENED, reactionPolicy: 'never' });
    expect(h.sent[0]).toMatchObject({ choice: 'decline', source: 'ai_policy' });
    h.detach();
  });
});

describe('AC-4 invalidation', () => {
  it('clears the pending window when the encounter ends', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    h.emit('COMBAT_ENDED', { victory: true, reason: 'all_enemies_defeated' });
    expect(h.flow.decision).toMatchObject({ status: 'idle', prompt: null });
    h.flow.accept();
    expect(h.sent).toEqual([]);
    h.detach();
  });

  it('drops the prompt without spending when the kernel rejects the choice', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    h.flow.accept();
    h.emit('COMBAT_COMMAND_REJECTED', {
      commandType: 'COMBAT_REACTION_SELECTED',
      reasonCode: 'reactionStale',
      messageKey: 'x',
    });
    expect(h.flow.decision).toMatchObject({ status: 'idle', prompt: null });
    h.detach();
  });

  it('preserves an open reaction for an unrelated command rejection', () => {
    const h = harness({ timer: 5 });
    h.emit('COMBAT_REACTION_OPENED', OPENED);
    h.emit('COMBAT_COMMAND_REJECTED', {
      commandType: 'COMBAT_ACTION',
      reasonCode: 'reactionPending',
      messageKey: 'x',
    });
    expect(h.flow.decision).toMatchObject({
      status: 'awaiting_player',
      prompt: { windowId: WINDOW_ID },
      secondsRemaining: 5,
    });
    h.detach();
  });

  it('ignores a window with no current reactor', () => {
    const h = harness();
    h.emit('COMBAT_REACTION_OPENED', { ...OPENED, currentReactorId: null, reactorQueue: [] });
    expect(h.flow.decision.status).toBe('idle');
    h.detach();
  });
});
