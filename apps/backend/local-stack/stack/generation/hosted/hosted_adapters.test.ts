// apps/backend/local-stack/stack/generation/hosted/hosted_adapters.test.ts
//
// C-524 AC-2 (offline): the adapters map a request onto the documented
// endpoint, explicit model id and pinned API version, preserve the recorded
// request id and bytes, fail early and typed on an unimplemented operation,
// and produce the pieces a truthful hosted provenance record needs.
//
// 🔴 No network and no credential is used here. That is the point: the
// mandatory half of AC-2 is offline, and the live smoke (AC-2b) is optional.
//
// Contract: C-524 Optional hosted asset provider comparison

import { describe, expect, test } from 'bun:test';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import type { GenerationRequest } from '@aikami/types';
import { mapHostedRequest, mapHostedResponse } from './hosted_adapters.ts';
import {
  ELEVENLABS_SFX_FIXTURE,
  PIXELLAB_IMAGE_FIXTURE,
  toOutboundResponse,
} from './hosted_fixtures.ts';
import { createFetchHostedTransport } from './hosted_transport.ts';

const IMAGE_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_image_profile;
const AUDIO_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_audio_profile;

const imageRequest: GenerationRequest = {
  modality: 'image',
  positivePrompt: 'a mossy stone barrel',
  negativePrompt: 'text, watermark',
  width: 32,
  height: 32,
  seed: 4242,
};

const sfxRequest: GenerationRequest = {
  modality: 'audio',
  positivePrompt: 'a wooden gate slamming shut',
  durationSeconds: 2,
  instrumental: true,
};

