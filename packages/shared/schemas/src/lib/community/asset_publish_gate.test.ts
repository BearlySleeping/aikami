// packages/shared/schemas/src/lib/community/asset_publish_gate.test.ts
//
// C-513 AC-2 / AC-7 (unit level): the server-side licence/provenance gate.
// Fails closed, evaluates distribution scopes separately, and refuses to treat
// a generated marker as an exemption.

import { describe, expect, test } from 'bun:test';
import {
  type CommunityAssetProvenanceProjection,
  evaluateCommunityPublishGate,
  evaluateIntendedUse,
  isLocalOrEphemeralPath,
  isScopePermitted,
  type RightsDecision,
  SCOPE_FOR_INTENDED_USE,
} from './asset_publish_gate.ts';

const original: CommunityAssetProvenanceProjection = {
  source: 'original',
  license: 'CC-BY-4.0',
  author: ['Creator'],
};

const permissiveRights = (overrides: Partial<RightsDecision> = {}): RightsDecision => ({
  inference: { permitted: true, evidence: 'e' },
  gameInclusion: { permitted: true, evidence: 'e' },
  standaloneDistribution: { permitted: true, evidence: 'e' },
  ...overrides,
});

describe('AC-2: the gate fails closed', () => {
  test('missing provenance is refused', () => {
    const result = evaluateCommunityPublishGate({ provenance: undefined, rights: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rights-unresolved');
    }
  });

  test('a generated asset does not inherit the model licence', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'generated:sd', lineage: ['generated:sd'] },
      rights: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rights-unresolved');
      // Inference, game inclusion and standalone distribution are all unmet —
      // the record that would substantiate them is absent.
      expect(result.missing).toEqual(['inference', 'gameInclusion', 'standaloneDistribution']);
    }
  });

  test('original work under a proprietary licence is refused', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'original', license: 'proprietary' },
      rights: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rights-unresolved');
    }
  });

  test('original work under a shareable licence is permitted', () => {
    const result = evaluateCommunityPublishGate({ provenance: original, rights: undefined });
    expect(result.ok).toBe(true);
  });

  test('a local filesystem path never publishes', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'C:\\Users\\creator\\refs\\hero.png' },
      rights: permissiveRights(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('provenance-local-path');
    }
  });

  test('a third-party licence without attribution names is refused', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'https://example.com/art.png', license: 'CC-BY-4.0' },
      rights: permissiveRights(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('attribution-missing');
    }
  });
});

describe('AC-7: scopes are evaluated separately', () => {
  test('game-use-only rights identify the unmet standalone-distribution scope', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'generated:sd' },
      rights: permissiveRights({
        standaloneDistribution: {
          permitted: false,
          evidence: 'model licence forbids output redistribution',
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rights-denied');
      expect(result.missing).toEqual(['standaloneDistribution']);
    }
  });

  test('a missing inference permission on generated work is reported', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'generated:sd' },
      rights: permissiveRights({ inference: { permitted: false, evidence: 'n/a' } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(['inference']);
    }
  });

  test('inference is not required for original work', () => {
    const result = evaluateCommunityPublishGate({
      provenance: original,
      rights: permissiveRights({
        inference: { permitted: false, evidence: 'no inference happened' },
      }),
    });
    expect(result.ok).toBe(true);
  });

  test('a fully substantiated decision is permitted', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'generated:sd', lineage: ['generated:sd', 'upscaled:2x'] },
      rights: permissiveRights(),
    });
    expect(result.ok).toBe(true);
  });
});

describe('C-518 AC-2: intended uses are evaluated independently', () => {
  const restricted = (overrides: Partial<RightsDecision> = {}): RightsDecision => ({
    inference: {
      permitted: false,
      state: 'denied',
      evidence: 'model card forbids local inference',
    },
    gameInclusion: { permitted: true, state: 'allowed', evidenceUrl: 'https://example.test/terms' },
    standaloneDistribution: { permitted: false, state: 'denied', evidence: 'no redistribution' },
    ...overrides,
  });

  test('each intent maps to exactly one shipped gate scope', () => {
    expect(SCOPE_FOR_INTENDED_USE.localGeneration).toBe('inference');
    expect(SCOPE_FOR_INTENDED_USE.gameExport).toBe('gameInclusion');
    expect(SCOPE_FOR_INTENDED_USE.communityExport).toBe('standaloneDistribution');
  });

  test('game-only output rights allow the game export but refuse community export', () => {
    const rights = restricted();
    expect(evaluateIntendedUse({ rights, use: 'gameExport' }).allowed).toBe(true);
    expect(evaluateIntendedUse({ rights, use: 'communityExport' }).allowed).toBe(false);
    expect(evaluateIntendedUse({ rights, use: 'localGeneration' }).allowed).toBe(false);
  });

  test('permissive code licence does not leak into a restricted model inference', () => {
    // Only the game scope is substantiated; the inference refusal stands on its
    // own evidence and is never overwritten by a permissive output licence.
    const rights = restricted({ inference: { permitted: false, state: 'denied' } });
    const local = evaluateIntendedUse({ rights, use: 'localGeneration' });
    expect(local.allowed).toBe(false);
    expect(local.state).toBe('denied');
    expect(local.scope).toBe('inference');
  });

  test('an `unknown` scope refuses rather than inheriting permission', () => {
    const rights: RightsDecision = {
      inference: { permitted: false, state: 'unknown', evidence: 'terms not read' },
      gameInclusion: { permitted: true, state: 'allowed' },
      standaloneDistribution: { permitted: true, state: 'allowed' },
    };
    const decision = evaluateIntendedUse({ rights, use: 'localGeneration' });
    expect(decision.allowed).toBe(false);
    expect(decision.state).toBe('unknown');
  });

  test('a missing inference record blocks a gated provider until resolved', () => {
    const rights = {
      gameInclusion: { permitted: true, state: 'allowed' as const },
      standaloneDistribution: { permitted: true, state: 'allowed' as const },
    } as unknown as RightsDecision;
    expect(evaluateIntendedUse({ rights, use: 'localGeneration' }).state).toBe('unknown');
  });

  test('a stale `permitted: true` alongside `unknown` does not permit', () => {
    expect(isScopePermitted({ permitted: true, state: 'unknown' })).toBe(false);
    expect(isScopePermitted({ permitted: true, state: 'allowed' })).toBe(true);
    // Pre-C-518 shape (no state) stays honoured — the shipped C-513 seam.
    expect(isScopePermitted({ permitted: true })).toBe(true);
  });

  test('the publish gate refuses an unknown scope as unresolved, not denied', () => {
    const result = evaluateCommunityPublishGate({
      provenance: { source: 'generated:sdcpp' },
      rights: {
        inference: { permitted: false, state: 'unknown' },
        gameInclusion: { permitted: true, state: 'allowed' },
        standaloneDistribution: { permitted: true, state: 'unknown' },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rights-unresolved');
      expect(result.missing).toEqual(['inference', 'standaloneDistribution']);
    }
  });
});

describe('local/ephemeral path detection', () => {
  test.each([
    ['/home/creator/art.png', true],
    ['C:\\art\\hero.png', true],
    ['\\\\server\\share\\a.png', true],
    ['file:///tmp/a.png', true],
    ['blob:http://localhost/abc', true],
    ['https://example.com/a.png', false],
    ['original', false],
    ['generated:sd', false],
  ])('%s → %s', (value, expected) => {
    expect(isLocalOrEphemeralPath(value)).toBe(expected);
  });
});
