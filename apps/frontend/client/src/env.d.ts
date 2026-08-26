// apps/frontend/client/src/env.d.ts
import type { LogLevel, Mode } from '@nordclaw/types';

declare module '*?worker&type=module' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

declare module '$app/env/public' {
  /** Unique app identifier, e.g. "client" or "client-tauri". */
  export const PUBLIC_APP_ID: string;
  /** Runtime mode: "emulator" | "staging" | "production" | "testing". */
  export const PUBLIC_MODE: Mode;
  /** Minimum log level to emit (DEBUG | INFO | WARN | ERROR). */
  export const PUBLIC_LOG_LEVEL: LogLevel;
  /** Public base URL for the R2 assets bucket. */
  export const PUBLIC_ASSETS_BASE_URL: string | undefined;
  /** URL of the voice/TTS microservice (Kokoro container). */
  export const PUBLIC_VOICE_URL: string | undefined;
  /** URL of the image generation microservice. */
  export const PUBLIC_IMAGE_URL: string | undefined;
  /** Base URL for Ollama (local LLM). */
  export const PUBLIC_OLLAMA_BASE_URL: string | undefined;
  /** Image engine selection: "auto" | "sdcpp" | "comfyui". */
  export const PUBLIC_IMAGE_ENGINE: string | undefined;
  /** Custom ONNX Runtime WebAssembly URL override. */
  export const PUBLIC_ORT_WASM_URL: string | undefined;
  /** Default OpenRouter model for persona creation. */
  export const PUBLIC_OPENROUTER_MODEL: string | undefined;
  /** Bypass the AI gate (dev-only). */
  export const PUBLIC_AI_GATE_BYPASS: string | undefined;
  /** Emulator port offset for contract-scoped pipeline runs. */
  export const PUBLIC_EMULATOR_PORT_OFFSET: string | undefined;
  /** Build version string (injected at build time). */
  export const APP_VERSION: string | undefined;
}