describe('C-524 AC-2 PixelLab mapping', () => {
  test('targets the documented endpoint, model id and pinned API version', () => {
    const mapping = mapHostedRequest({
      transport: 'pixellab',
      operation: 'image',
      request: imageRequest,
      modelId: IMAGE_PROFILE.hostedModelId as string,
      apiVersion: IMAGE_PROFILE.hostedApiVersion as string,
    });
    expect(mapping.kind).toBe('mapped');
    if (mapping.kind !== 'mapped') {
      return;
    }
    expect(mapping.plan.endpoint).toBe('https://api.pixellab.ai/v1/create-image-pixflux');
    expect(mapping.plan.modelId).toBe('pixflux');
    expect(mapping.plan.apiVersion).toBe('v1');
    expect(mapping.plan.body.description).toBe('a mossy stone barrel');
    expect(mapping.plan.body.negative_description).toBe('text, watermark');
    expect(mapping.plan.body.image_size).toEqual({ width: 32, height: 32 });
    expect(mapping.plan.body.seed).toBe(4242);
  });

  test('preserves the recorded request id and the returned bytes', () => {
    const response = toOutboundResponse(PIXELLAB_IMAGE_FIXTURE);
    const mapped = mapHostedResponse({ transport: 'pixellab', response });
    expect(mapped.kind).toBe('bytes');
    if (mapped.kind !== 'bytes') {
      return;
    }
    expect(mapped.requestId).toBe('pl-req-8f2c1d');
    expect(mapped.mimeType).toBe('image/png');
    // The fixture carries a real PNG signature — the bytes are not synthesised.
    expect([...mapped.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(mapped.actualUsd).toBe(0.04);
    expect(mapped.limitation.length).toBeGreaterThan(0);
    // 🔴 A hosted result never carries an artifact hash.
    expect('artifactHash' in mapped).toBe(false);
  });

  test('a rotation request with no source image fails early and typed', () => {
    const mapping = mapHostedRequest({
      transport: 'pixellab',
      operation: 'rotation',
      request: { modality: 'image', positivePrompt: 'rotate me' },
      modelId: 'pixflux',
      apiVersion: 'v1',
    });
    expect(mapping.kind).toBe('unsupported');
    if (mapping.kind !== 'unsupported') {
      return;
    }
    expect(mapping.reason).toContain('needs a source image');
  });

  test('defaults and clamps PixFlux dimensions to its supported range', () => {
    const defaulted = mapHostedRequest({
      transport: 'pixellab',
      operation: 'image',
      request: { modality: 'image', positivePrompt: 'default size' },
      modelId: 'pixflux',
      apiVersion: 'v1',
    });
    const clamped = mapHostedRequest({
      transport: 'pixellab',
      operation: 'image',
      request: { modality: 'image', positivePrompt: 'clamped size', width: 1, height: 900 },
      modelId: 'pixflux',
      apiVersion: 'v1',
    });
    expect(defaulted.kind === 'mapped' ? defaulted.plan.body.image_size : undefined).toEqual({
      width: 128,
      height: 128,
    });
    expect(clamped.kind === 'mapped' ? clamped.plan.body.image_size : undefined).toEqual({
      width: 32,
      height: 400,
    });
  });

  test('an operation the adapter does not implement fails early and typed', () => {
    const mapping = mapHostedRequest({
      transport: 'pixellab',
      operation: 'animation',
      request: imageRequest,
      modelId: 'pixflux',
      apiVersion: 'v1',
    });
    expect(mapping.kind).toBe('unsupported');
  });

  test('a response with no request id is a refusal, never a fabricated identity', () => {
    const mapped = mapHostedResponse({
      transport: 'pixellab',
      response: { status: 200, requestId: '', json: {}, metadata: {} },
    });
    expect(mapped.kind).toBe('refused');
  });
});

describe('C-524 AC-2 ElevenLabs mapping', () => {
  test('targets the documented SFX endpoint with the explicit model id', () => {
    const mapping = mapHostedRequest({
      transport: 'elevenlabs',
      operation: 'sfx',
      request: sfxRequest,
      modelId: AUDIO_PROFILE.hostedModelId as string,
      apiVersion: AUDIO_PROFILE.hostedApiVersion as string,
    });
    expect(mapping.kind).toBe('mapped');
    if (mapping.kind !== 'mapped') {
      return;
    }
    expect(mapping.plan.endpoint).toBe('https://api.elevenlabs.io/v1/sound-generation');
    expect(mapping.plan.modelId).toBe('eleven_text_to_sound_v2');
    expect(mapping.plan.apiVersion).toBe('v1');
    expect(mapping.plan.body.text).toBe('a wooden gate slamming shut');
    expect(mapping.plan.body.duration_seconds).toBe(2);
  });

  test('music preserves an explicitly false instrumental choice', () => {
    const mapping = mapHostedRequest({
      transport: 'elevenlabs',
      operation: 'music',
      request: {
        modality: 'audio',
        positivePrompt: 'a sung tavern refrain',
        instrumental: false,
      },
      modelId: AUDIO_PROFILE.hostedModelId as string,
      apiVersion: AUDIO_PROFILE.hostedApiVersion as string,
    });
    expect(mapping.kind === 'mapped' ? mapping.plan.body.force_instrumental : undefined).toBe(
      false,
    );
  });

  test('preserves the returned audio bytes and keeps the lossy limitation', () => {
    const mapped = mapHostedResponse({
      transport: 'elevenlabs',
      response: toOutboundResponse(ELEVENLABS_SFX_FIXTURE),
    });
    expect(mapped.kind).toBe('bytes');
    if (mapped.kind !== 'bytes') {
      return;
    }
    expect(mapped.requestId).toBe('el-req-3a91b7');
    expect(mapped.mimeType).toBe('audio/mpeg');
    expect(mapped.bytes.length).toBeGreaterThan(0);
    expect(mapped.limitation).toContain('does not make it a lossless original');
  });

  test('a non-2xx status is a typed refusal carrying the provider status', () => {
    const mapped = mapHostedResponse({
      transport: 'elevenlabs',
      response: { status: 429, requestId: 'el-req-rate', metadata: {} },
    });
    expect(mapped.kind).toBe('refused');
    if (mapped.kind !== 'refused') {
      return;
    }
    expect(mapped.reason).toContain('429');
  });
});

describe('C-524 recorded fixtures declare their own limits', () => {
  test('each fixture states that it is a documented shape, not live evidence', () => {
    for (const fixture of [PIXELLAB_IMAGE_FIXTURE, ELEVENLABS_SFX_FIXTURE]) {
      expect(fixture.note).toContain('NOT a recorded live provider response');
      expect(fixture.recordedFrom.length).toBeGreaterThan(0);
    }
  });
});

describe('C-524 hosted response metadata', () => {
  test('filters an echoed ElevenLabs credential from response metadata', async () => {
    const transport = createFetchHostedTransport({
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'content-type': 'audio/mpeg',
            'request-id': 'el-req-filtered',
            'xi-api-key': 'echoed-secret',
            authorization: 'echoed-auth',
            'set-cookie': 'session=secret',
            'x-provider-region': 'us-east',
          },
        }),
    });

    const response = await transport.send({
      transport: 'elevenlabs',
      operation: 'sfx',
      endpoint: 'https://api.elevenlabs.io/v1/sound-generation',
      apiVersion: 'v1',
      modelId: 'eleven_text_to_sound_v2',
      body: { text: 'wooden gate' },
      credential: 'test-key-not-a-real-secret',
    });

    expect(response.metadata['xi-api-key']).toBeUndefined();
    expect(response.metadata.authorization).toBeUndefined();
    expect(response.metadata['set-cookie']).toBeUndefined();
    expect(response.metadata['x-provider-region']).toBe('us-east');
  });
});
