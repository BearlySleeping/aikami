// packages/frontend/local-runtime/src/lib/text_llm_backend.ts
//
// Tier-2 local text backend: wraps the transformers.js WebGPU/WASM worker
// (`text_llm_worker.ts`) behind the `TextEngineBackend` contract so the
// LocalTaskPool can use it interchangeably with the native sidecar.
//
// Contract: C-427, C-507

import type { LocalModelBundle } from '@aikami/constants';
import type { TextEngineBackend } from './local_task_pool.ts';

// ---------------------------------------------------------------------------
// Worker protocol (mirrors text_llm_worker.ts)
// ---------------------------------------------------------------------------

type ReadyMessage = { type: 'ready'; backend: 'webgpu' | 'wasm' };
type CompleteMessage = { type: 'complete'; requestId: string; output: string };
type ErrorMessage = { type: 'error'; requestId?: string; message: string };
type WorkerResponse = ReadyMessage | CompleteMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Spawns the local text worker, initializes the pinned Qwen3 model, and
 * returns a backend that generates text. Rejects when the worker fails to
 * initialize so the caller can fall back to a cloud connection.
 */
export const createTransformersTextBackend = async (options: {
  bundle: LocalModelBundle;
  signal: AbortSignal;
  /** Default output cap when a request does not supply one. */
  maxTokens?: number;
  /** Default sampling temperature when a request does not supply one. */
  temperature?: number;
}): Promise<TextEngineBackend> => {
  const worker = new Worker(new URL('./text_llm_worker.ts', import.meta.url), {
    type: 'module',
  });

  const pending = new Map<
    string,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >();
  let nextRequestId = 0;

  const ready = new Promise<'webgpu' | 'wasm'>((resolve, reject) => {
    const onReady = (event: MessageEvent<WorkerResponse>): void => {
      const data = event.data;
      if (data.type === 'ready') {
        worker.removeEventListener('message', onReady);
        resolve(data.backend);
        return;
      }
      if (data.type === 'error' && !data.requestId) {
        worker.removeEventListener('message', onReady);
        reject(new Error(data.message));
      }
    };
    worker.addEventListener('message', onReady);
    worker.addEventListener(
      'error',
      (event) => reject(new Error(event.message || 'Text worker failed to start')),
      { once: true },
    );
    worker.postMessage({
      action: 'initialize',
      modelId: options.bundle.repo,
      revision: options.bundle.revision,
      device: 'webgpu',
    });
  });

  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const data = event.data;
    if (data.type === 'complete' && data.requestId) {
      pending.get(data.requestId)?.resolve(data.output);
      pending.delete(data.requestId);
      return;
    }
    if (data.type === 'error' && data.requestId) {
      pending.get(data.requestId)?.reject(new Error(data.message));
      pending.delete(data.requestId);
    }
  });

  const abortHandler = (): void => {
    worker.terminate();
    for (const request of pending.values()) {
      request.reject(new DOMException('Aborted', 'AbortError'));
    }
    pending.clear();
  };
  options.signal.addEventListener('abort', abortHandler, { once: true });

  const kind = await ready;

  return {
    kind,
    async generate(prompt: string): Promise<string> {
      const requestId = `local-text-${nextRequestId++}`;
      return await new Promise<string>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        worker.postMessage({
          action: 'run',
          requestId,
          prompt,
          maxTokens: options.maxTokens ?? 512,
          temperature: options.temperature ?? 0.3,
        });
      });
    },
    async dispose(): Promise<void> {
      options.signal.removeEventListener('abort', abortHandler);
      worker.terminate();
      for (const request of pending.values()) {
        request.reject(new Error('Local text backend disposed'));
      }
      pending.clear();
    },
  };
};
