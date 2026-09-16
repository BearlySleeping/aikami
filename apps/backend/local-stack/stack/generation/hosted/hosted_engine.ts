// apps/backend/local-stack/stack/generation/hosted/hosted_engine.ts
//
// C-524: the hosted transports as a `GenerationEngineClient`.
//
// 🔴 This is the whole point of the shape: a hosted candidate travels the
// *same* `runAssetGeneration` pipeline, the same preparation hook and the same
// C-520/C-521 QA gates as a local one. There is no parallel acceptance path,
// so a hosted result cannot bypass alpha, frame, loop or collision checks by
// virtue of having been paid for.
//
// The engine id is the transport id (`pixellab` / `elevenlabs`) — a member of
// the extended `GenerationEngineIdSchema` — so the candidate's provenance
// records a truthful engine and never a local one.
//
// Contract: C-524 Optional hosted asset provider comparison

import { arch, cpus, platform } from 'node:os';
import type { GenerationHostedOperation, GenerationProviderProfile } from '@aikami/constants';
import { hostedTransportForProfile } from '@aikami/local-ai';
import type {
  GenerationCapabilities,
  GenerationEngineClient,
  GenerationRequest,
  GenerationResult,
} from '@aikami/types';
import {
  adapterImplementsOperation,
  mapHostedRequest,
  mapHostedResponse,
} from './hosted_adapters.ts';
import {
  describeOutboundRequest,
  type HostedOutboundResponse,
  type HostedTransport,
  hostedDispatchError,
} from './hosted_transport.ts';

/** Capabilities a hosted transport actually honours. */
const capabilitiesFor = (options: {
  transport: string;
  operation: GenerationHostedOperation;
}): GenerationCapabilities => ({
  negativePrompt: options.transport === 'pixellab' && options.operation === 'image',
  seed: options.transport === 'pixellab' && options.operation === 'image',
  sampler: false,
  initImage: options.transport === 'pixellab' && options.operation === 'rotation',
  mask: false,
  referenceImages: false,
  controlNet: false,
  lora: false,
  cancel: false,
  progress: false,
});

/**
 * The named hardware a hosted wall time was measured on.
 *
 * The contract requires a measured wall time *on named hardware*, not a vendor
 * claim — so the measurement carries the machine that made it.
 */
export const hostedMeasurementHost = (): string => {
  const model = cpus()[0]?.model ?? 'unknown cpu';
  return `${platform()}/${arch()} — ${model}`;
};

/**
 * Builds the hosted engine for a profile.
 *
 * @returns `undefined` when the profile is not a resolvable hosted profile —
 *          the caller turns that into a structured refusal rather than
 *          dispatching a transport the registry does not declare.
 */
export const createHostedGenerationEngine = (options: {
  profile: GenerationProviderProfile;
  /** 🔴 The secret. Read from the host environment, never recorded. */
  credential: string;
  transport: HostedTransport;
  /** Operation selected by the caller for this concrete item. */
  operation: GenerationHostedOperation;
  /** Injected clock so a wall time is reproducible in a test. */
  now?: () => number;
}): GenerationEngineClient | undefined => {
  const engineId = hostedTransportForProfile(options.profile);
  const modelId = options.profile.hostedModelId;
  const apiVersion = options.profile.hostedApiVersion ?? 'unspecified';
  if (engineId === undefined || modelId === undefined) {
    return undefined;
  }
  const operation = options.operation;
  const clock = options.now ?? (() => Date.now());

  return {
    id: engineId,
    modality: options.profile.modality,
    capabilities: capabilitiesFor({ transport: engineId, operation }),
    // A hosted transport has no local health probe: "reachable" is decided by
    // the request itself, and a probe would be a billable call.
    healthCheck: async () => true,
    listModels: async () => [{ id: modelId, description: options.profile.label }],
    generate: async (request: GenerationRequest): Promise<GenerationResult> => {
      if (!adapterImplementsOperation({ transport: engineId, operation })) {
        throw hostedDispatchError({
          errorType: 'unimplemented',
          message: `The "${engineId}" adapter does not implement the "${operation}" operation — refusing rather than posting a request nothing would collect.`,
          providerReached: false,
        });
      }
      const mapping = mapHostedRequest({
        transport: engineId,
        operation,
        request,
        modelId,
        apiVersion,
      });
      if (mapping.kind === 'unsupported') {
        throw hostedDispatchError({
          errorType: 'invalid-argument',
          message: mapping.reason,
          providerReached: false,
        });
      }

      const startedAt = clock();
      let response: HostedOutboundResponse;
      try {
        response = await options.transport.send({
          transport: engineId,
          operation,
          endpoint: mapping.plan.endpoint,
          apiVersion: mapping.plan.apiVersion,
          modelId: mapping.plan.modelId,
          body: mapping.plan.body,
          credential: options.credential,
        });
      } catch (error) {
        throw hostedDispatchError({
          errorType: 'unavailable',
          message: error instanceof Error ? error.message : 'Hosted transport failed',
          providerReached: true,
        });
      }
      const wallTimeMs = clock() - startedAt;

      const mapped = mapHostedResponse({ transport: engineId, response });
      if (mapped.kind === 'refused') {
        throw hostedDispatchError({
          errorType: 'unavailable',
          message: `${mapped.reason} (${describeOutboundRequest({
            transport: engineId,
            operation,
            endpoint: mapping.plan.endpoint,
            apiVersion: mapping.plan.apiVersion,
            modelId: mapping.plan.modelId,
            body: mapping.plan.body,
            credential: '',
          })})`,
          providerReached: true,
        });
      }

      const requestId =
        options.transport.provenance === 'test-fixture'
          ? `fixture:${mapped.requestId}`
          : mapped.requestId;

      return {
        bytes: mapped.bytes,
        mimeType: mapped.mimeType,
        engine: engineId,
        ...(typeof mapping.plan.body.seed === 'number' ? { seed: mapping.plan.body.seed } : {}),
        metadata: {
          ...mapped.metadata,
          'hosted.requestId': requestId,
          'hosted.provenance': options.transport.provenance,
          'hosted.endpoint': mapping.plan.endpoint,
          'hosted.limitation': mapped.limitation,
          'hosted.modelId': modelId,
          'hosted.apiVersion': apiVersion,
          'hosted.wallTimeMs': wallTimeMs,
          'hosted.measuredOn': hostedMeasurementHost(),
          ...(mapped.actualUsd === undefined ? {} : { 'hosted.actualUsd': mapped.actualUsd }),
        },
      };
    },
  };
};
