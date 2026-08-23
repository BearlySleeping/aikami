// packages/frontend/local-runtime/src/lib/text_llm_worker.ts
//
// Dedicated Web Worker wrapping transformers.js pipeline('text-generation', …)
// for the local Qwen3 1B LLM. Follows the same initialize / run postMessage
// protocol as kokoro_worker.ts.
//
// Contract: C-427 AC-3

import { env, pipeline } from '@huggingface/transformers';

// Local models enabled — weights come from the app-controlled cache
env.allowLocalModels = true;
env.localModelPath = '/models/';

// ---------------------------------------------------------------------------
// Worker-scoped state
// ---------------------------------------------------------------------------

type TextGenerationPipeline = Awaited<ReturnType<typeof pipeline<'text-generation'>>>;
let generator: TextGenerationPipeline | null = null;
let activeBackend: 'webgpu' | 'wasm' = 'wasm';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type InitializeMessage = {
  action: 'initialize';
  /** HF model id — pinned by the main thread. */
  modelId: string;
  /** Pinned revision, never `main`. */
  revision: string;
  /** Preferred device; WebGPU falls back to WASM when unavailable. */
  device: 'webgpu' | 'wasm';
};

type RunMessage = {
  action: 'run';
  /** Input prompt for text generation. */
  prompt: string;
  /** Maximum number of tokens to generate. */
  maxTokens?: number;
  /** Temperature for sampling. */
  temperature?: number;
};

type WorkerMessage = InitializeMessage | RunMessage;

type InitializeResponse = {
  type: 'ready';
  /** Which backend actually loaded. */
  backend: 'webgpu' | 'wasm';
};

type RunResponse = {
  type: 'complete';
  /** Generated text output. */
  output: string;
};

type ErrorResponse = {
  type: 'error';
  message: string;
};

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

/** True when a WebGPU adapter can actually be requested. */
const hasWebGpu = async (): Promise<boolean> => {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } })
      .gpu;
    if (!gpu?.requestAdapter) {
      return false;
    }
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ]);
    return adapter !== undefined && adapter !== null;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handleInitialize = async (message: InitializeMessage): Promise<void> => {
  try {
    const { modelId, revision, device } = message;

    // Decide the effective backend
    const useWebGpu = device === 'webgpu' && (await hasWebGpu());

    generator = await pipeline('text-generation', modelId, {
      revision,
      device: useWebGpu ? 'webgpu' : 'wasm',
    });

    activeBackend = useWebGpu ? 'webgpu' : 'wasm';

    const response: InitializeResponse = { type: 'ready', backend: activeBackend };
    self.postMessage(response);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
    const response: ErrorResponse = { type: 'error', message: errorMessage };
    self.postMessage(response);
  }
};

const handleRun = async (message: RunMessage): Promise<void> => {
  const { prompt, maxTokens = 128, temperature = 0.7 } = message;

  if (!generator) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Text generation pipeline not initialized. Call initialize first.',
    };
    self.postMessage(response);
    return;
  }

  if (!prompt.trim()) {
    const response: ErrorResponse = {
      type: 'error',
      message: 'Empty prompt — nothing to generate.',
    };
    self.postMessage(response);
    return;
  }

  try {
    const result = await generator(prompt, {
      // biome-ignore lint/style/useNamingConvention: transformers.js API uses snake_case
      max_new_tokens: maxTokens,
      temperature,
      // biome-ignore lint/style/useNamingConvention: transformers.js API uses snake_case
      do_sample: temperature > 0,
      // Suppress Qwen3 reasoning tokens by appending /no_think
      // This tells the model to skip its internal reasoning chain
      // and go straight to the answer.
      stop: ['<|im_end|>', '<|endoftext|>'],
    });

    // Extract the generated text
    const fullText = Array.isArray(result)
      ? ((result[0] as Record<string, unknown>).generated_text as string)
      : '';
    // Remove the input prompt to get only the new output
    const output = fullText.startsWith(prompt)
      ? fullText.slice(prompt.length).trim()
      : fullText.trim();

    const response: RunResponse = { type: 'complete', output };
    self.postMessage(response);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Text generation failed';
    const response: ErrorResponse = { type: 'error', message: errMsg };
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
      handleInitialize(data);
      break;

    case 'run':
      handleRun(data);
      break;

    default:
      break;
  }
};
