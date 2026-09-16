// apps/backend/local-stack/stack/generation/hosted/hosted_adapters.ts
//
// C-524: the provider request/response mapping for the two declared hosted
// transports.
//
// A mapping is DATA plus a small pure function: the endpoint, the explicit
// model id, the pinned API version and the provider-shaped body. Keeping it
// here (rather than inline at a call site) is what lets AC-2 be proven offline
// against recorded fixtures — `hosted_adapters.test.ts` maps a request and
// checks it against `fixtures/`, with no network and no credential.
//
// 🔴 Two honesty rules:
//   - the mapping is pinned to the providers' *published* API documentation
//     for the declared version. The mapping's own `limitation` says so, and
//     the live smoke (AC-2b) is the only proof of the wire contract.
//   - an operation the adapter does not implement fails early with a typed
//     reason. It is never posted to an endpoint that does not exist, and a
//     response without a provider request id is a refusal, not a fabricated
//     hash.
//
// Contract: C-524 Optional hosted asset provider comparison
/** biome-ignore-all lint/style/useNamingConvention: provider wire bodies use the providers' own snake_case keys (image_size, negative_description, model_id, duration_seconds, music_length_ms) verbatim — renaming them would change the request */

import type { GenerationHostedOperation, GenerationHostedTransportId } from '@aikami/constants';
import type { GenerationRequest } from '@aikami/types';
import type { HostedOutboundResponse } from './hosted_transport.ts';

/** The provider-shaped request the transport will send. */
export type HostedAdapterPlan = {
  readonly endpoint: string;
  readonly operation: GenerationHostedOperation;
  readonly modelId: string;
  readonly apiVersion: string;
  readonly body: Readonly<Record<string, unknown>>;
};

/** The outcome of mapping a local request onto a provider request. */
export type HostedAdapterMapping =
  | { readonly kind: 'mapped'; readonly plan: HostedAdapterPlan }
  | { readonly kind: 'unsupported'; readonly reason: string };

/** The provider bytes, normalised. */
export type HostedProviderResult =
  | {
      readonly kind: 'bytes';
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly requestId: string;
      readonly limitation: string;
      readonly metadata: Readonly<Record<string, string>>;
      /** The provider's reported charge for this request, when it reports one. */
      readonly actualUsd?: number;
    }
  | { readonly kind: 'refused'; readonly reason: string; readonly requestId?: string };

/** The pinned endpoint roots. */
const PIXELLAB_API_ROOT = 'https://api.pixellab.ai/v1';
const ELEVENLABS_API_ROOT = 'https://api.elevenlabs.io/v1';

/**
 * The operations this adapter implements.
 *
 * `animation` is a documented PixelLab API operation but its async job/poll
 * flow is not implemented here, so it is deliberately absent: a request for it
 * fails early and typed instead of being posted and never collected.
 */
const IMPLEMENTED_OPERATIONS: Readonly<
  Record<GenerationHostedTransportId, readonly GenerationHostedOperation[]>
> = {
  pixellab: ['image', 'rotation'],
  elevenlabs: ['sfx', 'music'],
};

/** The `{ width, height }` pair a provider body expects. */
const imageSize = (request: GenerationRequest): Record<string, number> => ({
  width: Math.max(1, Math.round(request.width ?? 512)),
  height: Math.max(1, Math.round(request.height ?? 512)),
});

/** Base64-encodes bytes for a provider body that takes an inline image. */
const toBase64 = (value: string): string => value.replace(/^data:[^;]+;base64,/, '');

// ---------------------------------------------------------------------------
// PixelLab
// ---------------------------------------------------------------------------

