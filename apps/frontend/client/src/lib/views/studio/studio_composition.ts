// apps/frontend/client/src/lib/views/studio/studio_composition.ts
//
// C-512: production wiring for the Creator Studio. This is the only module in
// the feature that imports the `$services` barrel; the ViewModel receives the
// resolved capabilities as a typed option.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { studioRecipeLabel } from '@aikami/constants';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';

import type {
  StudioRecipeOption,
  GenerationRunnerAvailability as StudioRunnerAvailability,
} from '@aikami/types';
import {
  assetManager,
  assetPrefetchService,
  audioCandidateReview,
  createGeneratedAssetWorkflow,
  detectImageEngine,
  hubApiBase,
  hubAuthHeaders,
  imageGenerationService,
  isAssetGenerationEnabled,
  isAssetPublishingEnabled,
  isAudioGenerationEnabled,
  runtimeConfigService,
} from '$services';
import { createStudioAudioAdapter } from './studio_audio_adapter.ts';
import { buildStudioDispatch } from './studio_dispatch_spec.ts';
import {
  buildModalityRecipeOptions,
  createStudioEngineRegistry,
  createStudioGenerationRunner,
  type StudioEngineCapability,
} from './studio_generation_runner.ts';
import {
  createStudioHubEngine,
  type HubDispatchStatus,
  type LoopbackProbeResult,
  resolveStudioTransport,
  type StudioHubGateway,
  StudioHubRefusal,
} from './studio_hub_transport.ts';
import { createStudioViewModel, type StudioViewModelInterface } from './studio_view_model.svelte';

/**
 * The Hub transport for the paired-outbound route (C-522).
 *
 * Kept as a lazily-built plain object rather than a service: the studio is the
 * only consumer, and `studio_composition.ts` is already the single `$services`
 * importer for this feature. Requests carry the session (`credentials:
 * 'include'`, or the desktop bearer token) exactly as the community-asset
 * transport does.
 */
const hubGenerationRequest = async (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${hubApiBase().replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      ...hubAuthHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    credentials: 'include',
  });

/**
 * The Hub gateway the studio's Hub adapter talks through.
 *
 * Five calls, no more: a sixth would be a code path the availability resolver
 * does not account for, which is exactly how "available" drifts away from
 * "works".
 */
const studioHubGateway = (): StudioHubGateway => ({
  createDispatch: async (request) => {
    const response = await hubGenerationRequest('/generation/dispatches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new StudioHubRefusal(
        'hub_refused',
        `the hub refused the dispatch (${response.status})`,
      );
    }
    return (await response.json()) as { dispatchId: string };
  },
  getDispatch: async (dispatchId): Promise<HubDispatchStatus> => {
    const response = await hubGenerationRequest(
      `/generation/dispatches/${encodeURIComponent(dispatchId)}`,
    );
    if (!response.ok) {
      throw new StudioHubRefusal('hub_not_found', `no dispatch ${dispatchId}`);
    }
    return (await response.json()) as HubDispatchStatus;
  },
  listArtifacts: async (dispatchId) => {
    const response = await hubGenerationRequest(
      `/generation/dispatches/${encodeURIComponent(dispatchId)}/artifacts`,
    );
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as Awaited<ReturnType<StudioHubGateway['listArtifacts']>>;
  },
  requestCancel: async (dispatchId) => {
    const response = await hubGenerationRequest(
      `/generation/dispatches/${encodeURIComponent(dispatchId)}/cancel`,
      { method: 'POST' },
    );
    if (!response.ok) {
      // A cancel we could not ask for is reported as unconfirmed, never as a
      // stop that happened.
      return { cancellation: { confirmed: false } };
    }
    return (await response.json()) as { cancellation: { confirmed: boolean } };
  },
  fetchArtifact: async (retrievalPath) => {
    const response = await hubGenerationRequest(retrievalPath.replace(/^\/api/, ''));
    if (!response.ok) {
      throw new StudioHubRefusal('artifact_unavailable', 'the private preview is not retrievable');
    }
    return response.blob();
  },
});

/**
 * The Hub-backed image engine, exposed as a plain adapter.
 *
 * The image modality has exactly one registered adapter, so the two routes are
 * composed *here* rather than fighting over the registry slot: `isAvailable`
 * reports the resolved transport, and `generate` walks whichever route it
 * resolved to.
 */
