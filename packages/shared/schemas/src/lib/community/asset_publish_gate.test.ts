// packages/shared/schemas/src/lib/community/asset_publish_gate.test.ts
//
// C-513 AC-2 / AC-7 (unit level): the server-side licence/provenance gate.
// Fails closed, evaluates distribution scopes separately, and refuses to treat
// a generated marker as an exemption.

import { describe, expect, test } from 'bun:test';
import {
  type CommunityAssetProvenanceProjection,
  evaluateCommunityPublishGate,
  isLocalOrEphemeralPath,
  type RightsDecision,
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
