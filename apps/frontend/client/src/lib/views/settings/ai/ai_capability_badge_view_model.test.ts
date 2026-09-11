// apps/frontend/client/src/lib/views/settings/ai/ai_capability_badge_view_model.test.ts
//
// Slice 4 regression: connection-test state is shared across AI settings
// surfaces, and the header badge reads only that shared state.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createAiCapabilityBadgeViewModel } from './ai_capability_badge_view_model.svelte';
import { type AiCapabilityStatus, aiConnectionStatus } from './ai_connection_status.svelte';

const makeBadge = (statuses: readonly AiCapabilityStatus[]) =>
  createAiCapabilityBadgeViewModel({
    className: 'AiCapabilityBadgeViewModel',
    getCapabilityStatuses: () => statuses,
  });

describe('aiConnectionStatus store', () => {
  beforeEach(() => {
    aiConnectionStatus.reset();
  });

  test('stores results for the newest generation and discards stale ones', () => {
    const first = aiConnectionStatus.begin('c1');
    const second = aiConnectionStatus.begin('c1');

    expect(aiConnectionStatus.storeResult('c1', first, { ok: false, latencyMs: 1 })).toBe(false);
    expect(aiConnectionStatus.storeResult('c1', second, { ok: true, latencyMs: 2 })).toBe(true);
    expect(aiConnectionStatus.resultFor('c1')).toEqual({ ok: true, latencyMs: 2 });

    aiConnectionStatus.finish('c1', second);
    expect(aiConnectionStatus.isTesting('c1')).toBe(false);
  });

  test('an older probe finishing does not clear a newer in-flight flag', () => {
    const first = aiConnectionStatus.begin('c1');
    const second = aiConnectionStatus.begin('c1');

    aiConnectionStatus.finish('c1', first);
    expect(aiConnectionStatus.isTesting('c1')).toBe(true);

    aiConnectionStatus.finish('c1', second);
    expect(aiConnectionStatus.isTesting('c1')).toBe(false);
  });

  test('clear advances the generation so an in-flight probe cannot write back', () => {
    const stale = aiConnectionStatus.begin('c1');
    aiConnectionStatus.clear('c1');
    const fresh = aiConnectionStatus.begin('c1');

    expect(aiConnectionStatus.storeResult('c1', stale, { ok: false, latencyMs: 1 })).toBe(false);
    expect(aiConnectionStatus.storeResult('c1', fresh, { ok: true, latencyMs: 3 })).toBe(true);
  });

  test('reset advances the generation so an old probe cannot overwrite a new result', () => {
    const stale = aiConnectionStatus.begin('c1');
    aiConnectionStatus.reset();
    const fresh = aiConnectionStatus.begin('c1');

    expect(aiConnectionStatus.storeResult('c1', fresh, { ok: true, latencyMs: 3 })).toBe(true);
    expect(aiConnectionStatus.storeResult('c1', stale, { ok: false, latencyMs: 1 })).toBe(false);
    expect(aiConnectionStatus.resultFor('c1')).toEqual({ ok: true, latencyMs: 3 });
  });
});

describe('AiCapabilityBadgeViewModel', () => {
  test('reports Connected when the text capability is reachable', () => {
    const badge = makeBadge([
      { capability: 'text', status: 'reachable' },
      { capability: 'voice', status: 'not_tested' },
      { capability: 'image', status: 'not_configured' },
    ]);
    expect(badge.label).toBe('AI: Connected');
    expect(badge.color).toBe('badge-success');
  });

  test('reports Partial when only a non-text capability is reachable', () => {
    const badge = makeBadge([
      { capability: 'text', status: 'not_configured' },
      { capability: 'voice', status: 'reachable' },
      { capability: 'image', status: 'unreachable' },
    ]);
    expect(badge.label).toBe('AI: Partial');
    expect(badge.color).toBe('badge-warning');
  });

  test('reports Not Set Up otherwise', () => {
    const badge = makeBadge([
      { capability: 'text', status: 'not_tested' },
      { capability: 'voice', status: 'testing' },
      { capability: 'image', status: 'unreachable' },
    ]);
    expect(badge.label).toBe('AI: Not Set Up');
    expect(badge.color).toBe('badge-ghost');
  });
});