const hubImageAdapter = createStudioHubEngine({
  gateway: studioHubGateway(),
  buildDispatch: buildStudioDispatch,
  timeoutMs: 900_000,
  pollIntervalMs: 2_000,
});

/**
 * Resolve the image modality's transport for this session.
 *
 * Direct loopback is probed first (no Hub round-trip, no account). Only when it
 * is unavailable does the Hub get asked, and the Hub's answer is only trusted
 * when the session can actually reach it — a failed availability call resolves
 * to "no paired runner" with the pairing remedy, never to an optimistic
 * `available: true` that the first dispatch would then contradict.
 */
const resolveImageTransport = async (): Promise<StudioRunnerAvailability> => {
  await runtimeConfigService.loadConfig();
  const engine = await detectImageEngine().catch(() => undefined);
  const loopback: LoopbackProbeResult = engine
    ? { state: 'available', engineUrl: 'configured' }
    : await probeLoopbackBlocked();
  if (loopback.state === 'available') {
    // Direct loopback wins outright, so skip the credentialed Hub request
    // entirely rather than asking a Hub the result will ignore.
    return resolveStudioTransport({ loopback, hub: undefined, hubConfigured: false });
  }
  const hub = await fetchHubAvailability();
  return resolveStudioTransport({ loopback, hub: hub.availability, hubConfigured: hub.configured });
};

/**
 * Distinguish "nothing configured" from "the browser refused".
 *
 * A configured-but-refused endpoint is a *stated limitation* with a documented
 * fallback; treating it as "nothing configured" would hide the permission
 * problem behind a generic message and invite a retry loop.
 */
const probeLoopbackBlocked = async (): Promise<LoopbackProbeResult> => {
  try {
    // A configured endpoint that the probe could not reach is either a stopped
    // engine or a browser that refused local-network access. Both are a
    // *stated* limitation with a documented fallback; treating them as
    // "nothing configured" would hide the permission problem.
    const configured = runtimeConfigService.getImageUrl();
    if (!configured) {
      return { state: 'unconfigured' };
    }
    return {
      state: 'blocked',
      reason: `the configured endpoint ${configured} could not be reached from this browser`,
    };
  } catch {
    return {
      state: 'blocked',
      reason: 'the browser denied local-network access to the configured endpoint',
    };
  }
};

/** Ask the Hub whether a paired runner is usable, tolerating an unreachable Hub. */
const fetchHubAvailability = async (): Promise<{
  configured: boolean;
  availability: StudioRunnerAvailability | undefined;
}> => {
  try {
    const response = await hubGenerationRequest('/generation/runners/availability');
    if (!response.ok) {
      // 401 on a build with a Hub origin means "signed out", which is a
      // *configured* Hub that cannot help yet.
      return { configured: true, availability: undefined };
    }
    return {
      configured: true,
      availability: (await response.json()) as StudioRunnerAvailability,
    };
  } catch {
    return { configured: false, availability: undefined };
  }
};

/**
 * The studio's engine registry (C-513 AC-12).
 *
 * One adapter per modality. C-521 registers the audio adapter against this same
 * registry and the audio recipes become available without a change here — there
 * is no `modality === 'image'` switch left to update.
 *
 * C-522 composes the *image* adapter rather than adding a second `image` slot:
 * `isAvailable` reports the resolved transport (direct loopback first, paired
 * outbound otherwise) and `generate` walks whichever route it resolved to. That
 * is what keeps a blocked loopback from becoming a false "available".
 */
