// apps/frontend/client/src/lib/views/settings/ai/ai_capability_badge_view_model.test.ts
//
// Connection-test state is session-scoped: it is shared across the AI settings
// surfaces that must agree (header badge, capability detail pages), and two
// separate sessions never leak into one another.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createAiCapabilityBadgeViewModel } from './ai_capability_badge_view_model.svelte';
import {
  type AiCapabilityStatus,
  type AiConnectionStatus,
  buildCapabilityStatuses,
  type CapabilityStatusConfig,
  createAiConnectionStatus,
} from './ai_connection_status.svelte';

let status: AiConnectionStatus;

beforeEach(() => {
  status = createAiConnectionStatus();
});

const makeBadge = (getCapabilityStatuses: () => readonly AiCapabilityStatus[]) =>
  createAiCapabilityBadgeViewModel({
    className: 'AiCapabilityBadgeViewModel',
    getCapabilityStatuses,
  });

const staticBadge = (statuses: readonly AiCapabilityStatus[]) => makeBadge(() => statuses);

describe('AiConnectionStatus store', () => {
  test('stores results for the newest generation and discards stale ones', () => {
    const first = status.begin('c1');
    const second = status.begin('c1');

    expect(status.storeResult('c1', first, { ok: false, latencyMs: 1 })).toBe(false);
    expect(status.storeResult('c1', second, { ok: true, latencyMs: 2 })).toBe(true);
    expect(status.resultFor('c1')).toEqual({ ok: true, latencyMs: 2 });

    status.finish('c1', second);
    expect(status.isTesting('c1')).toBe(false);
  });

  test('an older probe finishing does not clear a newer in-flight flag', () => {
    const first = status.begin('c1');
    const second = status.begin('c1');

    status.finish('c1', first);
    expect(status.isTesting('c1')).toBe(true);

    status.finish('c1', second);
    expect(status.isTesting('c1')).toBe(false);
  });

  test('clear advances the generation so an in-flight probe cannot write back', () => {
    const stale = status.begin('c1');
    status.clear('c1');
    const fresh = status.begin('c1');

    expect(status.storeResult('c1', stale, { ok: false, latencyMs: 1 })).toBe(false);
    expect(status.storeResult('c1', fresh, { ok: true, latencyMs: 3 })).toBe(true);
  });

  test('reset advances the generation so an old probe cannot overwrite a new result', () => {
    const stale = status.begin('c1');
    status.reset();
    const fresh = status.begin('c1');

    expect(status.storeResult('c1', fresh, { ok: true, latencyMs: 3 })).toBe(true);
    expect(status.storeResult('c1', stale, { ok: false, latencyMs: 1 })).toBe(false);
    expect(status.resultFor('c1')).toEqual({ ok: true, latencyMs: 3 });
  });

  test('independent stores do not share results', () => {
    const other = createAiConnectionStatus();

    status.setResult('c1', { ok: true, latencyMs: 1 });

    expect(status.resultFor('c1')).toEqual({ ok: true, latencyMs: 1 });
    expect(other.resultFor('c1')).toBeUndefined();
  });
});

describe('AiCapabilityBadgeViewModel', () => {
  test('reports Connected when the text capability is reachable', () => {
    const badge = staticBadge([
      { capability: 'text', status: 'reachable' },
      { capability: 'voice', status: 'not_tested' },
      { capability: 'image', status: 'not_configured' },
    ]);
    expect(badge.label).toBe('AI: Connected');
    expect(badge.color).toBe('badge-success');
  });

  test('reports Partial when only a non-text capability is reachable', () => {
    const badge = staticBadge([
      { capability: 'text', status: 'not_configured' },
      { capability: 'voice', status: 'reachable' },
      { capability: 'image', status: 'unreachable' },
    ]);
    expect(badge.label).toBe('AI: Partial');
    expect(badge.color).toBe('badge-warning');
  });

  test('reports Not Set Up otherwise', () => {
    const badge = staticBadge([
      { capability: 'text', status: 'not_tested' },
      { capability: 'voice', status: 'testing' },
      { capability: 'image', status: 'unreachable' },
    ]);
    expect(badge.label).toBe('AI: Not Set Up');
    expect(badge.color).toBe('badge-ghost');
  });

  test('badges sharing one store agree on the result (header + detail)', () => {
    const config: CapabilityStatusConfig = {
      getAiConnections: () => [{ id: 'text-1', capability: 'text' }],
      getDefaultByCapability: () => ({ text: 'text-1' }),
    };
    const getStatuses = () => buildCapabilityStatuses(config, status);
    const header = makeBadge(getStatuses);
    const detail = makeBadge(getStatuses);

    expect(header.label).toBe('AI: Not Set Up');
    expect(detail.label).toBe('AI: Not Set Up');

    status.setResult('text-1', { ok: true, latencyMs: 5 });

    expect(header.label).toBe('AI: Connected');
    expect(detail.label).toBe('AI: Connected');
  });

  test('badges over independent stores stay independent', () => {
    const config: CapabilityStatusConfig = {
      getAiConnections: () => [{ id: 'text-1', capability: 'text' }],
      getDefaultByCapability: () => ({ text: 'text-1' }),
    };
    const other = createAiConnectionStatus();
    const first = makeBadge(() => buildCapabilityStatuses(config, status));
    const second = makeBadge(() => buildCapabilityStatuses(config, other));

    status.setResult('text-1', { ok: true, latencyMs: 5 });

    expect(first.label).toBe('AI: Connected');
    expect(second.label).toBe('AI: Not Set Up');
  });
});
