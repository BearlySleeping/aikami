// apps/frontend/client/src/lib/services/image/engine/base_url.ts
//
// Base URL resolution for image engines (C-388 + C-389).
//
// C-389: the image engine URL resolves from the runtime config chain
// (localStorage dev override → Tauri config file → ./config.json →
// dev-only PUBLIC_* defaults → unset). No engine URL literal may exist in
// a production bundle (AC-1), so there is deliberately no localhost
// default here — an unconfigured engine resolves to `undefined` and the
// adapters report unavailable instead of probing a baked-in host.
//
// In emulator dev the Vite proxy path /api/image (PUBLIC_IMAGE_URL) flows
// through runtimeConfigService's dev-default rung, so the same-origin
// relative path is still accepted by assertSafeBaseUrl.
//
// C-463 wiring: prefers the `portrait` role's connection provider, falling
// back to runtimeConfigService.getImageUrl() exactly as before when no
// portrait role resolves — that is the local-stack path and the common
// case today.
//
// Contract: C-388 Image Engine Provider Abstraction / C-389 AC-1, AC-2

import { configService } from '../../config/config_service.svelte.ts';
import { runtimeConfigService } from '../../config/runtime_config_service.svelte.ts';
import type { ResolvedImageEngineId } from './types.ts';

/**
 * Resolves the base URL for an image engine from the runtime config.
 * @param engineId — Engine to resolve for (kept for call-site clarity).
 * @returns Trailing-slash-stripped base URL, or undefined when no image
 *          engine is configured (precedence rung 5 — unset).
 */
export const resolveImageBaseUrl = (engineId: ResolvedImageEngineId): string | undefined => {
  const roleEndpoint = configService.resolveRole('portrait')?.endpoint;
  const configured = (roleEndpoint || runtimeConfigService.getImageUrl())?.trim();
  if (!configured) {
    return undefined;
  }

  const base = configured.replace(/\/+$/, '');
  assertSafeBaseUrl(base, engineId === 'sdcpp' ? 'sd-server' : 'ComfyUI');
  return base;
};

/**
 * Validates that an engine base URL is http(s) or a same-origin relative
 * path (the Vite `/api/image` proxy). Rejects non-http schemes (file, ftp,
 * data, javascript, ...) so a compromised config cannot exfiltrate.
 */
const assertSafeBaseUrl = (baseUrl: string, engineName: string): void => {
  if (baseUrl.startsWith('/') && !baseUrl.startsWith('//')) {
    return; // same-origin relative path (Vite dev proxy), e.g. "/api/image"
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error(
      `[${engineName}] Invalid base URL "${baseUrl}" — only http(s) or a relative /api path is allowed`,
    );
  }
};
