// packages/shared/types/src/lib/local_ai/stt.ts
//
// C-393 STT wire-protocol types, derived from the TypeBox schemas in
// @aikami/schemas — the schemas are the single source of truth; these
// re-exports keep the protocol types on the @aikami/types surface that
// C-359's client imports.

import type {
  SttAudioFormatSchema,
  SttBatchCapabilitiesSchema,
  SttBatchEngineSchema,
  SttCapabilitiesSchema,
  SttClientMessageSchema,
  SttClientStartMessageSchema,
  SttClientStopMessageSchema,
  SttErrorCodeSchema,
  SttServerErrorMessageSchema,
  SttServerFinalMessageSchema,
  SttServerMessageSchema,
  SttServerPartialMessageSchema,
  SttServerReadyMessageSchema,
  SttServerSpeechEndMessageSchema,
  SttServerSpeechStartMessageSchema,
  SttStreamEngineSchema,
  SttStreamingCapabilitiesSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type SttStreamEngine = Static<typeof SttStreamEngineSchema>;
export type SttBatchEngine = Static<typeof SttBatchEngineSchema>;
export type SttAudioFormat = Static<typeof SttAudioFormatSchema>;
export type SttStreamingCapabilities = Static<typeof SttStreamingCapabilitiesSchema>;
export type SttBatchCapabilities = Static<typeof SttBatchCapabilitiesSchema>;
export type SttCapabilities = Static<typeof SttCapabilitiesSchema>;
export type SttErrorCode = Static<typeof SttErrorCodeSchema>;
export type SttClientStartMessage = Static<typeof SttClientStartMessageSchema>;
export type SttClientStopMessage = Static<typeof SttClientStopMessageSchema>;
export type SttClientMessage = Static<typeof SttClientMessageSchema>;
export type SttServerReadyMessage = Static<typeof SttServerReadyMessageSchema>;
export type SttServerSpeechStartMessage = Static<typeof SttServerSpeechStartMessageSchema>;
export type SttServerPartialMessage = Static<typeof SttServerPartialMessageSchema>;
export type SttServerFinalMessage = Static<typeof SttServerFinalMessageSchema>;
export type SttServerSpeechEndMessage = Static<typeof SttServerSpeechEndMessageSchema>;
export type SttServerErrorMessage = Static<typeof SttServerErrorMessageSchema>;
export type SttServerMessage = Static<typeof SttServerMessageSchema>;