const engineRegistry = createStudioEngineRegistry([
  {
    modality: 'image',
    unavailableReason:
      'No image engine is reachable — start the local engine (sd-server) or pair a runner, then reload.',
    isAvailable: async (): Promise<boolean> => (await resolveImageTransport()).available,
    generate: async (options) => {
      const transport = await resolveImageTransport();
      if (transport.available && transport.mode === 'paired_outbound') {
        return hubImageAdapter.generate(options);
      }
      const result = await imageGenerationService.generateImage({
        prompt: options.prompt,
        ...(options.negativePrompt === undefined ? {} : { negativePrompt: options.negativePrompt }),
        ...(options.initImage === undefined ? {} : { initImage: options.initImage }),
        ...(options.referenceImages === undefined
          ? {}
          : { referenceImages: options.referenceImages }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      return {
        blob: result.blob,
        mimeType: result.mimeType,
        engineId: result.engineId,
        ...(result.seed === undefined ? {} : { seed: result.seed }),
        isDemo: result.isDemo,
      };
    },
    cancel: () => {
      hubImageAdapter.cancel();
      imageGenerationService.cancel();
    },
  },
  // C-521: the audio adapter — the same registry, keyed by `recipe.modality`.
  // It states its own unavailability reason (see studio_audio_adapter.ts)
  // instead of leaving audio recipes silently greyed out.
  createStudioAudioAdapter(),
]);

/**
 * The byte/descriptor seam for one modality.
 *
 * A dedicated workflow per engine — the contextual trigger owns the shared
 * singleton. The studio holds pending bytes between the review step and the
 * save, and must not evict a contextual generation's pending result.
 */
const createStudioWorkflow = (adapter: StudioEngineCapability) =>
  createGeneratedAssetWorkflow({
    generateImage: (options) => adapter.generate(options),
    registerGenerated: (asset, bytes) => assetManager.registerGenerated(asset, bytes),
  });

/** The shared, modality-neutral generation runner (C-513 AC-12). */
const studioRunner = createStudioGenerationRunner({
  registry: engineRegistry,
  createWorkflow: createStudioWorkflow,
});

/**
 * Opens everything the studio reads before it reads it.
 *
 * `/studio/assets` is reachable from the start menu and by deep link, so it can
 * load before the game boot pipeline has opened the registry — and
 * `resolveImageBaseUrl` reads the runtime config, which is empty until
 * `loadConfig()` resolves. Both calls are memoized/idempotent.
 */
const ensureStudioReady = async (): Promise<void> => {
  await runtimeConfigService.loadConfig();
  await assetPrefetchService.ensureRegistryReady();
};

/**
 * Recipe options with availability resolved per modality (C-513 AC-12).
 *
 * Every recipe — image and audio alike — resolves through the engine registry
 * keyed by `recipe.modality`; an audio recipe reports `engineAvailable: true`
 * as soon as an audio adapter is registered, and carries a stated reason while
 * none is.
 */
const buildRecipeOptions = async (): Promise<readonly StudioRecipeOption[]> => {
  await runtimeConfigService.loadConfig();
  return buildModalityRecipeOptions({
    registry: engineRegistry,
    label: studioRecipeLabel,
  });
};

/**
 * Builds the Creator Studio ViewModel wired to the production engine, registry
 * and library.
 */
export const getStudioViewModel = (options: BaseViewModelOptions): StudioViewModelInterface =>
  createStudioViewModel({
    ...options,
    capabilities: {
      ensureReady: ensureStudioReady,
      listRecipeOptions: buildRecipeOptions,
      generate: (request) => studioRunner.generate(request),
      save: (request) => studioRunner.save(request),
      cancelGeneration: () => studioRunner.cancel(),
      listLibrary: () => assetManager.listGeneratedAssets(),
      renameGenerated: (request) => assetManager.renameGeneratedAsset(request),
      deleteGenerated: (request) => assetManager.deleteGeneratedAsset(request),
      isGenerationEnabled: () => isAssetGenerationEnabled(),
      // C-521 AC-6: the audio flag disables new generation only — playback and
      // accepted assets are untouched by it.
      isAudioGenerationEnabled: () => isAudioGenerationEnabled(),
      // C-521 AC-4: the decoded-buffer review player.
      audioReview: audioCandidateReview,
      isPublishingEnabled: () => isAssetPublishingEnabled(),
      // The provenance projection comes from the asset's own registry row —
      // never a fabricated licence. An unknown source publishes as an empty
      // source, which the hub's gate refuses (fail closed).
      publish: async (request) => {
        const library = await assetManager.listGeneratedAssets();
        const entry = library.find((candidate) => candidate.tag === request.tag);
        return assetManager.publishCommunityAsset(request.tag, {
          title: request.title,
          provenance: { source: entry?.provenance.source ?? '' },
        });
      },
    },
  });
