/// <reference lib="webworker" />
// packages/backend/audio/src/lib/tts_worker_script.ts
//
// This file runs inside a Bun Worker thread. It receives TTS jobs via
// `self.onmessage`, runs the synthetic ONNX runtime, and posts results
// back to the main thread via `self.postMessage`.
//
// NOTE: This file is loaded as a Bun Worker, NOT imported as a module.
// It runs in its own thread with access to `self` (WorkerGlobalScope).

import { SyntheticOnnxRuntime } from './synthetic_onnx_runtime.ts';
import type { TtsJob, TtsJobResult } from './tts_worker_pool.ts';

/** Lazily-initialized ONNX runtime singleton — created once per worker. */
let _runtime: SyntheticOnnxRuntime | undefined;

const getRuntime = (): SyntheticOnnxRuntime => {
  if (!_runtime) {
    _runtime = new SyntheticOnnxRuntime();
  }
  return _runtime;
};

/** Message type received from the main thread. */
type WorkerMessage = { type: 'process'; job: TtsJob } | { type: 'terminate' };

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'terminate') {
    self.close();
    return;
  }

  if (message.type === 'process') {
    const { job } = message;

    try {
      const runtime = getRuntime();
      const { audio, sampleRate, durationSeconds } = await runtime.generate({ text: job.text });

      const result: TtsJobResult = {
        jobId: job.id,
        audio,
        sampleRate,
        durationSeconds,
        sequence: job.sequence,
      };

      self.postMessage(result);
    } catch (error) {
      // Forward error to main thread
      self.postMessage({
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
        sequence: job.sequence,
      });
    }
  }
};
