// packages/backend/audio/tests/tts_websocket_handler.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createTtsWebSocketHandler } from '../src/lib/tts_websocket_handler.ts';

/** Stored per-connection handler sessions. */
type TtsSession = ReturnType<typeof createTtsWebSocketHandler>;

describe('TtsWebSocketHandler', () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  let serverUrl: string | undefined;
  let sessions = new WeakMap<ServerWebSocket<unknown>, TtsSession>();

  const startServer = (): Promise<string> => {
    return new Promise((resolve) => {
      sessions = new WeakMap();
      server = Bun.serve({
        port: 0,
        websocket: {
          open(ws: ServerWebSocket<unknown>) {
            const session = createTtsWebSocketHandler(ws);
            sessions.set(ws, session);
          },
          message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
            const session = sessions.get(ws);
            if (session) {
              session.onMessage(message);
            }
          },
          close(ws: ServerWebSocket<unknown>) {
            const session = sessions.get(ws);
            if (session) {
              session.onClose();
            }
            sessions.delete(ws);
          },
        },
        fetch(req, srv) {
          if (srv.upgrade(req)) {
            return;
          }
          return new Response('Not a WebSocket request', { status: 426 });
        },
      });
      serverUrl = `ws://localhost:${server.port}`;
      resolve(serverUrl);
    });
  };

  afterEach(() => {
    if (server) {
      server.stop();
      server = undefined;
      serverUrl = undefined;
    }
  });

  const connectClient = async (): Promise<WebSocket> => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = new WebSocket(serverUrl ?? '');
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
    return ws;
  };

  test('receives audio_start control message on first text', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    const messages: unknown[] = [];
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        messages.push(JSON.parse(event.data));
      }
    };

    ws.send(JSON.stringify({ type: 'text', data: 'Hello.' }));

    await new Promise((r) => setTimeout(r, 500));

    const controlMessages = messages.filter(
      (m) => (m as Record<string, unknown>).type === 'audio_start',
    );
    expect(controlMessages.length).toBe(1);
    expect(controlMessages[0]).toHaveProperty('messageId');

    ws.close();
  });

  test('receives audio_end control message after last sentence', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    const receivedMessages: Array<{ type: string }> = [];
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        receivedMessages.push(JSON.parse(event.data));
      }
    };

    ws.send(JSON.stringify({ type: 'text', data: 'Hello world.' }));
    ws.send(JSON.stringify({ type: 'end' }));

    await new Promise((r) => setTimeout(r, 500));

    const audioStart = receivedMessages.filter((m) => m.type === 'audio_start');
    const audioEnd = receivedMessages.filter((m) => m.type === 'audio_end');

    expect(audioStart.length).toBe(1);
    expect(audioEnd.length).toBe(1);

    ws.close();
  });

  test('receives binary audio frames', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    let binaryCount = 0;
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        binaryCount++;
      }
    };

    ws.send(JSON.stringify({ type: 'text', data: 'Hello there.' }));

    await new Promise((r) => setTimeout(r, 500));

    expect(binaryCount).toBeGreaterThanOrEqual(1);

    ws.close();
  });

  test('multiple sentences produce multiple binary frames', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    let binaryCount = 0;
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        binaryCount++;
      }
    };

    ws.send(JSON.stringify({ type: 'text', data: 'First sentence! Second sentence? Third one.' }));

    await new Promise((r) => setTimeout(r, 1000));

    expect(binaryCount).toBeGreaterThanOrEqual(3);

    ws.close();
  });

  test('client disconnect triggers worker cleanup', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    ws.send(JSON.stringify({ type: 'text', data: 'Hello.' }));

    await new Promise((r) => setTimeout(r, 100));

    ws.close();

    await new Promise((r) => setTimeout(r, 300));

    // No crash, server still up — verify by reconnecting
    const ws2 = await connectClient();
    const messages: unknown[] = [];
    ws2.onmessage = (event) => {
      if (typeof event.data === 'string') {
        messages.push(JSON.parse(event.data));
      }
    };

    ws2.send(JSON.stringify({ type: 'text', data: 'After disconnect.' }));
    await new Promise((r) => setTimeout(r, 500));

    const audioStarts = messages.filter(
      (m) => (m as Record<string, unknown>).type === 'audio_start',
    );
    expect(audioStarts.length).toBe(1);

    ws2.close();
  });

  test('error message sent for invalid input', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    const messages: Array<{ type: string }> = [];
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        messages.push(JSON.parse(event.data));
      }
    };

    ws.send('not valid json');

    await new Promise((r) => setTimeout(r, 300));

    const errors = messages.filter((m) => m.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);

    ws.close();
  });

  test('fragmented text buffers correctly across messages', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    let binaryCount = 0;
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        binaryCount++;
      }
    };

    ws.send(JSON.stringify({ type: 'text', data: 'Hello' }));
    ws.send(JSON.stringify({ type: 'text', data: ' there' }));
    ws.send(JSON.stringify({ type: 'text', data: '!' }));

    await new Promise((r) => setTimeout(r, 500));

    expect(binaryCount).toBe(1);

    ws.close();
  });

  test('binary frames contain valid Float32 PCM data', async () => {
    if (!serverUrl) {
      await startServer();
    }
    const ws = await connectClient();

    let audioBuffer: ArrayBuffer | undefined;
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        audioBuffer = event.data;
      }
    };

    ws.send(JSON.stringify({ type: 'text', data: 'Test audio.' }));

    await new Promise((r) => setTimeout(r, 500));

    expect(audioBuffer).toBeDefined();
    if (audioBuffer) {
      expect(audioBuffer.byteLength).toBe(2400 * 4); // 2400 float32 × 4 bytes
      const samples = new Float32Array(audioBuffer);
      expect(samples.length).toBe(2400);
    }

    ws.close();
  });
});
