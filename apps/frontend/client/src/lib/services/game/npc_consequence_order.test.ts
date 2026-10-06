// apps/frontend/client/src/lib/services/game/npc_consequence_order.test.ts
import { expect, test } from 'bun:test';
import type { NpcStateDelta } from '@aikami/types';
import { compareConsequenceDeltas } from './npc_consequence_order.ts';

test('equal labels compare by value and equivalent deltas compare equally in either order', () => {
  const deltas: NpcStateDelta[] = [
    { kind: 'trust_change', target: 'ivo' },
    { kind: 'trust_change', target: 'ivo', value: 1 },
    { kind: 'trust_change', target: 'ivo', label: 'trust' },
    { kind: 'trust_change', target: 'ivo', label: 'trust', value: 1 },
    { kind: 'trust_change', target: 'ivo', label: 'trust', value: 2 },
    { kind: 'trust_change', target: 'zoe', label: 'trust', value: 1 },
  ];
  for (const [index, delta] of deltas.entries()) {
    expect(compareConsequenceDeltas(delta, { ...delta })).toBe(0);
    expect(compareConsequenceDeltas({ ...delta }, delta)).toBe(0);
    for (const later of deltas.slice(index + 1)) {
      expect(compareConsequenceDeltas(delta, later)).toBeLessThan(0);
      expect(compareConsequenceDeltas(later, delta)).toBeGreaterThan(0);
    }
  }
  expect([...deltas].reverse().sort(compareConsequenceDeltas)).toEqual(deltas);
});
