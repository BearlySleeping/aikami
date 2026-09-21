// packages/frontend/local-runtime/src/lib/text_llm_backend.ts
//
// Tier-2 local text backend: wraps the transformers.js WebGPU/WASM worker
// (`text_llm_worker.ts`) behind the `TextEngineBackend` contract so the
// LocalTaskPool can use it interchangeably with the native sidecar.
//
// Contract: C-427, C-507

import type { LocalModelBundle } from '@aikami/constants';
import type { TextEngineBackend, TextEngineGenerateOptions } from './local_task_pool.ts';

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
    {
      resolve: (value: string) => void;
      reject: (error: Error) => void;
      cleanup?: () => void;
    }
  >();
  let nextRequestId = 0;

  /** Rejects and clears every in-flight generation. */
  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) {
      request.cleanup?.();
      request.reject(error);
    }
    pending.clear();
  };

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
      const request = pending.get(data.requestId);
      request?.cleanup?.();
      request?.resolve(data.output);
      pending.delete(data.requestId);
      return;
    }
    if (data.type === 'error' && data.requestId) {
      const request = pending.get(data.requestId);
      request?.cleanup?.();
      request?.reject(new Error(data.message));
      pending.delete(data.requestId);
    }
  });

  // A fatal worker crash has no requestId and must reject every in-flight
  // generation — otherwise the caller's promise hangs until its own timeout.
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Text worker crashed');
    rejectAll(error);
  });

  // Cancels the in-flight worker load. Removed once the model is ready so a
  // later abort of the (long-lived) load signal cannot kill a live worker.
  const loadAbortHandler = (): void => {
    worker.terminate();
    rejectAll(new DOMException('Aborted', 'AbortError'));
  };
  options.signal.addEventListener('abort', loadAbortHandler, { once: true });

  const kind = await ready;
  options.signal.removeEventListener('abort', loadAbortHandler);

  return {
    kind,
    async generate(prompt: string, generateOptions?: TextEngineGenerateOptions): Promise<string> {
      const requestId = `local-text-${nextRequestId++}`;
      const signal = generateOptions?.signal;
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      return await new Promise<string>((resolve, reject) => {
        const onAbort = (): void => {
          if (pending.delete(requestId)) {
            reject(new DOMException('Aborted', 'AbortError'));
          }
        };
        const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
        pending.set(requestId, { resolve, reject, cleanup });
        signal?.addEventListener('abort', onAbort, { once: true });

        worker.postMessage({
          action: 'run',
          requestId,
          prompt,
          maxTokens: generateOptions?.maxTokens ?? options.maxTokens ?? 512,
          temperature: generateOptions?.temperature ?? options.temperature ?? 0.3,
        });
      });
    },
    async dispose(): Promise<void> {
      options.signal.removeEventListener('abort', loadAbortHandler);
      worker.terminate();
      rejectAll(new Error('Local text backend disposed'));
    },
  };
};
