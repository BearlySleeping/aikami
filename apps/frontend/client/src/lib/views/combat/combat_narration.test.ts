// apps/frontend/client/src/lib/views/combat/combat_narration.test.ts
//
// C-525 (Combat-05) narration coverage.
//
//   AC-7  outcome narration derives only from `CombatEvent[]` and invents no
//         fact; attempt narration precedes resolution and claims no
//         success/damage/movement/death; narration never affects state
//
// Contract: C-525 AC-7

import { describe, expect, it } from 'bun:test';
import type { CombatEvent, CombatState } from '@aikami/types';
import { createCombatState } from '@aikami/utils';
import {
  AUTHORED_COMBAT_NARRATION,
  buildAttemptNarration,
  buildAttemptNarrationPrompt,
  buildOutcomeNarration,
  buildOutcomeNarrationPrompt,
  narrationFactsFromEvents,
} from './combat_narration';

// ── Fixtures ───────────────────────────────────────────────────────────────

const PLAYER = 'player-hero';
const GOBLIN = 'emberwatch:goblin-1';

const budget = {
  movementRemaining: 6,
  actionAvailable: true,
  quickActionAvailable: true,
  reactionAvailable: true,
};

const state = (): CombatState =>
  createCombatState({
    encounterId: 'emberwatch-encounter-1',
    rulesVersion: 'combat-2.0.0',
    seed: 1,
    combatants: [
      {
        combatantId: PLAYER,
        name: 'Hero',
        team: 'player',
        position: { x: 0, y: 0 },
        hp: 20,
        maxHp: 20,
        armorClass: 12,
        attackBonus: 5,
        initiative: 20,
        abilityIds: ['basic_melee'],
        budget,
        downed: false,
        defeated: false,
      },
      {
        combatantId: GOBLIN,
        name: 'Goblin Scout',
        team: 'enemy',
        position: { x: 1, y: 0 },
        hp: 12,
        maxHp: 12,
        armorClass: 13,
        attackBonus: 3,
        initiative: 10,
        abilityIds: ['basic_melee'],
        budget,
        downed: false,
        defeated: false,
      },
    ],
    abilityCatalog: {},
    battlefield: { width: 4, height: 4, blockedCells: [] },
    objectives: [],
  });

const envelope = {
  encounterId: 'emberwatch-encounter-1',
  turnId: 'r1:player-hero',
  stateRevision: 1,
  round: 1,
};

const attackEvent = (overrides: Record<string, unknown> = {}): CombatEvent =>
  ({
    ...envelope,
    kind: 'attackRolled',
    attackerId: PLAYER,
    targetId: GOBLIN,
    abilityId: 'basic_melee',
    naturalRoll: 18,
    totalRoll: 20,
    hit: true,
    isCriticalHit: false,
    ...overrides,
  }) as CombatEvent;

const damageEvent = (overrides: Record<string, unknown> = {}): CombatEvent =>
  ({
    ...envelope,
    kind: 'damageApplied',
    attackerId: PLAYER,
    targetId: GOBLIN,
    amount: 5,
    damageType: 'slashing',
    hpAfter: 7,
    downed: false,
    ...overrides,
  }) as CombatEvent;

// ── AC-7: attempt narration ────────────────────────────────────────────────

