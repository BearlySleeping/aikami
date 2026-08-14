// packages/shared/schemas/src/lib/local_ai/stt.ts
//
// C-393 STT wire protocol — the single source of truth shared by the
// streaming service (apps/backend/local-stack/docker/voice/stt_server.py's
// documented protocol) and C-359's client. The service serialises JSON
// against these shapes; the client validates and derives types from them,
// so the wire contract cannot drift between the two.
//
// Wire contract summary:
//   - Audio is always 16 kHz mono 16-bit PCM (`pcm_s16le`). Resampling is
//     the client's job; the server rejects anything that does not match
//     (AC-6).
//   - `WS {stt}/v1/stream` — client sends `start` (JSON text frame,
//     declaring the audio format it will stream), then binary frames of
//     raw PCM, then `stop`; the server replies with `ready`,
//     `speech-start`, `partial`*, `final`, `speech-end`, and `error`
//     events (AC-1/AC-2).
//   - `POST {stt}/v1/audio/transcriptions` — OpenAI-compatible batch
//     endpoint served by whisper.cpp (AC-3).
//   - `GET {stt}/v1/capabilities` — introspection (AC-4).
//   - `GET {stt}/v1/health` — readiness, model-presence aware (AC-10).
import Type from 'typebox';

/**
 * Which engine serves the streaming protocol. Env-selected
 * (`STT_STREAM_ENGINE`) and extensible: a future licensed CrisperWhisper
 * provider becomes a new literal plus a container, not a protocol change.
 */
export const SttStreamEngineSchema = Type.Union([Type.Literal('moonshine')]);
export type SttStreamEngine = Type.Static<typeof SttStreamEngineSchema>;

/** Which engine serves the batch protocol (`STT_BATCH_ENGINE`). */
export const SttBatchEngineSchema = Type.Union([Type.Literal('whisper-cpp')]);
export type SttBatchEngine = Type.Static<typeof SttBatchEngineSchema>;

/** The only audio format the service accepts: 16 kHz mono 16-bit PCM. */
export const SttAudioFormatSchema = Type.Object({
  sampleRate: Type.Literal(16000),
  channels: Type.Literal(1),
  encoding: Type.Literal('pcm_s16le'),
});
export type SttAudioFormat = Type.Static<typeof SttAudioFormatSchema>;

/** Streaming capabilities (AC-4). Moonshine is English-only (AC-5). */
export const SttStreamingCapabilitiesSchema = Type.Object({
  available: Type.Boolean(),
  engine: SttStreamEngineSchema,
  model: Type.String(),
  languages: Type.Array(Type.String()),
  vad: Type.Boolean(),
  wordTimestamps: Type.Boolean(),
});
export type SttStreamingCapabilities = Type.Static<typeof SttStreamingCapabilitiesSchema>;

/** Batch capabilities (AC-4). whisper.cpp covers ~99 languages. */
export const SttBatchCapabilitiesSchema = Type.Object({
  available: Type.Boolean(),
  engine: SttBatchEngineSchema,
  model: Type.String(),
  languages: Type.Array(Type.String()),
});
export type SttBatchCapabilities = Type.Static<typeof SttBatchCapabilitiesSchema>;

/** `GET /v1/capabilities` response (AC-4). */
export const SttCapabilitiesSchema = Type.Object({
  streaming: SttStreamingCapabilitiesSchema,
  batch: SttBatchCapabilitiesSchema,
  audio: SttAudioFormatSchema,
  protocolVersion: Type.Literal(1),
});
export type SttCapabilities = Type.Static<typeof SttCapabilitiesSchema>;

/** Server error codes — see SttServerErrorMessageSchema. */
export const SttErrorCodeSchema = Type.Union([
  Type.Literal('model-not-loaded'),
  Type.Literal('unsupported-language'),
  Type.Literal('bad-audio-format'),
  Type.Literal('protocol-version-mismatch'),
  Type.Literal('overloaded'),
  Type.Literal('internal'),
]);
export type SttErrorCode = Type.Static<typeof SttErrorCodeSchema>;

/** Client → server: begin a streaming session.
 *
 * `audio` is required — the client declares the format it will stream so
 * the server can reject a mismatch before accepting any audio (AC-6). The
 * only accepted value is the fixed 16 kHz mono 16-bit PCM format.
 */
export const SttClientStartMessageSchema = Type.Object({
  type: Type.Literal('start'),
  audio: SttAudioFormatSchema,
  language: Type.Optional(Type.String()),
  protocolVersion: Type.Literal(1),
});
export type SttClientStartMessage = Type.Static<typeof SttClientStartMessageSchema>;

/** Client → server: end the session and request the final transcript. */
export const SttClientStopMessageSchema = Type.Object({
  type: Type.Literal('stop'),
});
export type SttClientStopMessage = Type.Static<typeof SttClientStopMessageSchema>;

/** Client → server messages (JSON text frames; audio is binary frames). */
export const SttClientMessageSchema = Type.Union([
  SttClientStartMessageSchema,
  SttClientStopMessageSchema,
]);
export type SttClientMessage = Type.Static<typeof SttClientMessageSchema>;

/** Server → client: session accepted; capabilities mirror `GET /v1/capabilities`. */
export const SttServerReadyMessageSchema = Type.Object({
  type: Type.Literal('ready'),
  capabilities: SttCapabilitiesSchema,
});
export type SttServerReadyMessage = Type.Static<typeof SttServerReadyMessageSchema>;

/** Server → client: VAD detected speech onset (AC-2). */
export const SttServerSpeechStartMessageSchema = Type.Object({
  type: Type.Literal('speech-start'),
  atMs: Type.Number(),
});
export type SttServerSpeechStartMessage = Type.Static<typeof SttServerSpeechStartMessageSchema>;

/** Server → client: incremental hypothesis while the user is speaking (AC-1). */
export const SttServerPartialMessageSchema = Type.Object({
  type: Type.Literal('partial'),
  text: Type.String(),
  atMs: Type.Number(),
});
export type SttServerPartialMessage = Type.Static<typeof SttServerPartialMessageSchema>;

/** Server → client: final transcript for the completed utterance (AC-1). */
export const SttServerFinalMessageSchema = Type.Object({
  type: Type.Literal('final'),
  text: Type.String(),
  startMs: Type.Number(),
  endMs: Type.Number(),
});
export type SttServerFinalMessage = Type.Static<typeof SttServerFinalMessageSchema>;

/** Server → client: VAD detected speech end (AC-2). */
export const SttServerSpeechEndMessageSchema = Type.Object({
  type: Type.Literal('speech-end'),
  atMs: Type.Number(),
});
export type SttServerSpeechEndMessage = Type.Static<typeof SttServerSpeechEndMessageSchema>;

/** Server → client: a session failed; the socket closes after this frame. */
export const SttServerErrorMessageSchema = Type.Object({
  type: Type.Literal('error'),
  code: SttErrorCodeSchema,
  message: Type.String(),
});
export type SttServerErrorMessage = Type.Static<typeof SttServerErrorMessageSchema>;

/** Server → client messages. */
export const SttServerMessageSchema = Type.Union([
  SttServerReadyMessageSchema,
  SttServerSpeechStartMessageSchema,
  SttServerPartialMessageSchema,
  SttServerFinalMessageSchema,
  SttServerSpeechEndMessageSchema,
  SttServerErrorMessageSchema,
]);
export type SttServerMessage = Type.Static<typeof SttServerMessageSchema>;
