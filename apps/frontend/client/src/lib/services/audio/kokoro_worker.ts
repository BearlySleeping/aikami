// apps/frontend/client/src/lib/services/audio/kokoro_worker.ts

/**
 * Dedicated Web Worker wrapping the 82M Kokoro TTS model for native,
 * zero-setup text-to-speech in the browser via WebGPU.
 *
 * Communicates with the main thread through postMessage actions:
 * - `initialize` — configure ONNX runtime and load the Kokoro model
 * - `synthesize` — run text through the tokenizer + forward pass, return PCM
 *
 * Contract: C-131
 */

import { env } from '@huggingface/transformers';

// Disable local model fallback — all model weights are fetched from HuggingFace CDN
env.allowLocalModels = false;

// ---------------------------------------------------------------------------
// Worker-scoped state
// ---------------------------------------------------------------------------

type KokoroSession = Awaited<ReturnType<typeof import('kokoro-js').KokoroTTS.from_pretrained>>;
let session: KokoroSession | null = null;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type InitializeMessage = {
  action: 'initialize';
};

type SynthesizeMessage = {
  action: 'synthesize';
  text: string;
  voice: string;
};

type WorkerMessage = InitializeMessage | SynthesizeMessage;

type InitializeResponse = {
  type: 'ready';
};

type SynthesizeResponse = {
  type: 'complete';
  pcmData: Float32Array;
  sampleRate: number;
};

type ErrorResponse = {
  type: 'error';
  message: string;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handleInitialize = async (): Promise<void> => {
  try {
    // Dynamically import ONNX Runtime WebGPU backend — configures the
    // execution provider before Kokoro attempts to create its session.
    const ort = await import('onnxruntime-web/webgpu');

    // Set WASM paths to a CDN so the WASM SIMD binaries are fetched
    // without requiring a local copy in the static directory.
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/';

    // Dynamically import Kokoro after ORT is configured
    const { KokoroTTS } = await import('kokoro-js');

    session = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', {
      dtype: 'q8',
      device: 'webgpu',
      // @ts-expect-error — enableGraphCapture is passed through to ONNX
      // runtime but may not be in kokoro-js TS types.
      enableGraphCapture: true,
    });

    const response: InitializeResponse = { type: 'ready' };
    self.postMessage(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown initialization error';
    const response: ErrorResponse = { type: 'error', message };
    self.postMessage(response);
  }
};

const handleSynthesize = async (options: { text: string; voice: string }): Promise<void> => {
  const { text, voice } = options;

  if (!session) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Kokoro session not initialized. Call initialize first.',
    };
    self.postMessage(response);
    return;
  }

  if (!text.trim()) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Empty text — nothing to synthesize.',
    };
    self.postMessage(response);
    return;
  }

  try {
    const result = await session.generate(
      text,
      // kokoro-js voice type is a union of known presets; cast the
      // incoming string to satisfy the narrow union constraint.
      { voice } as Parameters<typeof session.generate>[1],
    );

    // Transfer the PCM buffer ownership to the main thread for zero-copy
    // postMessage. The buffer is no longer usable in the worker afterwards.
    const pcmData = result.audio;
    const sampleRate = result.sampling_rate;

    const response: SynthesizeResponse = { type: 'complete', pcmData, sampleRate };
    self.postMessage(response, { transfer: [pcmData.buffer] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Synthesis failed';
    const response: ErrorResponse = { type: 'error', message };
    self.postMessage(response);
  }
};

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;

  switch (data.action) {
    case 'initialize':
      handleInitialize();
      break;

    case 'synthesize':
      handleSynthesize({ text: data.text, voice: data.voice });
      break;

    default:
      break;
  }
};
