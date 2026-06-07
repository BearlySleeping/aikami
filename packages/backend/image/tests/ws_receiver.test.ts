// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/tests/ws_receiver.test.ts
import { describe, expect, test } from 'bun:test';
import { ComfyUIWsReceiver } from '../src/lib/ws_receiver.ts';

// ---------------------------------------------------------------------------
// AC3: WebSocket Binary Receiver
//   Tests the binary frame parsing and 8-byte header stripping behavior.
// ---------------------------------------------------------------------------

/**
 * A minimal WebSocket-like object for testing the receiver's message
 * handling logic without touching the real WebSocket global.
 */
type TestMessageHandler = (event: { data: unknown }) => void;

class TestSocket {
  onmessage: TestMessageHandler | null = null;
  onerror: ((_event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  private _closed = false;

  simulateText(data: Record<string, unknown>): void {
    if (this._closed || !this.onmessage) {
      return;
    }
    this.onmessage({ data: JSON.stringify(data) });
  }

  simulateBinary(data: Uint8Array): void {
    if (this._closed || !this.onmessage) {
      return;
    }
    this.onmessage({ data });
  }

  simulateError(msg: string): void {
    if (this._closed) {
      return;
    }
    if (this.onerror) {
      this.onerror(new Error(msg));
    }
  }

  close(): void {
    this._closed = true;
    if (this.onclose) {
      this.onclose();
    }
  }

  get isClosed(): boolean {
    return this._closed;
  }
}

/**
 * Creates a receiver with a pre-connected TestSocket injected so tests
 * can control message flow without real WebSocket connections.
 */
const createConnectedReceiver = (options: { baseUrl?: string; clientId?: string } = {}) => {
  const { baseUrl = 'http://localhost:8188', clientId = 'test-client' } = options;
  const socket = new TestSocket();

  // Bypass connect() by directly injecting the socket.
  // We cast through unknown since _ws is private.
  const receiver = new ComfyUIWsReceiver({ baseUrl, clientId });
  (receiver as unknown as { _ws: TestSocket })._ws = socket;

  return { receiver, socket };
};

describe('ComfyUIWsReceiver', () => {
  describe('listenForGeneration', () => {
    test('resolves with image data after receiving binary frame (AC3)', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({ promptId: 'prompt-1' });

      // Simulate execution start
      socket.simulateText({
        type: 'execution_start',
        data: { prompt_id: 'prompt-1' },
      });

      // Simulate executing node
      socket.simulateText({
        type: 'executing',
        data: { node: '8', prompt_id: 'prompt-1' },
      });

      // Simulate execution complete (node: null)
      socket.simulateText({
        type: 'executing',
        data: { node: null, prompt_id: 'prompt-1' },
      });

      // ComfyUI sends an 8-byte header before the image data
      const header = new Uint8Array([0, 0, 0, 8, 0, 0, 0, 0]);
      const actualImageBytes = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR
      ]);

      const fullBuffer = new Uint8Array(header.length + actualImageBytes.length);
      fullBuffer.set(header, 0);
      fullBuffer.set(actualImageBytes, header.length);

      socket.simulateBinary(fullBuffer);

      const result = await generationPromise;
      expect(result.imageData).toBeDefined();
      expect(result.mimeType).toBe('image/png');

      // AC3: Validate the 8-byte header has been stripped
      expect(result.imageData.length).toBe(actualImageBytes.length);
      expect(result.imageData[0]).toBe(0x89);
      expect(result.imageData[1]).toBe(0x50);
      expect(result.imageData[2]).toBe(0x4e);
      expect(result.imageData[3]).toBe(0x47);
    });

    test('strips 8-byte header from binary WS message (AC3 gotcha)', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({ promptId: 'prompt-2' });

      // Execution flow
      socket.simulateText({
        type: 'execution_start',
        data: { prompt_id: 'prompt-2' },
      });
      socket.simulateText({
        type: 'executing',
        data: { node: null, prompt_id: 'prompt-2' },
      });

      // 8-byte header + 5 JPEG bytes
      const header = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

      const fullMessage = new Uint8Array(header.length + imageData.length);
      fullMessage.set(header, 0);
      fullMessage.set(imageData, header.length);

      socket.simulateBinary(fullMessage);

      const result = await generationPromise;

      // AC3: Only image bytes, header stripped
      expect(result.imageData.length).toBe(5);
      expect(result.imageData[0]).toBe(0xff);
      expect(result.imageData[1]).toBe(0xd8);
      expect(result.imageData[2]).toBe(0xff);
      expect(result.imageData[3]).toBe(0xe0);
      expect(result.imageData[4]).toBe(0x00);

      // MIME detection
      expect(result.mimeType).toBe('image/jpeg');
    });

    test('rejects on WebSocket error during generation', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({ promptId: 'prompt-3' });

      socket.simulateText({
        type: 'execution_start',
        data: { prompt_id: 'prompt-3' },
      });
      socket.simulateError('Connection refused');

      await expect(generationPromise).rejects.toThrow('WebSocket error');
    });

