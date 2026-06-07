// packages/backend/audio/src/index.ts

export type { ChunkEvent, ChunkerOptions } from './lib/sentence_boundary_chunker.ts';
export { SentenceBoundaryChunker } from './lib/sentence_boundary_chunker.ts';
export type {
  OnnxGenerateOptions,
  OnnxInferenceResult,
  OnnxRuntimeOptions,
} from './lib/synthetic_onnx_runtime.ts';
export { SyntheticOnnxRuntime } from './lib/synthetic_onnx_runtime.ts';
export type { TtsWebSocketOptions } from './lib/tts_websocket_handler.ts';
export { createTtsWebSocketHandler } from './lib/tts_websocket_handler.ts';
export type {
  PoolInfo,
  ProcessBatchOptions,
  TtsJob,
  TtsJobResult,
  TtsWorkerPoolOptions,
} from './lib/tts_worker_pool.ts';
export { TtsWorkerPool } from './lib/tts_worker_pool.ts';
