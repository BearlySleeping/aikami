// apps/frontend/client/src/lib/services/game/combat_settlement_ledger.test.ts
//
// Review F7/F9: external combat consequences are EXACTLY ONCE from the game's
// point of view, and a delayed close callback from an old run cannot mutate a
// replacement encounter.
//
// The identity is the kernel's `settlementId` (encounter + EXECUTION RUN +
// revision + reason). Deliberately not the encounter id alone — it recurs on
// retry — and not the state revision alone — it recurs across runs.
//
// Contract: C-532 AC-5, C-334

import { describe, expect, it } from 'bun:test';
import { combatSettlementLedger } from './combat_settlement_ledger.svelte.ts';

/**
 * The PRODUCTION ledger, reset per case.
 *
 * A fresh instance would test the class; the singleton is what the game
 * actually uses, so exercising it is the stronger test.
 */
const ledger = () => {
  combatSettlementLedger.reset();
  return combatSettlementLedger;
};

describe('review F7: exactly-once settlement consequences', () => {
  it('claims a settlement once and refuses the duplicate', () => {
    const l = ledger();
    const id = 'settlement:emberwatch/proof:run:proof:1:7:hostile_group_routed';

    expect(l.claim(id)).toBe(true);
    expect(l.claim(id)).toBe(false);
    expect(l.claim(id)).toBe(false);
    expect(l.appliedSettlementIds).toContain(id);
  });

  it('a same-encounter RETRY is a different settlement identity', () => {
    // Same authored encounter id and same revision, different execution run.
    const first = 'settlement:emberwatch/proof:run:proof:1:7:hostile_group_routed';
    const retry = 'settlement:emberwatch/proof:run:proof:2:7:hostile_group_routed';
    const l = ledger();

    expect(l.claim(first)).toBe(true);
    // The retry legitimately re-earns its rewards.
    expect(l.claim(retry)).toBe(true);
  });

  it('survives a save/reload round trip', () => {
    const id = 'settlement:emberwatch/proof:run:proof:1:7:hostile_group_routed';
    const l = ledger();
    expect(l.claim(id)).toBe(true);

    // Serialize, then simulate the reload: a fresh process has an empty ledger
    // until it hydrates the save.
    const snapshot = l.serialize();
    l.reset();
    expect(l.appliedSettlementIds).toEqual([]);
    l.hydrate(snapshot);
    expect(l.appliedSettlementIds).toContain(id);
    // A re-presented terminal event after the reload applies nothing.
    expect(l.claim(id)).toBe(false);
  });

  it('ignores a malformed hydration payload instead of throwing', () => {
    const l = ledger();
    l.hydrate(null);
    expect(l.appliedSettlementIds).toEqual([]);
    l.hydrate({ appliedSettlementIds: 'not-an-array' });
    expect(l.appliedSettlementIds).toEqual([]);
    l.hydrate({ appliedSettlementIds: ['ok', 42, '', null] });
    expect(l.appliedSettlementIds).toEqual(['ok']);
  });

  it('bounds the ledger so a long campaign cannot grow the save without limit', () => {
    const l = ledger();
    for (let index = 0; index < 600; index++) {
      l.claim(`settlement-${index}`);
    }
    expect(l.appliedSettlementIds.length).toBeLessThanOrEqual(512);
    // The NEWEST settlements are retained — a duplicate delivery is far more
    // likely to re-present a recent one than the first fight of the campaign.
    expect(l.appliedSettlementIds).toContain('settlement-599');
    expect(l.appliedSettlementIds).not.toContain('settlement-0');
  });

  it('reset() clears the ledger (new campaign / test isolation)', () => {
    const l = ledger();
    l.claim('settlement-1');
    l.begin('run:1');
    l.reset();
    expect(l.appliedSettlementIds).toEqual([]);
    expect(l.activeIdentity()).toBeNull();
  });
});

describe('review F9: the run guard protects a replacement encounter', () => {
  it("encounter A's delayed close is inert once encounter B is active", () => {
    const l = ledger();
    // Encounter A is presented.
    l.begin('run:proof:1');
    const identityA = l.activeIdentity();
    expect(identityA).toBe('run:proof:1');
    expect(l.isActive(identityA)).toBe(true);

    // A ends and B starts BEFORE A's delayed close fires.
    l.end();
    l.begin('run:proof:2');

    // A's callback must be dropped; B owns the presentation.
    expect(l.isActive(identityA)).toBe(false);
    expect(l.isActive(l.activeIdentity())).toBe(true);
  });

  it('a same-authored-id retry is a different run for the guard', () => {
    const l = ledger();
    l.begin('run:proof:1');
    const first = l.activeIdentity();
    l.begin('run:proof:2');
    expect(l.isActive(first)).toBe(false);
  });

  it('a null identity is never active', () => {
    const l = ledger();
    l.begin(null);
    expect(l.isActive(null)).toBe(false);
    l.begin('run:1');
    expect(l.isActive(null)).toBe(false);
  });

  it('end() makes every outstanding callback inert', () => {
    const l = ledger();
    l.begin('run:1');
    const identity = l.activeIdentity();
    l.end();
    expect(l.isActive(identity)).toBe(false);
  });

  it('the run guard is NOT persisted (it is meaningless across a reload)', () => {
    const l = ledger();
    l.begin('run:1');
    const snapshot = l.serialize();
    expect(snapshot).toEqual({ appliedSettlementIds: [] });

    l.reset();
    l.hydrate(snapshot);
    expect(l.activeIdentity()).toBeNull();
  });
});
