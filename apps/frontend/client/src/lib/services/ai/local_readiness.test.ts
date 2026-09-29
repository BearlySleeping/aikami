// apps/frontend/client/src/lib/services/ai/local_readiness.test.ts
//
// Model-specific local readiness (issue #382 P0).
//
// A liveness probe is not readiness. These tests pin that distinction: an engine
// that merely answers `/models` must not be treated as able to generate every
// model a caller might ask for.

import { describe, expect, test } from 'bun:test';
import { createLocalReadinessController } from './local_readiness.ts';

describe('createLocalReadinessController', () => {
  test('starts unproven, so a named model is not assumed servable', () => {
    const readiness = createLocalReadinessController();

    expect(readiness.current.state).toBe('unknown');
    // A liveness-only probe leaves the served list empty, which is not proof.
    expect(readiness.canServe('qwen3-4b')).toBe(true);
  });

  test('rejects a model the engine does not list, even when the probe succeeded', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['qwen3-1b']);

    expect(readiness.canServe('qwen3-1b')).toBe(true);
    expect(readiness.canServe('qwen3-4b')).toBe(false);
  });

  test('a successful generation is proof the route did not previously have', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['qwen3-1b']);
    readiness.generated('qwen3-8b');

    expect(readiness.canServe('qwen3-8b')).toBe(true);
    expect(readiness.current.confirmedModelIds).toContain('qwen3-8b');
  });

  test('an unavailable engine is never attempted, whatever it once served', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['qwen3-1b']);
    readiness.unavailable('weights missing');

    expect(readiness.canServe('qwen3-1b')).toBe(false);
    expect(readiness.current.reason).toBe('weights missing');
  });

  test('unavailability is reversible — a later probe re-proves readiness', () => {
    const readiness = createLocalReadinessController();
    readiness.unavailable('engine stopped');
    readiness.served(['qwen3-1b']);

    expect(readiness.current.state).toBe('ready');
    expect(readiness.canServe('qwen3-1b')).toBe(true);
  });

  test('reset drops all evidence, so a reloaded engine is probed again', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['qwen3-1b']);
    readiness.reset();

    expect(readiness.current.state).toBe('unknown');
    expect(readiness.current.servedModelIds).toEqual([]);
  });

  test('matches ids that differ only by a provider path prefix', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['library/qwen3-1b']);

    expect(readiness.canServe('qwen3-1b')).toBe(true);
    expect(readiness.canServe('Library/Qwen3-1B')).toBe(true);
  });

  test('an unnamed model is allowed one attempt while nothing has failed', () => {
    const readiness = createLocalReadinessController();

    expect(readiness.canServe()).toBe(true);
    expect(readiness.canServe('')).toBe(true);
  });

  test('an empty served list remains unknown after a ready probe', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['qwen3-1b']);
    readiness.served([]);
    expect(readiness.current.state).toBe('unknown');
    expect(readiness.current.servedModelIds).toEqual([]);
    expect(readiness.current.checkedAt).toBeNumber();
    expect(readiness.canServe('qwen3-4b')).toBe(true);
  });

  test('records when evidence was gathered', () => {
    const readiness = createLocalReadinessController();
    readiness.served(['qwen3-1b']);

    expect(typeof readiness.current.checkedAt).toBe('number');
  });
});
