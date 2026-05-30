// packages/frontend/api-core/src/ai/types.ts

// ---------------------------------------------------------------------------
// Provider Capabilities
// ---------------------------------------------------------------------------

/**
 * Describes what an AI provider can do.
 *
 * The game engine uses these flags to decide which provider to invoke for
 * a given task. A provider that cannot generate speech (e.g. Ollama) will
 * have `speech: false`, and the game engine will skip TTS for that session.
 */
export type AiProviderCapabilities = {
  /** Can generate natural-language dialogue. */
  dialogue: boolean;
  /** Can generate content descriptions (text-to-text). */
  contentDescription: boolean;
  /** Can synthesize speech (text-to-speech). */
  speech: boolean;
  /** Can generate images (text-to-image). */
  image: boolean;
  /** Can generate structured game data (JSON with Zod validation). */
  structured: boolean;
  /** Provider requires backend API keys (cloud). */
  requiresBackend: boolean;
  /** Provider runs entirely local (no network to cloud). */
  isLocal: boolean;
};

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

/**
 * Context for NPC dialogue generation.
 */
export type DialogueContext = {
  /** Unique identifier of the NPC. */
  npcId: string;
  /** Display name of the NPC. */
  npcName: string;
  /** Current scene or location. */
  scene?: string;
  /** The player's last spoken line or action description. */
  playerInput: string;
  /** Conversation history (recent messages for continuity). */
  history?: Array<{ role: 'npc' | 'player'; text: string }>;
  /** Optional system prompt override (e.g. NPC personality traits). */
  systemPrompt?: string;
};

/**
 * Options for dialogue generation.
 */
export type DialogueOptions = {
  /** Model override (e.g. 'gpt-4o', 'llama3'). */
  model?: string;
  /** Creativity (0 — 2.0). Default: provider-specific. */
  temperature?: number;
  /** Maximum response tokens. Default: provider-specific. */
  maxTokens?: number;
};

/**
 * Result of a dialogue generation call.
 */
export type DialogueResponse = {
  /** The generated dialogue text. */
  text: string;
  /** Optional token usage metadata. */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
};

// ---------------------------------------------------------------------------
// Content Description
// ---------------------------------------------------------------------------

/**
 * Options for content description generation.
 */
export type ContentDescriptionOptions = {
  /** Model override. */
  model?: string;
  /** Creativity (0 — 2.0). */
  temperature?: number;
  /** Maximum response tokens. */
  maxTokens?: number;
};

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------

/**
 * Options for speech synthesis.
 */
export type TtsOptions = {
  /** Voice name (fuzzy-matched). */
  voice?: string;
  /** Speech rate (0.1 — 10.0). Default: 1.0. */
  rate?: number;
  /** Speech pitch (0 — 2.0). Default: 1.0. */
  pitch?: number;
  /** Volume (0 — 1.0). Default: 1.0. */
  volume?: number;
};

/**
 * Result of a speech synthesis call.
 */
export type SpeechResult = {
  /** Base64-encoded audio data, or null for live playback only. */
  audioData: string | null;
  /** Estimated duration in milliseconds. */
  durationMs: number;
  /** List of available voice names (for discovery). */
  voicesAvailable: string[];
};

// ---------------------------------------------------------------------------
// Image Generation
// ---------------------------------------------------------------------------

/**
 * Options for image generation.
 */
export type ImageOptions = {
  /** Model override. */
  model?: string;
  /** Output width in pixels. */
  width?: number;
  /** Output height in pixels. */
  height?: number;
  /** Number of denoising steps. */
  steps?: number;
  /** Prompt guidance scale. */
  cfgScale?: number;
};

/**
 * Result of an image generation call.
 */
export type ImageResult = {
  /** URL or base64 data URI of the generated image. */
  imageUrl: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** MIME type (e.g. 'image/png', 'image/webp'). */
  mimeType: string;
};

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * Result of a provider health check.
 */
export type HealthCheckResult = {
  /** Whether the provider is reachable. */
  available: boolean;
  /** Latency in milliseconds (0 for mock/unreachable). */
  latencyMs: number;
  /** Human-readable status message. */
  message?: string;
};

// ---------------------------------------------------------------------------
// Provider Configuration Types
// ---------------------------------------------------------------------------

/**
 * Provider identifier for runtime selection.
 */
export type AiProvider = 'openai' | 'gemini' | 'ollama' | 'comfyui' | 'local-tts' | 'mock';

/**
 * Options for the OpenAiClient constructor.
 */
export type OpenAiClientOptions = {
  /** Model name. Default: 'gpt-4o'. */
  model?: string;
  /** Default dialogue generation options. */
  defaultDialogueOptions?: DialogueOptions;
};

/**
 * Options for the GeminiClient constructor.
 */
export type GeminiClientOptions = {
  /** Model name. Default: 'gemini-2.0-flash'. */
  model?: string;
  /** Default dialogue generation options. */
  defaultDialogueOptions?: DialogueOptions;
};

/**
 * Options for the OllamaClient constructor.
 */
export type OllamaClientOptions = {
  /** Ollama server base URL. Default: 'http://localhost:11434'. */
  baseUrl?: string;
  /** Model name. Default: 'llama3'. */
  model?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Default chat options (temperature, etc.). */
  defaultOptions?: Partial<{
    temperature: number;
    topP: number;
    maxTokens: number;
  }>;
};

/**
 * Options for the ComfyUiClient constructor.
 */
export type ComfyUiClientOptions = {
  /** ComfyUI server base URL. Default: 'http://localhost:8188'. */
  baseUrl?: string;
  /** Pre-configured workflow JSON path or ID. Required. */
  workflowId: string;
  /** Image generation timeout in milliseconds. Default: 60000. */
  timeoutMs?: number;
  /** Output format. Default: 'png'. */
  outputFormat?: 'png' | 'webp' | 'jpeg';
};

/**
 * Options for the LocalTtsClient constructor.
 */
export type LocalTtsClientOptions = {
  /** Preferred voice name (fuzzy-matched). Default: system default. */
  preferredVoice?: string;
  /** Speech rate (0.1 — 10.0). Default: 1.0. */
  rate?: number;
  /** Speech pitch (0 — 2.0). Default: 1.0. */
  pitch?: number;
  /** Volume (0 — 1.0). Default: 1.0. */
  volume?: number;
  /** If true, captures audio via Web Audio API instead of live playback. Default: false. */
  captureAudio?: boolean;
};

/**
 * Combined options for the `createAiClient` factory function.
 */
export type AiClientOptions = {
  /** GameApiClient instance (required for cloud providers). */
  apiClient?: import('../api/game_api_client_interface.ts').GameApiClientInterface;
  openai?: OpenAiClientOptions;
  gemini?: GeminiClientOptions;
  ollama?: OllamaClientOptions;
  comfyui?: ComfyUiClientOptions;
  localTts?: LocalTtsClientOptions;
};
