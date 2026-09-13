// packages/shared/schemas/src/lib/generation/generation_provenance.test.ts
//
// C-518 AC-1 / AC-3 (schema level): the durable lineage record, candidate
// records and acceptance records. These assertions pin the *shape* rules the
// storage and registration seams rely on:
//   - a versioned record that validates,
//   - a hosted provider that must record its limitation rather than an
//     invented weight hash,
//   - an acceptance that binds exact bytes and an exact transformation chain.

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  AcceptanceRecordSchema,
  CandidateRecordSchema,
  GENERATION_PROVENANCE_SCHEMA_VERSION,
  type GenerationProvenance,
  GenerationProvenanceSchema,
} from './generation_provenance.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const fullProvenance = (overrides: Partial<GenerationProvenance> = {}): GenerationProvenance => ({
  schemaVersion: GENERATION_PROVENANCE_SCHEMA_VERSION,
  candidateId: 'candidate-1',
  jobId: 'job-7',
  tag: 'portraits:hero',
  engine: 'sdcpp',
  recipeId: 'portrait',
  recipeHash: HASH_B,
  seed: 42,
  versions: { engine: 'sd.cpp-1.9', server: '1.2.3' },
  models: [
    {
      id: 'sd15-base',
      kind: 'base',
      revision: 'commit-abc',
      artifactHash: HASH_A,
    },
    {
      id: 'hosted-flux',
      kind: 'base',
      hosted: true,
      requestId: 'req-123',
      limitation: 'Hosted provider exposes no weight hash; only a model version and request id.',
    },
  ],
  request: {
    engine: 'sdcpp',
    modality: 'image',
    subject: 'a hero portrait',
    requestedSeed: 42,
  },
  prompt: 'a hero portrait, oil painting',
  references: [{ role: 'image', sha256: HASH_B, pointer: '/home/creator/refs/hero.png' }],
  rawHash: HASH_A,
  preparedHash: HASH_B,
  transformations: [
    { operation: 'generated:sdcpp', processor: 'sd.cpp@1.9', processorHash: HASH_A },
    { operation: 'prepared:png', processor: 'png-strip@1', processorHash: HASH_B },
  ],
  media: { mimeType: 'image/png', sizeBytes: 4096, width: 512, height: 512 },
  rights: {
    inference: { permitted: true, state: 'allowed', evidenceUrl: 'https://example.test/terms' },
    gameInclusion: { permitted: true, state: 'allowed', evidenceUrl: 'https://example.test/terms' },
    standaloneDistribution: {
      permitted: false,
      state: 'denied',
      evidence: 'model card excludes resale',
    },
  },
  provenanceState: 'captured',
  createdAt: '2026-09-13T00:00:00.000Z',
  ...overrides,
});

describe('C-518 GenerationProvenance v1', () => {
  test('a fully-captured record validates', () => {
    expect(Value.Check(GenerationProvenanceSchema, fullProvenance())).toBe(true);
  });

  test('the record is versioned', () => {
    expect(GENERATION_PROVENANCE_SCHEMA_VERSION).toBe(1);
    expect(fullProvenance().schemaVersion).toBe(1);
    expect(Value.Check(GenerationProvenanceSchema, { ...fullProvenance(), schemaVersion: 2 })).toBe(
      false,
    );
  });

  test('a hosted provider records its limitation — never a fabricated hash', () => {
    const record = fullProvenance();
    const hosted = record.models[1];
    expect(hosted?.hosted).toBe(true);
    expect(hosted?.artifactHash).toBeUndefined();
    expect(hosted?.limitation).toContain('no weight hash');
    expect(Value.Check(GenerationProvenanceSchema, record)).toBe(true);
  });

  test('hosted model evidence requires a request id and limitation and rejects a local hash', () => {
    const hosted = fullProvenance().models[1];
    expect(
      Value.Check(GenerationProvenanceSchema, {
        ...fullProvenance(),
        models: [{ ...hosted, requestId: undefined }],
      }),
    ).toBe(false);
    expect(
      Value.Check(GenerationProvenanceSchema, {
        ...fullProvenance(),
        models: [{ ...hosted, limitation: undefined }],
      }),
    ).toBe(false);
    expect(
      Value.Check(GenerationProvenanceSchema, {
        ...fullProvenance(),
        models: [{ ...hosted, artifactHash: HASH_A }],
      }),
    ).toBe(false);
  });

  test('byte identity is SHA-256 — a non-hex hash is rejected', () => {
    const invalid = { ...fullProvenance(), preparedHash: 'not-a-hash' };
    expect(Value.Check(GenerationProvenanceSchema, invalid)).toBe(false);
  });

  test('a legacy row is explicit `unknown`, never backfilled', () => {
    expect(fullProvenance({ provenanceState: 'unknown' }).provenanceState).toBe('unknown');
    expect(
      Value.Check(GenerationProvenanceSchema, { ...fullProvenance(), provenanceState: 'guessed' }),
    ).toBe(false);
  });

  test('candidate status is separate from job status', () => {
    const candidate = {
      candidateId: 'candidate-1',
      tag: 'portraits:hero',
      jobId: 'job-7',
      status: 'pending_review',
      preparedHash: HASH_B,
      provenanceState: 'captured',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    expect(Value.Check(CandidateRecordSchema, candidate)).toBe(true);
    expect(Value.Check(CandidateRecordSchema, { ...candidate, status: 'completed' })).toBe(false);
    for (const status of ['pending_review', 'accepted', 'rejected', 'superseded']) {
      expect(Value.Check(CandidateRecordSchema, { ...candidate, status })).toBe(true);
    }
  });

  test('an acceptance binds an exact prepared hash and transformation chain', () => {
    const acceptance = {
      acceptanceId: 'acceptance-1',
      candidateId: 'candidate-1',
      preparedHash: HASH_B,
      validationReportHash: HASH_A,
      transformationHash: HASH_A,
      acceptedAt: '2026-09-13T00:00:00.000Z',
    };
    expect(Value.Check(AcceptanceRecordSchema, acceptance)).toBe(true);
    expect(Value.Check(AcceptanceRecordSchema, { ...acceptance, preparedHash: 'x' })).toBe(false);
  });
});
