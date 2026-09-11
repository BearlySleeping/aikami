// apps/frontend/client/src/lib/views/settings/ai/ai_provider_registry.ts
//
// Pure provider-registry lookups shared by the AI settings projections, the
// connection-status store, and the ViewModel. No state, no services.

import { IMAGE_PROVIDERS, TEXT_PROVIDERS, VOICE_PROVIDERS } from '@aikami/constants';
import type { ConnectionCapability } from '$types';

/** Registry ids that run locally (no cloud auth). */
export const LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'ollama',
  'llamacpp',
  'ooba',
  'comfyui',
  'webui',
  'sdcpp',
  'kokoro',
  'voicevox',
  'fish-speech',
]);

/** Returns the provider registry for a capability (text is the fallback). */
export const registryForCapability = (capability: ConnectionCapability) => {
  if (capability === 'image') {
    return IMAGE_PROVIDERS;
  }
  if (capability === 'voice') {
    return VOICE_PROVIDERS;
  }
  return TEXT_PROVIDERS;
};

/** The registry entry for a provider id within a capability's registry. */
export const registryEntryFor = (capability: ConnectionCapability, registryId: string) =>
  registryForCapability(capability).find((provider) => provider.id === registryId);

/** Whether a provider needs an editable server URL for its capability. */
export const registryNeedsUrl = (capability: ConnectionCapability, registryId: string): boolean => {
  if (capability === 'image') {
    return ['comfyui', 'webui', 'sdcpp', 'openai-compat'].includes(registryId);
  }
  if (capability === 'voice') {
    return ['voicevox', 'fish-speech'].includes(registryId);
  }
  return ['ollama', 'llamacpp', 'ooba', 'custom'].includes(registryId);
};

/** Resolves a provider's display label by registry id across all registries. */
export const registryLabel = (registryId: string): string | undefined => {
  for (const registry of [TEXT_PROVIDERS, VOICE_PROVIDERS, IMAGE_PROVIDERS]) {
    const found = registry.find((provider) => provider.id === registryId);
    if (found) {
      return found.label;
    }
  }
  return undefined;
};
