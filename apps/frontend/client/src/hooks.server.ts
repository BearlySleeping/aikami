// apps/frontend/client/src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

/**
 * Sets Cross-Origin-Isolation headers required for SharedArrayBuffer.
 * PixiJS v8 WebGPU backend requires SharedArrayBuffer, which is only
 * available in cross-origin isolated contexts.
 *
 * COEP is relaxed to `unsafe-none` in emulator mode so the Firebase
 * Auth emulator popup/iframe relay can communicate cross-origin.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  const isEmulator = process.env.AIKAMI_MODE === 'emulator';

  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!isEmulator) {
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }

  return response;
};
