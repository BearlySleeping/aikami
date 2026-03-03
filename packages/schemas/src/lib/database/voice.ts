import { z } from 'zod';

export const VoiceProviderSchema = z.enum(['elevenlabs', 'silero', 'coqui', 'edge']);
export type VoiceProvider = z.infer<typeof VoiceProviderSchema>;

export const VoiceSettingsSchema = z.object({
  speed: z.number().min(0.5).max(2.0).default(1.0).describe('Speech speed'),
  pitch: z.number().min(0.5).max(2.0).default(1.0).describe('Voice pitch'),
  volume: z.number().min(0).max(1).default(1.0).describe('Volume'),
  stability: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .optional()
    .describe('Voice stability (ElevenLabs)'),
  similarity: z
    .number()
    .min(0)
    .max(1)
    .default(0.75)
    .optional()
    .describe('Voice similarity (ElevenLabs)'),
  style: z.number().min(0).max(1).default(0).optional().describe('Speaking style (ElevenLabs)'),
});

export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const VoiceConfigSchema = z.object({
  id: z.string().describe('Unique identifier'),
  name: z.string().describe('Configuration name'),
  provider: VoiceProviderSchema.describe('TTS provider'),
  voiceId: z.string().describe('Provider-specific voice ID'),
  settings: VoiceSettingsSchema,
  characterId: z.string().optional().describe('Associated character ID'),
  personaId: z.string().optional().describe('Associated persona ID'),
  isDefault: z.boolean().default(false),
  isEnabled: z.boolean().describe('Is voice enabled').default(false),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
});

export const GeneratedSpeechSchema = z.object({
  id: z.string().describe('Unique identifier'),
  chatId: z.string().describe('Related chat ID'),
  messageId: z.string().describe('Source message ID'),
  audioUrl: z.string().describe('Audio file URL'),
  provider: VoiceProviderSchema.describe('TTS provider'),
  duration: z.number().describe('Duration in seconds'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
});

export const VoiceGenerationRequestSchema = z.object({
  text: z.string().describe('Text to convert to speech'),
  voiceId: z.string().optional().describe('Specific voice ID to use'),
  voiceConfigId: z.string().optional().describe('Saved voice configuration ID'),
  provider: VoiceProviderSchema.optional().describe('Provider to use'),
  settings: VoiceSettingsSchema.optional().describe('Voice settings'),
  characterId: z.string().optional().describe('Character ID for voice assignment'),
  messageId: z.string().optional().describe('Message ID for audio tracking'),
  language: z.string().optional().describe('Language code (e.g., en-US)'),
});

export type VoiceGenerationRequest = z.infer<typeof VoiceGenerationRequestSchema>;

export const VoiceGenerationResultSchema = z.object({
  id: z.string().describe('Unique identifier'),
  audioUrl: z.string().describe('URL of the generated audio'),
  duration: z.number().describe('Duration in seconds'),
  provider: VoiceProviderSchema.describe('Provider used'),
  voiceId: z.string().describe('Voice ID used'),
  text: z.string().describe('Input text'),
  settings: VoiceSettingsSchema,
  createdAt: z.string().datetime(),
});

export type VoiceGenerationResult = z.infer<typeof VoiceGenerationResultSchema>;

export type VoiceConfigData = z.infer<typeof VoiceConfigSchema>;
export type GeneratedSpeechData = z.infer<typeof GeneratedSpeechSchema>;

export interface VoiceProviderInterface {
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
}

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  previewUrl?: string;
}

export interface VoiceProviderCapabilities {
  provider: VoiceProvider;
  name: string;
  supportedLanguages: string[];
  supportsVoices: boolean;
  supportsSpeed: boolean;
  supportsPitch: boolean;
  supportsVolume: boolean;
  maxTextLength: number;
  avgLatency: number;
}

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