const mapPixelLabRequest = (options: {
  operation: GenerationHostedOperation;
  request: GenerationRequest;
  modelId: string;
  apiVersion: string;
}): HostedAdapterMapping => {
  const { request } = options;
  const size = imageSize(request);
  if (options.operation === 'image') {
    return {
      kind: 'mapped',
      plan: {
        // The endpoint itself selects the documented model; `modelId` is
        // recorded alongside so the run lock and the quote name it explicitly.
        endpoint: `${PIXELLAB_API_ROOT}/create-image-pixflux`,
        operation: 'image',
        modelId: options.modelId,
        apiVersion: options.apiVersion,
        body: {
          description: request.positivePrompt,
          image_size: size,
          no_background: true,
          ...(request.negativePrompt === undefined
            ? {}
            : { negative_description: request.negativePrompt }),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      },
    };
  }
  if (options.operation === 'rotation') {
    if (request.initImage === undefined) {
      return {
        kind: 'unsupported',
        reason:
          'A PixelLab rotation request needs a source image, and this dispatch carries no initImage — refusing rather than sending an empty reference.',
      };
    }
    return {
      kind: 'mapped',
      plan: {
        endpoint: `${PIXELLAB_API_ROOT}/rotate`,
        operation: 'rotation',
        modelId: options.modelId,
        apiVersion: options.apiVersion,
        body: {
          image: { type: 'base64', base64: toBase64(request.initImage) },
          method: 'rotate',
          image_size: size,
        },
      },
    };
  }
  return {
    kind: 'unsupported',
    reason: `The PixelLab adapter does not implement the "${options.operation}" operation (its documented async job/poll flow is not wired here) — refusing rather than posting a request nothing would collect.`,
  };
};

const mapPixelLabResponse = (response: HostedOutboundResponse): HostedProviderResult => {
  if (response.status < 200 || response.status >= 300) {
    return {
      kind: 'refused',
      reason: `The PixelLab API answered ${response.status}${response.requestId === '' ? '' : ` (request ${response.requestId})`}.`,
      ...(response.requestId === '' ? {} : { requestId: response.requestId }),
    };
  }
  if (response.requestId === '') {
    return {
      kind: 'refused',
      reason:
        'The PixelLab API answered without a request id, so the candidate could not carry a truthful hosted provenance record — refusing rather than inventing an identity.',
    };
  }
  const json = response.json as
    | { image?: { base64?: unknown }; usage?: { usd?: unknown } }
    | undefined;
  const base64 = json?.image?.base64;
  if (typeof base64 !== 'string' || base64.length === 0) {
    return {
      kind: 'refused',
      reason: `The PixelLab API answered ${response.status} with no image payload (request ${response.requestId}).`,
      requestId: response.requestId,
    };
  }
  const usd = json?.usage?.usd;
  return {
    kind: 'bytes',
    bytes: new Uint8Array(Buffer.from(base64, 'base64')),
    mimeType: 'image/png',
    requestId: response.requestId,
    limitation:
      'PixelLab exposes no model weight hash, so this candidate records the provider request id and the API version instead of an artifact hash. The provider revision is not byte-verifiable.',
    metadata: { ...response.metadata, 'pixellab.requestId': response.requestId },
    ...(typeof usd === 'number' && Number.isFinite(usd) ? { actualUsd: usd } : {}),
  };
};

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

const mapElevenLabsRequest = (options: {
  operation: GenerationHostedOperation;
  request: GenerationRequest;
  modelId: string;
  apiVersion: string;
}): HostedAdapterMapping => {
  const { request } = options;
  if (options.operation === 'sfx') {
    return {
      kind: 'mapped',
      plan: {
        endpoint: `${ELEVENLABS_API_ROOT}/sound-generation`,
        operation: 'sfx',
        modelId: options.modelId,
        apiVersion: options.apiVersion,
        body: {
          text: request.positivePrompt,
          model_id: options.modelId,
          ...(request.durationSeconds === undefined
            ? {}
            : { duration_seconds: request.durationSeconds }),
        },
      },
    };
  }
  if (options.operation === 'music') {
    return {
      kind: 'mapped',
      plan: {
        endpoint: `${ELEVENLABS_API_ROOT}/music`,
        operation: 'music',
        modelId: options.modelId,
        apiVersion: options.apiVersion,
        body: {
          prompt: request.positivePrompt,
          model_id: options.modelId,
          ...(request.durationSeconds === undefined
            ? {}
            : { music_length_ms: Math.round(request.durationSeconds * 1000) }),
        },
      },
    };
  }
  return {
    kind: 'unsupported',
    reason: `The ElevenLabs adapter does not implement the "${options.operation}" operation — refusing rather than posting a request to an endpoint that does not exist.`,
  };
};

const mapElevenLabsResponse = (response: HostedOutboundResponse): HostedProviderResult => {
  if (response.status < 200 || response.status >= 300) {
    return {
      kind: 'refused',
      reason: `The ElevenLabs API answered ${response.status}${response.requestId === '' ? '' : ` (request ${response.requestId})`}.`,
      ...(response.requestId === '' ? {} : { requestId: response.requestId }),
    };
  }
  if (response.requestId === '') {
    return {
      kind: 'refused',
      reason:
        'The ElevenLabs API answered without a request id, so the candidate could not carry a truthful hosted provenance record — refusing rather than inventing an identity.',
    };
  }
  if (response.bytes === undefined || response.bytes.length === 0) {
    return {
      kind: 'refused',
      reason: `The ElevenLabs API answered ${response.status} with no audio payload (request ${response.requestId}).`,
      requestId: response.requestId,
    };
  }
  return {
    kind: 'bytes',
    bytes: response.bytes,
    mimeType: response.contentType?.split(';')[0] ?? 'audio/mpeg',
    requestId: response.requestId,
    limitation:
      'ElevenLabs returns a lossy rendition; this candidate keeps the provider request id and the returned container. Converting it to WAV does not make it a lossless original.',
    metadata: { ...response.metadata, 'elevenlabs.requestId': response.requestId },
  };
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

/** True when this adapter implements the operation at all. */
export const adapterImplementsOperation = (options: {
  transport: GenerationHostedTransportId;
  operation: GenerationHostedOperation;
}): boolean => IMPLEMENTED_OPERATIONS[options.transport].includes(options.operation);

/** Maps a local generation request onto the provider's request shape. */
export const mapHostedRequest = (options: {
  transport: GenerationHostedTransportId;
  operation: GenerationHostedOperation;
  request: GenerationRequest;
  modelId: string;
  apiVersion: string;
}): HostedAdapterMapping => {
  if (!adapterImplementsOperation(options)) {
    return {
      kind: 'unsupported',
      reason: `The "${options.transport}" adapter does not implement the "${options.operation}" operation — refusing rather than posting a request nothing would collect.`,
    };
  }
  return options.transport === 'pixellab'
    ? mapPixelLabRequest(options)
    : mapElevenLabsRequest(options);
};

/** Maps a provider response onto provider bytes plus their recorded limits. */
export const mapHostedResponse = (options: {
  transport: GenerationHostedTransportId;
  response: HostedOutboundResponse;
}): HostedProviderResult =>
  options.transport === 'pixellab'
    ? mapPixelLabResponse(options.response)
    : mapElevenLabsResponse(options.response);