    test('rejects on execution_error message from ComfyUI', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({ promptId: 'prompt-4' });

      socket.simulateText({
        type: 'execution_start',
        data: { prompt_id: 'prompt-4' },
      });
      socket.simulateText({
        type: 'execution_error',
        data: { prompt_id: 'prompt-4' },
      });

      await expect(generationPromise).rejects.toThrow('execution error');
    });

    test('respects AbortSignal to cancel in-flight generation', async () => {
      const { receiver } = createConnectedReceiver();
      const controller = new AbortController();

      const generationPromise = receiver.listenForGeneration({
        promptId: 'prompt-5',
        signal: controller.signal,
      });

      controller.abort();

      await expect(generationPromise).rejects.toThrow('aborted');
    });

    test('rejects on timeout if no image arrives', async () => {
      const { receiver } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({
        promptId: 'prompt-6',
        timeoutMs: 100,
      });

      await expect(generationPromise).rejects.toThrow('timed out');
    });

    test('ignores messages for other prompt_ids', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({
        promptId: 'my-prompt',
        timeoutMs: 1000,
      });

      // Send messages for a different prompt — should be ignored
      socket.simulateText({
        type: 'executing',
        data: { node: '1', prompt_id: 'other-prompt' },
      });
      socket.simulateText({
        type: 'execution_start',
        data: { prompt_id: 'other-prompt' },
      });

      // Now send the real completion
      socket.simulateText({
        type: 'executing',
        data: { node: '1', prompt_id: 'my-prompt' },
      });
      socket.simulateText({
        type: 'executing',
        data: { node: null, prompt_id: 'my-prompt' },
      });

      const header = new Uint8Array(8);
      const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const full = new Uint8Array(header.length + image.length);
      full.set(header, 0);
      full.set(image, header.length);

      socket.simulateBinary(full);

      const result = await generationPromise;
      expect(result.mimeType).toBe('image/png');
    });

    test('rejects on WebSocket close before completion', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({ promptId: 'prompt-7' });

      socket.simulateText({
        type: 'execution_start',
        data: { prompt_id: 'prompt-7' },
      });
      socket.close();

      await expect(generationPromise).rejects.toThrow('closed before generation');
    });
  });

  describe('_parseBinaryFrame (via listenForGeneration)', () => {
    test('throws on buffer that is too short', async () => {
      const { receiver, socket } = createConnectedReceiver();

      const generationPromise = receiver.listenForGeneration({ promptId: 'prompt-8' });

      socket.simulateText({
        type: 'executing',
        data: { node: null, prompt_id: 'prompt-8' },
      });

      // Too short — only 5 bytes (less than 8-byte header)
      socket.simulateBinary(new Uint8Array([1, 2, 3, 4, 5]));

      await expect(generationPromise).rejects.toThrow('Binary frame too short');
    });
  });
});
