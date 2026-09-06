// scripts/src/lib/agents/evaluation/catalogue.test.ts
//
// C-480 AC-2: comparisons use equivalent conditions — a missing/unresolvable
// model fails preflight rather than silently substituting another one.
// Deterministic checks inject unavailable auth results; the consistency case
// also proves that an absent live `pi` binary fails closed with a reason.

import { describe, expect, it } from 'bun:test';
import { preflightCatalogue, resolveCatalogueEntry } from './catalogue.ts';

describe('AC-2: catalogue resolution fails closed', () => {
  it('reports a family as unavailable with a reason when no candidate resolves', async () => {
    const entry = await resolveCatalogueEntry({
      family: 'astra',
      authCheck: async () => ({ result: null, diagnostics: 'forced unavailable' }),
    });
    expect(entry.family).toBe('astra');
    expect(entry.available).toBe(false);
    expect(entry.reason).toContain('forced unavailable');
    expect(entry.provider).toBe('unknown');
    expect(entry.model).toBe('unknown');
  });

  it('preflightCatalogue reports allAvailable false when any requested family is unavailable', async () => {
    const unavailableAuthCheck = async () => ({
      result: null,
      diagnostics: 'forced unavailable',
    });
    const forcedUnavailable = await resolveCatalogueEntry({
      family: 'astra',
      authCheck: unavailableAuthCheck,
    });
    const { entries, allAvailable } = await preflightCatalogue({
      families: ['flash', forcedUnavailable.family],
      authCheck: unavailableAuthCheck,
    });
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(forcedUnavailable);
    expect(allAvailable).toBe(false);
  });

  it('every resolution is internally consistent: available entries carry a real provider/model, unavailable entries carry a reason', async () => {
    for (const family of ['flash', 'sonnet', 'opus', 'astra'] as const) {
      const entry = await resolveCatalogueEntry({ family });
      expect(entry.family).toBe(family);
      if (entry.available) {
        expect(entry.provider).not.toBe('unknown');
        expect(entry.model).not.toBe('unknown');
        expect(entry.reason).toBeUndefined();
      } else {
        expect(entry.reason).toBeTruthy();
      }
    }
  });

  it('reads environment model overrides when each resolution starts', async () => {
    const previous = process.env.EVAL_MODEL_ASTRA;
    process.env.EVAL_MODEL_ASTRA = 'test-provider/test-model';
    try {
      const entry = await resolveCatalogueEntry({
        family: 'astra',
        authCheck: async ({ provider, model }) => ({
          result: {
            status: provider === 'test-provider' && model === 'test-model' ? 'valid' : 'invalid',
          },
          diagnostics: '',
        }),
      });
      expect(entry.provider).toBe('test-provider');
      expect(entry.model).toBe('test-model');
      expect(entry.available).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.EVAL_MODEL_ASTRA;
      } else {
        process.env.EVAL_MODEL_ASTRA = previous;
      }
    }
  });
});
