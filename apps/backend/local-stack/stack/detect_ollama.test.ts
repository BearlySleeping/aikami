/**
 * apps/backend/local-stack/stack/detect_ollama.test.ts
 *
 * `probeOllama` never throws and never false-positives on an unrelated
 * service — it must look like Ollama's own `/api/tags` shape, not just
 * "something answered".
 */

import { describe, expect, test } from 'bun:test';
import { probeOllama } from './detect_ollama.ts';

/** `Bun.serve`'s `.port` is typed `number | undefined`; port 0 always binds one. */
const portOf = (server: { readonly port?: number }): number => {
  if (server.port === undefined) {
    throw new Error('server did not bind a port');
  }
  return server.port;
};

describe('probeOllama', () => {
  test('true when an Ollama-shaped /api/tags responds', async () => {
    using server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname === '/api/tags') {
          return Response.json({ models: [{ name: 'qwen2.5:1.5b' }] });
        }
        return new Response('not found', { status: 404 });
      },
    });
    await expect(probeOllama(portOf(server))).resolves.toBe(true);
  });

  test('false when nothing is listening on the port', async () => {
    // Port 1 is a privileged port nothing binds to in CI; treated the same
    // as connection-refused on any free ephemeral port.
    await expect(probeOllama(1)).resolves.toBe(false);
  });

  test('false when the port answers but is not Ollama-shaped', async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response('<html>hello</html>', { status: 200 }),
    });
    await expect(probeOllama(portOf(server))).resolves.toBe(false);
  });

  test('false when the port answers with an error status', async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response('nope', { status: 500 }),
    });
    await expect(probeOllama(portOf(server))).resolves.toBe(false);
  });
});
