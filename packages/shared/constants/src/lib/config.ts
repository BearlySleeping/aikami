// packages/shared/constants/src/lib/config.ts
//
// Config dashboard constants — memory types, embedding models, voice engines,
// voice catalogs, and emotion methods. These are pure data shared between
// the config service and config UI views.

// ---------------------------------------------------------------------------
// Memory subsystem
// ---------------------------------------------------------------------------

/** Memory subsystem type. */
export const MEMORY_TYPES = ['none', 'basic', 'hypa-style', 'hanurai'] as const;

// ---------------------------------------------------------------------------
// Embedding model providers
// ---------------------------------------------------------------------------

/** Embedding model providers. */
export const EMBEDDING_MODELS = [
  { id: 'minilm', label: 'MiniLM (local)' },
  { id: 'nomic', label: 'Nomic Embed' },
  { id: 'bge', label: 'BGE (BAAI)' },
  { id: 'openai', label: 'OpenAI Embeddings' },
  { id: 'voyage', label: 'Voyage AI' },
  { id: 'custom', label: 'Custom API' },
] as const;

// ---------------------------------------------------------------------------
// Voice engine selection
// ---------------------------------------------------------------------------

/** Available TTS engines. */
export const VOICE_ENGINES = [
  { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
  { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
] as const;

/** A voice option displayed in the dropdown. */
export type VoiceOption = {
  /** Voice identifier (e.g. 'af_heart'). */
  id: string;
  /** Human-readable label. */
  label: string;
};

/** All known Kokoro voices (mirrors the /v1/voices endpoint). */
export const KOKORO_VOICES: readonly VoiceOption[] = [
  // American English — Female
  { id: 'af_heart', label: 'af_heart — Warm, natural (default)' },
  { id: 'af_bella', label: 'af_bella — Expressive' },
  { id: 'af_nova', label: 'af_nova — Clear' },
  { id: 'af_sky', label: 'af_sky — Neutral, versatile' },
  { id: 'af_sarah', label: 'af_sarah — Conversational' },
  { id: 'af_nicole', label: 'af_nicole — Friendly' },
  { id: 'af_alloy', label: 'af_alloy — Balanced' },
  { id: 'af_jessica', label: 'af_jessica — Energetic' },
  { id: 'af_river', label: 'af_river — Calm' },
  // American English — Male
  { id: 'am_adam', label: 'am_adam — Deep' },
  { id: 'am_michael', label: 'am_michael — Clear' },
  { id: 'am_echo', label: 'am_echo — Neutral' },
  { id: 'am_eric', label: 'am_eric — Authoritative' },
  { id: 'am_fenrir', label: 'am_fenrir — Distinctive' },
  { id: 'am_liam', label: 'am_liam — Conversational' },
  { id: 'am_onyx', label: 'am_onyx — Rich' },
  { id: 'am_puck', label: 'am_puck — Expressive' },
  { id: 'am_santa', label: 'am_santa — Warm' },
  // British English — Female
  { id: 'bf_emma', label: 'bf_emma — Clear, professional' },
  { id: 'bf_isabella', label: 'bf_isabella — Warm' },
  { id: 'bf_alice', label: 'bf_alice — Crisp' },
  { id: 'bf_lily', label: 'bf_lily — Soft' },
  // British English — Male
  { id: 'bm_george', label: 'bm_george — Authoritative' },
  { id: 'bm_lewis', label: 'bm_lewis — Smooth' },
  { id: 'bm_daniel', label: 'bm_daniel — Calm' },
  { id: 'bm_fable', label: 'bm_fable — Expressive' },
] as const;

// ---------------------------------------------------------------------------
// Voice archetypes — human-friendly labels mapped to engine voice IDs
// ---------------------------------------------------------------------------

/** A named voice archetype mapped to a provider-specific voice ID. */
export type VoiceArchetype = {
  /** Unique archetype key (e.g. 'female-warm', 'male-deep'). */
  id: string;
  /** Human-readable label (e.g. 'Female — Warm'). */
  label: string;
  /** Provider-specific voice ID (e.g. 'af_heart' for Kokoro). */
  voiceId: string;
};

/** Curated default voice archetypes mapped to Kokoro IDs. */
export const DEFAULT_VOICE_ARCHETYPES: readonly VoiceArchetype[] = [
  // ── Female ─────────────────────────────────────────────────────────
  { id: 'female-warm', label: 'Female — Warm', voiceId: 'af_heart' },
  { id: 'female-clear', label: 'Female — Clear', voiceId: 'af_nova' },
  { id: 'female-expressive', label: 'Female — Expressive', voiceId: 'af_bella' },
  { id: 'female-calm', label: 'Female — Calm', voiceId: 'af_river' },
  { id: 'female-friendly', label: 'Female — Friendly', voiceId: 'af_nicole' },
  { id: 'female-professional', label: 'Female — Professional (UK)', voiceId: 'bf_emma' },
  // ── Male ───────────────────────────────────────────────────────────
  { id: 'male-warm', label: 'Male — Warm', voiceId: 'am_santa' },
  { id: 'male-clear', label: 'Male — Clear', voiceId: 'am_michael' },
  { id: 'male-authoritative', label: 'Male — Authoritative', voiceId: 'bm_george' },
  { id: 'male-deep', label: 'Male — Deep', voiceId: 'am_adam' },
  { id: 'male-expressive', label: 'Male — Expressive', voiceId: 'am_puck' },
  { id: 'male-conversational', label: 'Male — Conversational', voiceId: 'am_liam' },
  { id: 'male-calm', label: 'Male — Calm (UK)', voiceId: 'bm_daniel' },
] as const;

// ---------------------------------------------------------------------------
// Emotion config
// ---------------------------------------------------------------------------

/** Emotion resolution methods. */
export const EMOTION_METHODS = ['submodel', 'embedding'] as const;
