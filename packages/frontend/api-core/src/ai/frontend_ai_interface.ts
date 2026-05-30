// packages/frontend/api-core/src/ai/frontend_ai_interface.ts

import type { z } from 'zod';

import type {
  AiProviderCapabilities,
  ContentDescriptionOptions,
  DialogueContext,
  DialogueOptions,
  DialogueResponse,
  HealthCheckResult,
  ImageOptions,
  ImageResult,
  SpeechResult,
  TtsOptions,
} from './types.ts';

/**
 * Vendor-agnostic AI provider interface for the game engine.
 *
 * This is the frontend equivalent of the backend `AiServiceInterface`
 * (`packages/backend/ai/`), tailored for game engine needs:
 * dialogue generation, content description, text-to-speech, image
 * generation, and structured data extraction.
 *
 * Implementations:
 * - {@link OpenAiClient} — cloud (routes through backend proxy)
 * - {@link GeminiClient} — cloud (routes through backend proxy)
 * - {@link OllamaClient} — local (direct HTTP to localhost:11434)
 * - {@link ComfyUiClient} — local (direct HTTP to localhost:8188)
 * - {@link LocalTtsClient} — local (Web Speech API)
 * - {@link MockAiClient} — deterministic mock for TDD
 *
 * Zero vendor SDKs. No OpenAI, Google AI, or Firebase imports.
 */
export interface FrontendAiInterface {
  /** Human-readable provider name (e.g. 'ollama', 'openai', 'local-tts'). */
  readonly name: string;

  /** Provider capability flags — the game engine uses these for runtime discovery. */
  readonly capabilities: AiProviderCapabilities;

  /**
   * Generate NPC dialogue given conversation context.
   *
   * @param context — NPC and player context for the dialogue.
   * @param options — Optional generation parameters.
   * @returns Generated dialogue response.
   */
  generateDialogue(context: DialogueContext, options?: DialogueOptions): Promise<DialogueResponse>;

  /**
   * Generate a text description or structured content for procedural items,
   * quests, or scene descriptions.
   *
   * @param prompt — Instruction for what to describe.
   * @param options — Optional generation parameters.
   * @returns Generated description text.
   */
  generateContentDescription(prompt: string, options?: ContentDescriptionOptions): Promise<string>;

  /**
   * Synthesize speech from text.
   *
   * For local TTS, uses the Web Speech API. For cloud providers, routes
   * through the backend. Returns audio data or a live-playback reference.
   *
   * @param text — Text to convert to speech.
   * @param options — Optional voice/rate/pitch/volume configuration.
   * @returns Speech synthesis result.
   */
  synthesizeSpeech(text: string, options?: TtsOptions): Promise<SpeechResult>;

  /**
   * Generate an image from a text prompt.
   *
   * Typically used for procedural in-game assets, item icons, or scene art.
   * Cloud providers route through the backend; ComfyUI connects directly.
   *
   * @param prompt — Text description of the desired image.
   * @param options — Optional width, height, steps, etc.
   * @returns Image generation result with URL or data URI.
   */
  generateImage(prompt: string, options?: ImageOptions): Promise<ImageResult>;

  /**
   * Generate structured game content validated against a Zod schema.
   *
   * Used for item definitions, quest data, NPC stats, etc.
   * The returned data is guaranteed to match the provided schema.
   *
   * @typeParam T — The expected output type.
   * @param instruction — What to generate (e.g. "Generate a fantasy sword item").
   * @param schema — Zod schema defining the expected output shape.
   * @param context — Optional additional context (e.g. game world setting).
   * @returns A typed object matching the schema.
   */
  generateStructured<T>(
    instruction: string,
    schema: z.ZodSchema<T>,
    context?: string,
  ): Promise<T>;

  /**
   * Check if the provider is currently reachable.
   *
   * Local providers (Ollama, ComfyUI) may be offline. This method lets
   * the game engine degrade gracefully rather than crashing.
   *
   * @returns Health check result with availability and latency.
   */
  healthCheck(): Promise<HealthCheckResult>;
}
