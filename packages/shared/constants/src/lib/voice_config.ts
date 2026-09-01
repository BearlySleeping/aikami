// packages/shared/constants/src/lib/voice_config.ts
//
// Voice/TTS configuration constants — engine options, voice lists, and
// default archetype mappings.

import type { VoiceArchetype, VoiceOption } from '@aikami/types';

// ---------------------------------------------------------------------------
// Voice engines
// ---------------------------------------------------------------------------

/** Available TTS engines. */
export const VOICE_ENGINES = [
  { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
  { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
] as const;

// ---------------------------------------------------------------------------
// Kokoro voices
// ---------------------------------------------------------------------------

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
// Default voice archetypes
// ---------------------------------------------------------------------------

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
