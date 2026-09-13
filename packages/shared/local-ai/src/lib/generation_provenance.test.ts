// packages/shared/local-ai/src/lib/generation_provenance.test.ts

import { describe, expect, test } from 'bun:test';
import { buildGenerationProvenance } from './generation_provenance.ts';

const HASH = 'a'.repeat(64);

describe('buildGenerationProvenance', () => {
  test('accepts job lineage only through the dedicated option', () => {
    const nestedRecord = {
      jobId: 'nested-job-must-not-survive',
      engine: 'sdcpp' as const,
      models: [],
      references: [],
      rawHash: HASH,
      preparedHash: HASH,
      transformations: [],
      media: { mimeType: 'image/png', sizeBytes: 1 },
      rights: {
        inference: { permitted: true },
        gameInclusion: { permitted: true },
        standaloneDistribution: { permitted: false },
      },
      createdAt: '2026-09-13T00:00:00.000Z',
    };

    const withoutJob = buildGenerationProvenance({
      candidateId: 'candidate-1',
      tag: 'portraits:hero',
      record: nestedRecord,
    });
    const withJob = buildGenerationProvenance({
      candidateId: 'candidate-1',
      jobId: 'authoritative-job',
      tag: 'portraits:hero',
      record: nestedRecord,
    });

    expect(withoutJob.jobId).toBeUndefined();
    expect(withJob.jobId).toBe('authoritative-job');
  });
});
