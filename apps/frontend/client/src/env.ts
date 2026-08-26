// apps/frontend/client/src/env.ts
//
// Explicit environment variable declarations (SvelteKit 3).
// Required vars throw at startup if missing; optional vars have defaults.
// All client env vars are public (static SPA — no server-side secrets).
//
// TypeBox is used for type inference; function validators provide runtime
// validation since TypeBox v1.x does not implement the Standard Schema spec.

/** biome-ignore-all lint/style/useNamingConvention: env variable names are conventionally UPPER_CASE */

import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

// ── Validator helpers

// ── Validator helpers ────────────────────────────────────────────────────

/** Require a non-empty string, fail at runtime if missing (unless building). */
const requiredString =
  (name: string) =>
  (value: string | undefined): string => {
    if (building && !value) {
      return '';
    }
    if (!value || value.trim() === '') {
      throw new Error(`${name} is required but was not set`);
    }
    return value.trim();
  };

/** Optional string with a default fallback. */
const optionalString =
  (defaultValue?: string) =>
  (value: string | undefined): string | undefined =>
    value ?? defaultValue;

// ── Exported variables ───────────────────────────────────────────────────

export const variables = defineEnvVars({
  /** Unique app identifier, e.g. "client" or "client-tauri". */
  PUBLIC_APP_ID: {
    public: true,
    static: true,
    schema: requiredString('PUBLIC_APP_ID'),
  },

  /** Runtime mode: "emulator" | "staging" | "production" | "testing". */
  PUBLIC_MODE: {
    public: true,
    static: true,
    schema: requiredString('PUBLIC_MODE'),
  },

  /** Minimum log level to emit (DEBUG | INFO | WARN | ERROR). Defaults to INFO. */
  PUBLIC_LOG_LEVEL: {
    public: true,
    schema: optionalString('INFO'),
  },

  /** Public base URL for the R2 assets bucket. Required in production. */
  PUBLIC_ASSETS_BASE_URL: {
    public: true,
    schema: (value: string | undefined): string | undefined => {
      if (building && !value) {
        return undefined;
      }
      return value || undefined;
    },
  },

  /** URL of the voice/TTS microservice (Kokoro container). */
  PUBLIC_VOICE_URL: {
    public: true,
    schema: optionalString(),
  },

  /** URL of the image generation microservice (ComfyUI / sd-server). */
  PUBLIC_IMAGE_URL: {
    public: true,
    schema: optionalString(),
  },

  /** Base URL for Ollama (local LLM). */
  PUBLIC_OLLAMA_BASE_URL: {
    public: true,
    schema: optionalString(),
  },

  /** Image engine selection: "auto" | "sdcpp" | "comfyui". */
  PUBLIC_IMAGE_ENGINE: {
    public: true,
    schema: optionalString('auto'),
  },

  /** Custom ONNX Runtime WebAssembly URL override. */
  PUBLIC_ORT_WASM_URL: {
    public: true,
    schema: optionalString(),
  },

  /** Default OpenRouter model for persona creation. */
  PUBLIC_OPENROUTER_MODEL: {
    public: true,
    schema: optionalString(),
  },

  /** Bypass the AI gate (dev-only). */
  PUBLIC_AI_GATE_BYPASS: {
    public: true,
    schema: optionalString(),
  },

  /** Emulator port offset for contract-scoped pipeline runs. */
  PUBLIC_EMULATOR_PORT_OFFSET: {
    public: true,
    schema: optionalString('0'),
  },

  /** Build version string (injected at build time). */
  APP_VERSION: {
    public: true,
    schema: optionalString(),
  },
});
