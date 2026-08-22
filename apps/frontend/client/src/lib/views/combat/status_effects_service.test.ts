// apps/frontend/client/src/lib/views/combat/status_effects_service.test.ts
//
// Unit tests for the StatusEffectsService sub-service (C-425 / C-338).
// Verifies status apply/expire, death-save transitions, and reset behaviour.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/status_effects_service.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  getStatusEffectsService,
  type StatusEffectsServiceInterface,
} from './status_effects_service.svelte.ts';

const createService = (): StatusEffectsServiceInterface =>
  getStatusEffectsService({ className: 'StatusEffectsServiceTest' });

describe('StatusEffectsService (C-425)', () => {
  let svc: StatusEffectsServiceInterface;

  beforeEach(() => {
    svc = createService();
  });

  describe('applyStatus', () => {
    test('applies a status effect to the player (entity 1)', () => {
      svc.applyStatus({ effectId: 'poisoned', targetId: 1, duration: 3, sourceId: 2 });
      expect(svc.playerStatusEffects).toHaveLength(1);
      expect(svc.playerStatusEffects[0]?.effectId).toBe('poisoned');
      expect(svc.playerStatusEffects[0]?.remainingDuration).toBe(3);
      expect(svc.playerStatusEffects[0]?.sourceEntityId).toBe(2);
    });

    test('applies a status effect to an enemy keyed by entity id', () => {
      svc.applyStatus({ effectId: 'burning', targetId: 5, duration: 2, sourceId: 1 });
      expect(svc.enemyStatusEffects[5]).toHaveLength(1);
      expect(svc.enemyStatusEffects[5]?.[0]?.effectId).toBe('burning');
    });

    test('accumulates multiple effects on the same enemy', () => {
      svc.applyStatus({ effectId: 'burning', targetId: 5, duration: 2, sourceId: 1 });
      svc.applyStatus({ effectId: 'stunned', targetId: 5, duration: 1, sourceId: 1 });
      expect(svc.enemyStatusEffects[5]).toHaveLength(2);
    });
  });

  describe('expireStatus', () => {
    test('removes an effect from the player', () => {
      svc.applyStatus({ effectId: 'poisoned', targetId: 1, duration: 3, sourceId: 2 });
      svc.expireStatus('poisoned', 1);
      expect(svc.playerStatusEffects).toHaveLength(0);
    });

    test('removes an effect from an enemy without touching others', () => {
      svc.applyStatus({ effectId: 'burning', targetId: 5, duration: 2, sourceId: 1 });
      svc.applyStatus({ effectId: 'stunned', targetId: 5, duration: 1, sourceId: 1 });
      svc.expireStatus('burning', 5);
      expect(svc.enemyStatusEffects[5]).toHaveLength(1);
      expect(svc.enemyStatusEffects[5]?.[0]?.effectId).toBe('stunned');
    });
  });

  describe('death saves / downed', () => {
    test('setEntityDowned flags any-downed and initialises player death saves', () => {
      svc.setEntityDowned(1);
      expect(svc.isAnyEntityDowned).toBe(true);
      expect(svc.deathSaveState).toEqual({ successes: 0, failures: 0 });
    });

    test('setEntityDowned on an enemy does not initialise player death saves', () => {
      svc.setEntityDowned(5);
      expect(svc.isAnyEntityDowned).toBe(true);
      expect(svc.deathSaveState).toBeNull();
    });

    test('setDeathSave records cumulative outcomes', () => {
      svc.setDeathSave(1, 2);
      expect(svc.deathSaveState).toEqual({ successes: 1, failures: 2 });
    });

    test('revive clears downed and death-save state for the player', () => {
      svc.setEntityDowned(1);
      svc.revive(1);
      expect(svc.isAnyEntityDowned).toBe(false);
      expect(svc.deathSaveState).toBeNull();
    });

    test('revive only clears the revived entity from downed tracking', () => {
      svc.setEntityDowned(1);
      svc.setEntityDowned(5);
      expect(svc.isAnyEntityDowned).toBe(true);
      svc.revive(5);
      expect(svc.isAnyEntityDowned).toBe(true);
      expect(svc.deathSaveState).toEqual({ successes: 0, failures: 0 });
      svc.revive(1);
      expect(svc.isAnyEntityDowned).toBe(false);
      expect(svc.deathSaveState).toBeNull();
    });
  });

  describe('reset', () => {
    test('clears all state', () => {
      svc.applyStatus({ effectId: 'poisoned', targetId: 1, duration: 3, sourceId: 2 });
      svc.setEntityDowned(1);
      svc.reset();
      expect(svc.playerStatusEffects).toHaveLength(0);
      expect(svc.enemyStatusEffects).toEqual({});
      expect(svc.deathSaveState).toBeNull();
      expect(svc.isAnyEntityDowned).toBe(false);
    });
  });
});
