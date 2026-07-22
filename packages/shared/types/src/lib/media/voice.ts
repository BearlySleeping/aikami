// packages/shared/types/src/lib/media/voice.ts
//
// Voice/TTS type shared across client and backend.

/** Voice descriptor returned by GET /v1/voices. */
export type VoiceInfo = {
  readonly id: string;
  readonly description: string;
};
