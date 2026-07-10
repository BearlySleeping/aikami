// packages/shared/schemas/src/lib/database/voice.ts
import Type from 'typebox';

export const VoiceProviderSchema = Type.Union([
  Type.Literal('elevenlabs'),
  Type.Literal('silero'),
  Type.Literal('coqui'),
  Type.Literal('edge'),
]);
export type VoiceProvider = Type.Static<typeof VoiceProviderSchema>;

export const VoiceSettingsSchema = Type.Object({
  speed: Type.Number({ minimum: 0.5, maximum: 2.0, default: 1.0, description: 'Speech speed' }),
  pitch: Type.Number({ minimum: 0.5, maximum: 2.0, default: 1.0, description: 'Voice pitch' }),
  volume: Type.Number({ minimum: 0, maximum: 1, default: 1.0, description: 'Volume' }),
  stability: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 1,
      default: 0.5,
      description: 'Voice stability (ElevenLabs)',
    }),
  ),
  similarity: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 1,
      default: 0.75,
      description: 'Voice similarity (ElevenLabs)',
    }),
  ),
  style: Type.Optional(
    Type.Number({ minimum: 0, maximum: 1, default: 0, description: 'Speaking style (ElevenLabs)' }),
  ),
});

export type VoiceSettings = Type.Static<typeof VoiceSettingsSchema>;

export const VoiceConfigSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  name: Type.String({ description: 'Configuration name' }),
  provider: VoiceProviderSchema,
  voiceId: Type.String({ description: 'Provider-specific voice ID' }),
  settings: VoiceSettingsSchema,
  characterId: Type.Optional(Type.String({ description: 'Associated character ID' })),
  personaId: Type.Optional(Type.String({ description: 'Associated persona ID' })),
  isDefault: Type.Boolean({ default: false }),
  isEnabled: Type.Boolean({ description: 'Is voice enabled', default: false }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
});

export const GeneratedSpeechSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  chatId: Type.String({ description: 'Related chat ID' }),
  messageId: Type.String({ description: 'Source message ID' }),
  audioUrl: Type.String({ description: 'Audio file URL' }),
  provider: VoiceProviderSchema,
  duration: Type.Number({ description: 'Duration in seconds' }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
});

export const VoiceGenerationRequestSchema = Type.Object({
  text: Type.String({ description: 'Text to convert to speech' }),
  voiceId: Type.Optional(Type.String({ description: 'Specific voice ID to use' })),
  voiceConfigId: Type.Optional(Type.String({ description: 'Saved voice configuration ID' })),
  provider: Type.Optional(VoiceProviderSchema),
  settings: Type.Optional(VoiceSettingsSchema),
  characterId: Type.Optional(Type.String({ description: 'Character ID for voice assignment' })),
  messageId: Type.Optional(Type.String({ description: 'Message ID for audio tracking' })),
  language: Type.Optional(Type.String({ description: 'Language code (e.g., en-US)' })),
});

export type VoiceGenerationRequest = Type.Static<typeof VoiceGenerationRequestSchema>;

export const VoiceGenerationResultSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  audioUrl: Type.String({ description: 'URL of the generated audio' }),
  duration: Type.Number({ description: 'Duration in seconds' }),
  provider: VoiceProviderSchema,
  voiceId: Type.String({ description: 'Voice ID used' }),
  text: Type.String({ description: 'Input text' }),
  settings: VoiceSettingsSchema,
  createdAt: Type.String({ format: 'date-time' }),
});

export type VoiceGenerationResult = Type.Static<typeof VoiceGenerationResultSchema>;

export type VoiceConfigData = Type.Static<typeof VoiceConfigSchema>;
export type VoiceConfig = Type.Static<typeof VoiceConfigSchema>;
export type GeneratedSpeechData = Type.Static<typeof GeneratedSpeechSchema>;
export type GeneratedSpeech = Type.Static<typeof GeneratedSpeechSchema>;

export type VoiceProviderInterface = {
  readonly name: string;
  readonly provider: VoiceProvider;
  readonly supportsVoices: boolean;
  readonly supportsLanguages: boolean;
  readonly supportsSpeed: boolean;
  readonly supportsPitch: boolean;
  readonly maxTextLength: number;

  generate(request: VoiceGenerationRequest): Promise<VoiceGenerationResult>;
  listVoices(language?: string): Promise<VoiceInfo[]>;
  getCapabilities(): VoiceProviderCapabilities;
};

export type VoiceInfo = {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  previewUrl?: string;
};

export type VoiceProviderCapabilities = {
  provider: VoiceProvider;
  name: string;
  supportedLanguages: string[];
  supportsVoices: boolean;
  supportsSpeed: boolean;
  supportsPitch: boolean;
  supportsVolume: boolean;
  maxTextLength: number;
  avgLatency: number;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
};

export const POPULAR_VOICES: Record<
  string,
  { id: string; name: string; gender: 'male' | 'female' }
> = {
  'elevenlabs-rachel': { id: 'rachel', name: 'Rachel', gender: 'female' },
  'elevenlabs-josh': { id: 'josh', name: 'Josh', gender: 'male' },
  'elevenlabs-arnold': { id: 'arnold', name: 'Arnold', gender: 'male' },
  'elevenlabs-adam': { id: 'adam', name: 'Adam', gender: 'male' },
  'elevenlabs-sam': { id: 'sam', name: 'Sam', gender: 'male' },
  'elevenlabs-jenny': { id: 'jenny', name: 'Jenny', gender: 'female' },
  'elevenlabs-domi': { id: 'domi', name: 'Domi', gender: 'female' },
  'elevenlabs-bella': { id: 'bella', name: 'Bella', gender: 'female' },
  'elevenlabs-antoine': { id: 'antoine', name: 'Antoine', gender: 'male' },
  'elevenlabs-thomas': { id: 'thomas', name: 'Thomas', gender: 'male' },
};
