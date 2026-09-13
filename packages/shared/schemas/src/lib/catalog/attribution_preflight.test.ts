// packages/shared/schemas/src/lib/catalog/attribution_preflight.test.ts
//
// C-518 AC-5: publication preflight asks for missing rights evidence.
//
// The pre-C-518 behaviour (unresolved / incomplete attribution) is unchanged
// when no rights data is declared. When the catalog *does* declare rights
// evidence, a tag whose evidence is absent — or that only says `unknown` — is
// named so the publisher supplies it, instead of the publish inheriting the
// model's own licence.

import { describe, expect, test } from 'bun:test';
import { runAttributionPreflight } from './attribution_preflight.ts';

const entries = [
  { tag: 'portraits:hero', path: 'portraits/hero.png' },
  { tag: 'music:explore', path: 'music/explore.ogg' },
];

const creditsByTag = {
  'portraits:hero': { licenses: ['CC-BY-4.0'], authors: ['Aikami Studio'] },
  'music:explore': { licenses: ['CC-BY-4.0'], authors: ['Aikami Studio'] },
};

const allowed = {
  evidenceUrl: 'https://example.test/model-card',
  evidenceVersion: 'v1.2.0',
  evidenceDate: '2026-09-13',
  scopes: { gameInclusion: 'allowed', standaloneDistribution: 'allowed' } as const,
};

describe('C-518 AC-5: rights evidence is requested, never assumed', () => {
  test('no rights data declared → pre-C-518 behaviour is unchanged', () => {
    const result = runAttributionPreflight({ entries, creditsByTag });
    expect(result.ok).toBe(true);
    expect(result.missingRightsEvidenceTags).toEqual([]);
    expect(result.incompleteRightsTags).toEqual([]);
  });

  test('every tag with substantiating evidence passes', () => {
    const result = runAttributionPreflight({
      entries,
      creditsByTag,
      rightsEvidenceByTag: { 'portraits:hero': allowed, 'music:explore': allowed },
    });
    expect(result.ok).toBe(true);
    expect(result.missingRightsEvidenceTags).toEqual([]);
    expect(result.incompleteRightsTags).toEqual([]);
  });

  test('a tag with no evidence at all is named', () => {
    const result = runAttributionPreflight({
      entries,
      creditsByTag,
      rightsEvidenceByTag: { 'portraits:hero': allowed },
    });
    expect(result.ok).toBe(false);
    expect(result.missingRightsEvidenceTags).toEqual(['music:explore']);
    expect(result.incompleteRightsTags).toEqual([]);
  });

  test('an `unknown` scope is incomplete evidence, not permission', () => {
    const result = runAttributionPreflight({
      entries: [entries[0] as (typeof entries)[number]],
      creditsByTag,
      rightsEvidenceByTag: {
        'portraits:hero': {
          ...allowed,
          scopes: { gameInclusion: 'allowed', standaloneDistribution: 'unknown' },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.incompleteRightsTags).toEqual(['portraits:hero']);
    expect(result.missingRightsEvidenceTags).toEqual([]);
  });

  test('evidence with no version/date is incomplete — undated terms cannot substantiate', () => {
    const result = runAttributionPreflight({
      entries: [entries[0] as (typeof entries)[number]],
      creditsByTag,
      rightsEvidenceByTag: {
        'portraits:hero': {
          evidenceUrl: 'https://example.test/model-card',
          scopes: { gameInclusion: 'allowed', standaloneDistribution: 'allowed' },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.incompleteRightsTags).toEqual(['portraits:hero']);
  });

  test('missing rights evidence and missing attribution are reported separately', () => {
    const result = runAttributionPreflight({
      entries,
      creditsByTag: { 'portraits:hero': { licenses: [], authors: [] } },
      rightsEvidenceByTag: {},
    });
    expect(result.ok).toBe(false);
    expect(result.unresolvedTags).toEqual(['music:explore']);
    expect(result.incompleteAttributionTags).toEqual(['portraits:hero']);
    expect(result.missingRightsEvidenceTags).toEqual(['portraits:hero', 'music:explore']);
  });
});