describe('buildAttemptNarration (AC-7)', () => {
  it('never claims a resolved outcome', () => {
    const outcomeWords =
      /\b(hits?|miss(?:es)?|deals?|damage|slain|killed|dies?|dead|downed|falls?|victory|defeat(?:ed)?|moves?)\b/i;
    for (const kind of ['ability', 'move', 'defend', 'wait', 'endTurn'] as const) {
      const text = buildAttemptNarration({ kind, actorName: 'Hero', targetName: 'Goblin Scout' });
      expect(text.length).toBeGreaterThan(0);
      expect(outcomeWords.test(text)).toBe(false);
    }
  });

  it('names the actor, ability and target without resolving them', () => {
    const text = buildAttemptNarration({
      kind: 'ability',
      actorName: 'Hero',
      targetName: 'Goblin Scout',
      abilityName: 'Basic Melee',
    });
    expect(text).toContain('Hero');
    expect(text).toContain('Basic Melee');
    expect(text).toContain('Goblin Scout');
  });

  it('has an authored offline template for every attempt kind', () => {
    for (const value of Object.values(AUTHORED_COMBAT_NARRATION.attempt)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('tells the model explicitly that nothing has resolved', () => {
    const prompt = buildAttemptNarrationPrompt({ kind: 'ability', actorName: 'Hero' });
    expect(prompt).toContain('Nothing has resolved yet');
  });
});

// ── AC-7: outcome narration ───────────────────────────────────────────────

describe('buildOutcomeNarration (AC-7)', () => {
  it('narrates only the events it was given', () => {
    const text = buildOutcomeNarration({ state: state(), events: [attackEvent(), damageEvent()] });
    expect(text).toContain('Hero');
    expect(text).toContain('Goblin Scout');
    expect(text).toContain('5 damage');
  });

  it('does not narrate damage when no damage event exists', () => {
    const text = buildOutcomeNarration({ state: state(), events: [attackEvent()] });
    expect(text).toContain('hits');
    expect(text).not.toContain('damage');
  });

  it('narrates a miss without any hit claim', () => {
    const text = buildOutcomeNarration({
      state: state(),
      events: [attackEvent({ hit: false, isCriticalHit: false })],
    });
    expect(text).toContain('misses');
    expect(text).not.toContain('hits');
  });

  it('narrates a critical hit as such', () => {
    const text = buildOutcomeNarration({
      state: state(),
      events: [attackEvent({ isCriticalHit: true })],
    });
    expect(text).toContain('critical');
  });

  it('returns nothing for events that carry no narration facts', () => {
    const empty = buildOutcomeNarration({ state: state(), events: [] });
    expect(empty).toBe('');
    const turnOnly = buildOutcomeNarration({
      state: state(),
      events: [{ ...envelope, kind: 'turnStarted', combatantId: PLAYER } as CombatEvent],
    });
    expect(turnOnly).toBe('');
  });

  it('narrates movement, defeat and the ended state from their events', () => {
    const events: CombatEvent[] = [
      {
        ...envelope,
        kind: 'movementCommitted',
        combatantId: PLAYER,
        path: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        movementCost: 7,
        movementRemaining: 4,
      } as CombatEvent,
      { ...envelope, kind: 'combatantDowned', combatantId: GOBLIN } as CombatEvent,
      { ...envelope, kind: 'combatantDefeated', combatantId: GOBLIN } as CombatEvent,
      {
        ...envelope,
        kind: 'combatEnded',
        victory: true,
        reason: 'allEnemiesDefeated',
      } as CombatEvent,
    ];
    const text = buildOutcomeNarration({ state: state(), events });
    expect(text).toContain('1 cells');
    expect(text).toContain('Goblin Scout is downed');
    expect(text).toContain('Goblin Scout falls');
    expect(text).toContain(AUTHORED_COMBAT_NARRATION.victory);
  });

  it('is deterministic and never touches state', () => {
    const snapshot = state();
    const before = JSON.stringify(snapshot);
    const events = [attackEvent(), damageEvent()];
    const first = buildOutcomeNarration({ state: snapshot, events });
    const second = buildOutcomeNarration({ state: snapshot, events });
    expect(first).toBe(second);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('derives facts 1:1 from events', () => {
    const facts = narrationFactsFromEvents([attackEvent(), damageEvent()]);
    expect(facts.attacks).toEqual([
      { attackerId: PLAYER, targetId: GOBLIN, hit: true, critical: false },
    ]);
    expect(facts.damages).toEqual([{ targetId: GOBLIN, amount: 5, damageType: 'slashing' }]);
    expect(facts.ended).toBeNull();
  });

  it('derives movement distance from the committed path rather than movement cost', () => {
    const facts = narrationFactsFromEvents([
      {
        ...envelope,
        kind: 'movementCommitted',
        combatantId: PLAYER,
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        movementCost: 9,
        movementRemaining: 3,
      } as CombatEvent,
    ]);
    expect(facts.movements).toEqual([{ combatantId: PLAYER, cells: 2 }]);
  });
});

// ── AC-7: outcome prompt carries facts only ────────────────────────────────

describe('buildOutcomeNarrationPrompt (AC-7)', () => {
  it('passes only the derived facts to the model, indexed for constrained claims', () => {
    const prompt = buildOutcomeNarrationPrompt({
      state: state(),
      events: [attackEvent(), damageEvent()],
    });
    // Display names, not raw ids: the model references facts by index, so it
    // never needs an id and none is exposed.
    expect(prompt).toContain('Goblin Scout');
    expect(prompt).toContain('damage[0]');
    // Dice faces, HP bookkeeping and revisions are not narration inputs.
    expect(prompt).not.toContain('naturalRoll');
    expect(prompt).not.toContain('hpAfter');
    expect(prompt).not.toContain('stateRevision');
    expect(prompt).not.toContain(GOBLIN);
    // The model is told it authors references and inert flavour only.
    expect(prompt).toContain('You may NOT invent mechanics');
    expect(prompt).toContain('flavor');
  });

  it('indexes every fact kind so a claim can be resolved by position', () => {
    const prompt = buildOutcomeNarrationPrompt({
      state: state(),
      events: [attackEvent(), damageEvent()],
    });
    expect(prompt).toContain('attack[0]:');
    expect(prompt).toContain('damage[0]:');
  });
});
