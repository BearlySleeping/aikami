// apps/frontend/client/src/lib/views/settings/connection/connection_provider_rules.ts
//
// Pure provider/capability rules for the Connection Manager. No state, no
// services, no runes — just the per-capability registry projection and the
// field rules the editor uses to decide which inputs to show. Kept separate
// from the ViewModel so the rules are directly unit-testable and the ViewModel
// holds only editor/draft orchestration.

import { IMAGE_PROVIDERS, TEXT_PROVIDERS, VOICE_PROVIDERS } from '@aikami/constants';
import type { ConnectionCapability } from '$types';

/** Provider descriptor as projected for the connection editor. */
export type ConnectionProviderOption = {
  id: string;
  label: string;
  description: string;
  needsKey: boolean;
  needsUrl?: boolean;
  isLocal: boolean;
};

/**
 * Local providers that get a live probe + web setup guide when selected.
 * Probing localhost from an HTTPS origin triggers the browser's Private
 * Network Access permission prompt — that's intentional and user-initiated.
 */
export const LOCAL_GUIDE_PROVIDERS: ReadonlySet<string> = new Set(['ollama']);

/** Default provider id when opening the editor for a capability. */
export const DEFAULT_PROVIDER_BY_CAPABILITY: Record<ConnectionCapability, string> = {
  text: 'openrouter',
  image: 'comfyui',
  voice: 'kokoro',
};

/**
 * Returns the provider registry for a capability, projected with the
 * needsKey/needsUrl/isLocal rules the editor renders from. Falls back to the
 * text registry for an unknown/omitted capability.
 */
export const providerOptionsForCapability = (
  capability: ConnectionCapability | undefined,
): readonly ConnectionProviderOption[] => {
  const resolved = capability ?? 'text';
  if (resolved === 'image') {
    return IMAGE_PROVIDERS.map((provider) => ({
      ...provider,
      needsKey: provider.id !== 'comfyui' && provider.id !== 'webui' && provider.id !== 'sdcpp',
      needsUrl:
        provider.id === 'comfyui' ||
        provider.id === 'webui' ||
        provider.id === 'sdcpp' ||
        provider.id === 'openai-compat',
      isLocal: provider.id === 'comfyui' || provider.id === 'webui' || provider.id === 'sdcpp',
    }));
  }
  if (resolved === 'voice') {
    return VOICE_PROVIDERS.map((provider) => ({
      ...provider,
      needsKey: provider.id === 'elevenlabs' || provider.id === 'openai',
      needsUrl:
        provider.id === 'kokoro' || provider.id === 'voicevox' || provider.id === 'fish-speech',
      isLocal:
        provider.id === 'kokoro' || provider.id === 'voicevox' || provider.id === 'fish-speech',
    }));
  }
  return TEXT_PROVIDERS;
};

/** Whether a provider needs a user-supplied URL for the given capability. */
export const capabilityProviderNeedsUrl = (
  capability: ConnectionCapability,
  provider: string,
): boolean => {
  if (capability === 'image') {
    return ['comfyui', 'webui', 'sdcpp', 'openai-compat'].includes(provider);
  }
  if (capability === 'voice') {
    return ['kokoro', 'voicevox', 'fish-speech'].includes(provider);
  }
  return ['ollama', 'llamacpp', 'ooba', 'custom'].includes(provider);
};
