// packages/shared/schemas/src/lib/generation/hosted_generation.test.ts
//
// C-524: the hosted schemas must stay in step with the shared constants, and
// the additive engine-id change must not narrow anything that already shipped.
//
// Contract: C-524 Optional hosted asset provider comparison

import { describe, expect, test } from 'bun:test';
import { HOSTED_TRANSPORT_IDS, HOSTED_TRANSPORT_OPERATIONS } from '@aikami/constants';
import { Value } from 'typebox/value';
import { GenerationEngineIdSchema } from './asset_recipe.ts';
import { GenerationProvenanceSchema } from './generation_provenance.ts';
import {
  CostReservationSchema,
  HOSTED_UNAVAILABILITY_CODES,
  HostedPreflightQuoteSchema,
  HostedTransportIdSchema,
  HostedUnavailabilitySchema,
} from './hosted_generation.ts';

const quote = {
  schemaVersion: 1,
  providerProfileId: 'hosted_image_profile',
  transport: 'pixellab',
  modality: 'image',
  modelId: 'pixflux',
  apiVersion: 'v1',
  currency: 'USD',
  candidateCount: 1,
  estimatedSpendUsdPerCandidate: 0.04,
  estimatedMaxUsd: 0.04,
  maximumDurationSeconds: 0,
  assumptions: ['declared ceiling, not a provider quotation'],
  items: [
    {
      itemId: 'sprite',
      jobId: 'job-sprite',
      candidateCount: 1,
      maximumDurationSeconds: 0,
      estimatedMaxUsd: 0.04,
    },
  ],
  generatedAt: '2026-09-16T00:00:00.000Z',
};

describe('C-524 hosted schema vocabulary', () => {
  test('every declared transport id validates, and no undeclared one does', () => {
    for (const transport of HOSTED_TRANSPORT_IDS) {
      expect(Value.Check(HostedTransportIdSchema, transport)).toBe(true);
    }
    expect(Value.Check(HostedTransportIdSchema, 'openai')).toBe(false);
    // The count is the drift guard: a new member in the constant that the
    // schema does not know about fails here rather than at dispatch time.
    expect(Object.keys(HOSTED_TRANSPORT_OPERATIONS).sort()).toEqual(
      [...HOSTED_TRANSPORT_IDS].sort(),
    );
  });

  test('the engine-id union is extended additively', () => {
    for (const id of ['sdcpp', 'comfyui', 'ace-step', ...HOSTED_TRANSPORT_IDS]) {
      expect(Value.Check(GenerationEngineIdSchema, id)).toBe(true);
    }
    expect(Value.Check(GenerationEngineIdSchema, 'stable-audio')).toBe(false);
  });

  test('the preflight quote round-trips and refuses an unknown currency', () => {
    expect(Value.Check(HostedPreflightQuoteSchema, quote)).toBe(true);
    expect(Value.Check(HostedPreflightQuoteSchema, { ...quote, currency: 'EUR' })).toBe(false);
  });

  test('a reservation records an unsettled state with its uncertainty', () => {
    const reservation = {
      schemaVersion: 1,
      reservationId: 'res-1',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      providerProfileId: 'hosted_image_profile',
      transport: 'pixellab',
      currency: 'USD',
      estimatedMaxUsd: 0.04,
      state: 'unsettled',
      uncertainty: 'the request timed out with no provider handle recorded',
      createdAt: '2026-09-16T00:00:00.000Z',
    };
    expect(Value.Check(CostReservationSchema, reservation)).toBe(true);
    expect(Value.Check(CostReservationSchema, { ...reservation, state: 'forgotten' })).toBe(false);
    expect(Value.Check(CostReservationSchema, { ...reservation, uncertainty: undefined })).toBe(
      false,
    );
    expect(
      Value.Check(CostReservationSchema, {
        ...reservation,
        state: 'reserved',
        settledUsd: 0.04,
        settledAt: '2026-09-16T00:01:00.000Z',
      }),
    ).toBe(false);
    expect(
      Value.Check(CostReservationSchema, {
        ...reservation,
        state: 'settled',
        settledUsd: 0.04,
        settledAt: '2026-09-16T00:01:00.000Z',
        uncertainty: undefined,
      }),
    ).toBe(true);
  });

  test('every typed unavailability code is schema-valid', () => {
    for (const code of HOSTED_UNAVAILABILITY_CODES) {
      expect(
        Value.Check(HostedUnavailabilitySchema, {
          code,
          precondition: 'adapter:pixellab',
          message: 'the adapter is not enabled on this host',
        }),
      ).toBe(true);
    }
  });

  test('a hosted provenance record needs a request id and never claims a local hash', () => {
    const base = {
      schemaVersion: 1,
      candidateId: 'cand-1',
      tag: 'props:barrel',
      engine: 'pixellab',
      models: [
        {
          id: 'pixflux',
          kind: 'base',
          hosted: true,
          requestId: 'req-1',
          limitation: 'the provider exposes no weight hash',
        },
      ],
      references: [],
      rawHash: 'a'.repeat(64),
      preparedHash: 'b'.repeat(64),
      transformations: [],
      media: { mimeType: 'image/png', sizeBytes: 100, width: 32, height: 32 },
      rights: {
        inference: { permitted: true, state: 'allowed' },
        gameInclusion: { permitted: true, state: 'allowed' },
        standaloneDistribution: { permitted: false, state: 'denied' },
      },
      provenanceState: 'captured',
      createdAt: '2026-09-16T00:00:00.000Z',
    };
    expect(Value.Check(GenerationProvenanceSchema, base)).toBe(true);
    expect(
      Value.Check(GenerationProvenanceSchema, {
        ...base,
        models: [{ id: 'pixflux', kind: 'base', hosted: true, artifactHash: 'c'.repeat(64) }],
      }),
    ).toBe(false);
  });
});
