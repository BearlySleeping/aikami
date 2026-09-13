// packages/shared/utils/src/lib/community/redact_generation_provenance.test.ts
//
// C-518 AC-1: the public projection built from the shared
// `CommunityAssetProvenanceProjectionSchema` omits every private field.

import { describe, expect, test } from 'bun:test';
import {
  type CommunityAssetProvenanceProjection,
  CommunityAssetProvenanceProjectionSchema,
  type GenerationProvenance,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import { redactGenerationProvenance } from './redact_generation_provenance.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const provenance: GenerationProvenance = {
  schemaVersion: 1,
  candidateId: 'candidate-1',
  jobId: 'job-7',
  tag: 'portraits:hero',
  engine: 'sdcpp',
  recipeId: 'portrait',
  seed: 42,
  models: [
    {
      id: 'sd15-base-private-id',
      kind: 'base',
      revision: 'commit-abc',
      artifactHash: HASH_A,
    },
  ],
  prompt: 'the private unreleased-storm-arc hero portrait',
  references: [{ role: 'image', sha256: HASH_B, pointer: '/home/creator/refs/unreleased-storm.png' }],
  rawHash: HASH_A,
  preparedHash: HASH_B,
  transformations: [
    { operation: 'generated:sdcpp', processor: 'sd.cpp@1.9', processorHash: HASH_A },
    { operation: 'prepared:png', processor: 'png-strip@1', processorHash: HASH_B },
  ],
  media: { mimeType: 'image/png', sizeBytes: 4096, width: 512, height: 512 },
  rights: {
    inference: { permitted: true, state: 'allowed', evidenceUrl: 'https://example.test/terms' },
    gameInclusion: { permitted: true, state: 'allowed' },
    standaloneDistribution: {
      permitted: true,
      state: 'allowed',
      evidenceUrl: 'https://example.test/terms#distribution',
    },
  },
  provenanceState: 'captured',
  createdAt: '2026-09-13T00:00:00.000Z',
};

describe('C-518 AC-1: the public projection omits private fields', () => {
  test('the projection validates against the shared schema', () => {
    const projection: CommunityAssetProvenanceProjection = redactGenerationProvenance({ provenance });
    expect(Value.Check(CommunityAssetProvenanceProjectionSchema, projection)).toBe(true);
    expect(projection.source).toBe('generated:sdcpp');
    expect(projection.lineage).toEqual(['generated:sdcpp', 'prepared:png']);
    expect(projection.generation?.preparedHash).toBe(HASH_B);
    expect(projection.generation?.rights?.standaloneDistribution).toBe('allowed');
    expect(projection.generation?.rights?.evidenceUrl).toBe(
      'https://example.test/terms#distribution',
    );
  });

  test('no private field survives into the serialized projection', () => {
    const serialized = JSON.stringify(redactGenerationProvenance({ provenance }));
    expect(serialized).not.toContain('private unreleased-storm-arc');
    expect(serialized).not.toContain('sd15-base-private-id');
    expect(serialized).not.toContain('/home/creator');
    expect(serialized).not.toContain('unreleased-storm.png');
    expect(serialized).not.toContain('job-7');
    expect(serialized).not.toContain(HASH_A);
  });

  test('a local evidence URL is dropped rather than published', () => {
    const projection = redactGenerationProvenance({
      provenance: {
        ...provenance,
        rights: {
          ...provenance.rights,
          standaloneDistribution: {
            permitted: true,
            state: 'allowed',
            evidenceUrl: '/home/me/terms.md',
          },
        },
      },
    });
    expect(projection.generation?.rights?.evidenceUrl).toBeUndefined();
  });

  test('a local sourceUrl is dropped rather than published', () => {
    const projection = redactGenerationProvenance({
      provenance,
      sourceUrl: 'file:///tmp/attribution.md',
    });
    expect(projection.sourceUrl).toBeUndefined();
  });

  test('required attribution survives, and no model author is invented', () => {
    const projection = redactGenerationProvenance({
      provenance,
      license: 'CC-BY-4.0',
      author: ['Creator'],
      shareAlike: false,
    });
    expect(projection.license).toBe('CC-BY-4.0');
    expect(projection.author).toEqual(['Creator']);
    expect(projection.shareAlike).toBe(false);
    expect(JSON.stringify(projection)).not.toContain('sd15-base-private-id');
  });
});
