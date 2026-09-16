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
import { describeOutboundRequest, type HostedTransport } from './hosted_transport.ts';

/** Capabilities a hosted transport actually honours. */
const capabilitiesFor = (transport: string): GenerationCapabilities => ({
  negativePrompt: transport === 'pixellab',
  seed: transport === 'pixellab',
  sampler: false,
  initImage: transport === 'pixellab',
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
  /** Defaults to the profile's first declared operation. */
  operation?: GenerationHostedOperation;
  /** Injected clock so a wall time is reproducible in a test. */
  now?: () => number;
}): GenerationEngineClient | undefined => {
  const engineId = hostedTransportForProfile(options.profile);
  const modelId = options.profile.hostedModelId;
  const apiVersion = options.profile.hostedApiVersion ?? 'unspecified';
  if (engineId === undefined || modelId === undefined) {
    return undefined;
  }
  const operation = options.operation ?? options.profile.hostedOperations?.[0];
  if (operation === undefined) {
    return undefined;
  }
  const clock = options.now ?? (() => Date.now());

  return {
    id: engineId,
    modality: options.profile.modality,
    capabilities: capabilitiesFor(engineId),
    // A hosted transport has no local health probe: "reachable" is decided by
    // the request itself, and a probe would be a billable call.
    healthCheck: async () => true,
    listModels: async () => [{ id: modelId, description: options.profile.label }],
    generate: async (request: GenerationRequest): Promise<GenerationResult> => {
      if (!adapterImplementsOperation({ transport: engineId, operation })) {
        throw new Error(
          `The "${engineId}" adapter does not implement the "${operation}" operation — refusing rather than posting a request nothing would collect.`,
        );
      }
      const mapping = mapHostedRequest({
        transport: engineId,
        operation,
        request,
        modelId,
        apiVersion,
      });
      if (mapping.kind === 'unsupported') {
        throw new Error(mapping.reason);
      }

      const startedAt = clock();
      const response = await options.transport.send({
        transport: engineId,
        operation,
        endpoint: mapping.plan.endpoint,
        apiVersion: mapping.plan.apiVersion,
        modelId: mapping.plan.modelId,
        body: mapping.plan.body,
        credential: options.credential,
      });
      const wallTimeMs = clock() - startedAt;

      const mapped = mapHostedResponse({ transport: engineId, response });
      if (mapped.kind === 'refused') {
        throw new Error(
          `${mapped.reason} (${describeOutboundRequest({
            transport: engineId,
            operation,
            endpoint: mapping.plan.endpoint,
            apiVersion: mapping.plan.apiVersion,
            modelId: mapping.plan.modelId,
            body: mapping.plan.body,
            credential: '',
          })})`,
        );
      }

      return {
        bytes: mapped.bytes,
        mimeType: mapped.mimeType,
        engine: engineId,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        metadata: {
          ...mapped.metadata,
          'hosted.requestId': mapped.requestId,
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
