// apps/frontend/client/src/lib/services/ai/text_provider_mode.ts
//
// Pure text-provider mode classification. Kept out of the gateway service so
// the routing rule can be unit tested without constructing the singleton or
// touching ConfigService.

import type { AiMode } from '@aikami/types';

/** Providers served by a local HTTP surface (localhost, no cloud credential). */
export const LOCAL_TEXT_PROVIDERS: ReadonlySet<string> = new Set(['ollama', 'llamacpp', 'ooba']);

/**
 * Chooses the text adapter mode for a provider.
 *
 * - A local provider with its own endpoint is an HTTP server (Ollama-native or
 *   OpenAI-compatible) and uses the `byok` transport so the connection's URL
 *   and model are honored.
 * - A local provider with no endpoint has no HTTP surface to call and falls
 *   back to the on-device pool (`offline`).
 * - Everything else is a cloud connection (`byok`).
 */
export const resolveTextProviderMode = (options: { provider: string; endpoint: string }): AiMode =>
  LOCAL_TEXT_PROVIDERS.has(options.provider) && options.endpoint.trim().length === 0
    ? 'offline'
    : 'byok';
