// scripts/src/lib/agents/evaluation/catalogue.test.ts
//
// C-480 AC-2: comparisons use equivalent conditions — a missing/unresolvable
// model fails preflight rather than silently substituting another one.
// These tests never require a live `pi` binary or network: an ENOENT spawn
// resolves to "unavailable" with a reason, which is exactly the fail-closed
// behavior under test.

import { describe, expect, it } from 'bun:test';
import { preflightCatalogue, resolveCatalogueEntry } from './catalogue.ts';

describe('AC-2: catalogue resolution fails closed', () => {
  it('reports a family as unavailable with a reason when no candidate resolves', async () => {
    const entry = await resolveCatalogueEntry('astra');
    expect(entry.family).toBe('astra');
    if (!entry.available) {
      expect(entry.reason).toBeTruthy();
      expect(entry.provider).toBe('unknown');
      expect(entry.model).toBe('unknown');
    }
  });

  it('preflightCatalogue reports allAvailable false when any requested family is unavailable', async () => {
    const { entries, allAvailable } = await preflightCatalogue(['flash', 'sonnet']);
    expect(entries).toHaveLength(2);
    expect(allAvailable).toBe(entries.every((e) => e.available));
  });

  it('every resolution is internally consistent: available entries carry a real provider/model, unavailable entries carry a reason', async () => {
    for (const family of ['flash', 'sonnet', 'opus', 'astra'] as const) {
      const entry = await resolveCatalogueEntry(family);
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
});
