// apps/frontend/client/src/lib/services/image/engine/base_url.ts
//
// Base URL resolution for image engines (C-388).
//
// Both adapters resolve from PUBLIC_IMAGE_URL (default http://localhost:8188).
// In emulator dev this is the Vite proxy path /api/image → localhost:8188.
// Per C-390 the bundled sd-server also binds 8188 (mutually exclusive
// defaults), so sd-server reuses the same base URL; PUBLIC_SDCPP_URL is an
// override for when sd-server runs on a different port.
//
// Contract: C-388 Image Engine Provider Abstraction

import type { ResolvedImageEngineId } from './types.ts';

/** Default base URL for local image engines (ComfyUI / sd-server). */
const DEFAULT_IMAGE_BASE_URL = 'http://localhost:8188';

/**
 * Resolves the base URL for an image engine.
 * @param engineId — Engine to resolve for.
 * @returns Trailing-slash-stripped base URL.
 */
export const resolveImageBaseUrl = (engineId: ResolvedImageEngineId): string => {
  if (engineId === 'sdcpp') {
    const override = (import.meta.env.PUBLIC_SDCPP_URL as string | undefined)?.trim();
    const fallback = (import.meta.env.PUBLIC_IMAGE_URL as string | undefined)?.trim();
    const base = (override || fallback || DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, '');
    assertSafeBaseUrl(base, 'sd-server');
    return base;
  }

  const base = (import.meta.env.PUBLIC_IMAGE_URL ?? DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, '');
  assertSafeBaseUrl(base, 'ComfyUI');
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
