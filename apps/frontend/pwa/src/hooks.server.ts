import type { Handle } from '@sveltejs/kit';

/**
 * Sets Cross-Origin-Isolation headers required for SharedArrayBuffer.
 * PixiJS v8 WebGPU backend requires SharedArrayBuffer, which is only
 * available in cross-origin isolated contexts.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  return response;
};
