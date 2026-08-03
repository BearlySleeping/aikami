// apps/frontend/client/src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

/**
 * Sets Cross-Origin-Isolation headers for the browser (web) deployment.
 * Enables SharedArrayBuffer for the engine's shared-memory buffer path in
 * Chromium/Firefox. WebKitGTK (Tauri desktop) does not implement SAB, so the
 * desktop build always uses the ArrayBuffer fallback regardless of these
 * headers — the Tauri CSP/headers in src-tauri/tauri.conf.json do not set them.
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
