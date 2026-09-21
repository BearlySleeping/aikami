// apps/frontend/client/src/lib/views/dev/combat/faults/combat_debug_fault_gateway.test.ts
//
// Unit tests for the deterministic provider fault gateway: every simulated
// mode short-circuits with a typed failure recorded by request id, `real`
// delegates, and `usesProvider` is true only for `real`.
//
// Contract: combat debug workspace (execution prompt §6)
import { describe, expect, test } from 'bun:test';
import type { IntentInterpreterResult } from '@aikami/types';
import {
  COMBAT_DEBUG_FAULT_MODES,
  type CombatDebugFaultMode,
} from '../types/combat_debug_types.ts';
import {
  type CombatDebugIntentDelegate,
  type CombatDebugIntentRequest,
  createCombatDebugFaultGateway,
} from './combat_debug_fault_gateway.ts';

const request = (requestId: string): CombatDebugIntentRequest => ({
  requestId,
  intentId: `intent-${requestId}`,
  encounterId: 'emberwatch-encounter-1',
  actorId: 'player-hero',
  basedOnRevision: 0,
  text: 'attack the goblin',
  // The gateway never reads `state` in any simulated mode; an empty object is
  // sufficient and keeps the test independent of the kernel.
  state: {} as CombatDebugIntentRequest['state'],
});

const delegatedResult: IntentInterpreterResult = { ok: false, reason: 'refused' };

const makeDelegate = (
  overrides: Partial<CombatDebugIntentDelegate> = {},
): CombatDebugIntentDelegate => {
  const calls: string[] = [];
  return {
    async interpretWithFallback(incoming) {
      calls.push(incoming.requestId);
      return delegatedResult;
    },
    cancel() {},
    ...overrides,
  };
};

const simulatedModes = COMBAT_DEBUG_FAULT_MODES.filter(
  (mode): mode is Exclude<CombatDebugFaultMode, 'real'> => mode !== 'real',
);

describe('createCombatDebugFaultGateway: simulated modes', () => {
  test('every non-real mode returns a typed failure and records the request id', async () => {
    for (const mode of simulatedModes) {
      const gateway = createCombatDebugFaultGateway({ mode, delegate: undefined });
      const result = await gateway.interpretWithFallback(request(`req-${mode}`));
      expect(result.ok, mode).toBe(false);
      if (!result.ok) {
        expect(['refused', 'unparseable', 'ambiguous', 'hallucinated'], mode).toContain(
          result.reason,
        );
      }
      expect(gateway.shortCircuitedRequestIds, mode).toEqual([`req-${mode}`]);
    }
  });

  test('disabled and unavailable return a refusal', async () => {
    for (const mode of ['disabled', 'unavailable'] as const) {
      const gateway = createCombatDebugFaultGateway({ mode, delegate: undefined });
      await expect(gateway.interpretWithFallback(request('r1'))).resolves.toEqual({
        ok: false,
        reason: 'refused',
      });
    }
  });

  test('malformed returns an unparseable failure', async () => {
    const gateway = createCombatDebugFaultGateway({ mode: 'malformed', delegate: undefined });
    await expect(gateway.interpretWithFallback(request('r1'))).resolves.toEqual({
      ok: false,
      reason: 'unparseable',
    });
  });

  test('timeout and delayed-stale return typed failures with zero delay', async () => {
    const timeout = createCombatDebugFaultGateway({
      mode: 'timeout',
      delegate: undefined,
      timeoutMs: 0,
    });
    await expect(timeout.interpretWithFallback(request('timeout-1'))).resolves.toEqual({
      ok: false,
      reason: 'unparseable',
    });

    const delayed = createCombatDebugFaultGateway({
      mode: 'delayed-stale',
      delegate: undefined,
      delayMs: 0,
    });
    await expect(delayed.interpretWithFallback(request('delayed-1'))).resolves.toEqual({
      ok: false,
      reason: 'unparseable',
    });
  });

  test('records every short-circuited request id in order', async () => {
    const gateway = createCombatDebugFaultGateway({ mode: 'disabled', delegate: undefined });
    await gateway.interpretWithFallback(request('a'));
    await gateway.interpretWithFallback(request('b'));
    expect(gateway.shortCircuitedRequestIds).toEqual(['a', 'b']);
  });
});

describe('createCombatDebugFaultGateway: real mode', () => {
  test('delegates to the provided delegate', async () => {
    const calls: string[] = [];
    const delegate: CombatDebugIntentDelegate = {
      async interpretWithFallback(incoming) {
        calls.push(incoming.requestId);
        return delegatedResult;
      },
      cancel() {},
    };
    const gateway = createCombatDebugFaultGateway({ mode: 'real', delegate });
    const result = await gateway.interpretWithFallback(request('real-1'));
    expect(result).toEqual(delegatedResult);
    expect(calls).toEqual(['real-1']);
    expect(gateway.shortCircuitedRequestIds).toEqual([]);
  });

  test('without a delegate returns a refusal and records the request id', async () => {
    const gateway = createCombatDebugFaultGateway({ mode: 'real', delegate: undefined });
    await expect(gateway.interpretWithFallback(request('real-2'))).resolves.toEqual({
      ok: false,
      reason: 'refused',
    });
    expect(gateway.shortCircuitedRequestIds).toEqual(['real-2']);
  });

  test('cancel forwards to a delegate only in real mode', () => {
    const cancelled: string[] = [];
    const delegate = makeDelegate({ cancel: (id) => cancelled.push(id) });
    createCombatDebugFaultGateway({ mode: 'real', delegate }).cancel('c1');
    createCombatDebugFaultGateway({ mode: 'disabled', delegate }).cancel('c2');
    expect(cancelled).toEqual(['c1']);
  });

  test('cancel is a no-op without a delegate', () => {
    const gateway = createCombatDebugFaultGateway({ mode: 'real', delegate: undefined });
    expect(() => gateway.cancel('c1')).not.toThrow();
  });
});

describe('createCombatDebugFaultGateway: cancellation', () => {
  test('cancel settles a pending simulated timeout without waiting for its timer', async () => {
    const gateway = createCombatDebugFaultGateway({
      mode: 'timeout',
      delegate: undefined,
      timeoutMs: 60_000,
    });
    const result = gateway.interpretWithFallback(request('pending-timeout'));
    gateway.cancel('pending-timeout');
    await expect(result).resolves.toEqual({ ok: false, reason: 'refused' });
  });

  test('cancel settles a pending delayed-stale request', async () => {
    const gateway = createCombatDebugFaultGateway({
      mode: 'delayed-stale',
      delegate: undefined,
      delayMs: 60_000,
    });
    const result = gateway.interpretWithFallback(request('pending-stale'));
    gateway.cancel('pending-stale');
    await expect(result).resolves.toEqual({ ok: false, reason: 'refused' });
  });
});

describe('createCombatDebugFaultGateway: usesProvider', () => {
  test('is true only for real', () => {
    for (const mode of COMBAT_DEBUG_FAULT_MODES) {
      const gateway = createCombatDebugFaultGateway({ mode, delegate: undefined });
      expect(gateway.usesProvider, mode).toBe(mode === 'real');
      expect(gateway.mode, mode).toBe(mode);
    }
  });
});
