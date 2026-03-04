import {
  DEFAULT_VOICE_SETTINGS,
  VoiceGenerationRequest,
  VoiceGenerationResult,
  VoiceInfo,
  VoiceProvider,
  VoiceProviderCapabilities,
  VoiceProviderInterface,
  VoiceSettings,
} from '@aikami/schemas';

export class ElevenLabsProvider implements VoiceProviderInterface {
  readonly name = 'ElevenLabs';
  readonly provider = 'elevenlabs' as const;
  readonly supportsVoices = true;
  readonly supportsLanguages = true;
  readonly supportsSpeed = true;
  readonly supportsPitch = true;
  readonly maxTextLength = 5000;

  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
  }

  async generate(request: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
    const _startTime = Date.now();

    const voiceId = request.voiceId || 'rachel';
    const settings = request.settings || DEFAULT_VOICE_SETTINGS;

    const body = {
      text: request.text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: settings.stability || 0.5,
        similarity_boost: settings.similarity || 0.75,
        style: settings.style || 0,
        speed: settings.speed,
        pitch: settings.pitch ? (settings.pitch - 1) * 50 : 0,
      },
    };

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    const audioBlob = await response.blob();
    const audioBase64 = await this.blobToBase64(audioBlob);
    const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

    const duration = Math.round(audioBlob.size / 2000);

    return {
      id: crypto.randomUUID(),
      audioUrl,
      duration,
      provider: 'elevenlabs',
      voiceId,
      text: request.text,
      settings,
      createdAt: new Date().toISOString(),
    };
  }

  async listVoices(language?: string): Promise<VoiceInfo[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      voices: { voice_id: string; name: string; category: string; language: string }[];
    };
    let voices = data.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      language: v.language,
      gender: v.category === 'premium' ? 'neutral' : undefined,
    }));

    if (language) {
      voices = voices.filter((v) => v.language.startsWith(language));
    }

    return voices;
  }

  getCapabilities(): VoiceProviderCapabilities {
    return {
      provider: 'elevenlabs',
      name: this.name,
      supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'zh'],
      supportsVoices: this.supportsVoices,
      supportsSpeed: this.supportsSpeed,
      supportsPitch: this.supportsPitch,
      supportsVolume: false,
      maxTextLength: this.maxTextLength,
      avgLatency: 2000,
    };
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export class SileroProvider implements VoiceProviderInterface {
  readonly name = 'Silero';
  readonly provider = 'silero' as const;
  readonly supportsVoices = true;
  readonly supportsLanguages = true;
  readonly supportsSpeed = true;
  readonly supportsPitch = false;
  readonly maxTextLength = 1000;

  private baseUrl = 'https://api.silero.ai';

  async generate(request: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
    const _startTime = Date.now();

    const voiceId = request.voiceId || 'aidar_48khz';
    const settings = request.settings || DEFAULT_VOICE_SETTINGS;

    const response = await fetch(`${this.baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        voice: voiceId,
        speed: settings.speed,
        sample_rate: 48000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Silero API error: ${response.statusText}`);
    }

    const audioBlob = await response.blob();
    const audioBase64 = await this.blobToBase64(audioBlob);
    const audioUrl = `data:audio/wav;base64,${audioBase64}`;

    const duration = Math.round(audioBlob.size / 24000);

    return {
      id: crypto.randomUUID(),
      audioUrl,
      duration,
      provider: 'silero',
      voiceId,
      text: request.text,
      settings,
      createdAt: new Date().toISOString(),
    };
  }

  async listVoices(language?: string): Promise<VoiceInfo[]> {
    const response = await fetch(`${this.baseUrl}/voices`);
    if (!response.ok) {
      throw new Error(`Silero API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      voices: { id: string; name: string; language: string }[];
    };
    let voices = data.voices.map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
    }));

    if (language) {
      voices = voices.filter((v) => v.language.startsWith(language));
    }

    return voices;
  }

  getCapabilities(): VoiceProviderCapabilities {
    return {
      provider: 'silero',
      name: this.name,
      supportedLanguages: [
        'ru',
        'en',
        'de',
        'es',
        'fr',
        'uk',
        'pl',
        'tr',
        'it',
        'ka',
        'az',
        'uz',
        'kk',
      ],
      supportsVoices: this.supportsVoices,
      supportsSpeed: this.supportsSpeed,
      supportsPitch: this.supportsPitch,
      supportsVolume: false,
      maxTextLength: this.maxTextLength,
      avgLatency: 500,
    };
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export class CoquiProvider implements VoiceProviderInterface {
  readonly name = 'Coqui';
  readonly provider = 'coqui' as const;
  readonly supportsVoices = true;
  readonly supportsLanguages = true;
  readonly supportsSpeed = true;
  readonly supportsPitch = true;
  readonly maxTextLength = 2000;

  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.COQUI_API_URL || 'http://localhost:5002';
  }

  async generate(request: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
    const _startTime = Date.now();

    const voiceId = request.voiceId || 'female-voice-1';
    const settings = request.settings || DEFAULT_VOICE_SETTINGS;

    const response = await fetch(`${this.baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        voice_id: voiceId,
        speed: settings.speed,
        pitch: settings.pitch,
      }),
    });

    if (!response.ok) {
      throw new Error(`Coqui API error: ${response.statusText}`);
    }

    const audioBlob = await response.blob();
    const audioBase64 = await this.blobToBase64(audioBlob);
    const audioUrl = `data:audio/wav;base64,${audioBase64}`;

    const duration = Math.round(audioBlob.size / 24000);

    return {
      id: crypto.randomUUID(),
      audioUrl,
      duration,
      provider: 'coqui',
      voiceId,
      text: request.text,
      settings,
      createdAt: new Date().toISOString(),
    };
  }

  async listVoices(_language?: string): Promise<VoiceInfo[]> {
    return [
      { id: 'female-voice-1', name: 'Female Voice 1', language: 'en' },
      { id: 'male-voice-1', name: 'Male Voice 1', language: 'en' },
      { id: 'neutral-voice-1', name: 'Neutral Voice', language: 'en' },
    ];
  }

  getCapabilities(): VoiceProviderCapabilities {
    return {
      provider: 'coqui',
      name: this.name,
      supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'ru', 'uk', 'zh', 'ja', 'ko'],
      supportsVoices: this.supportsVoices,
      supportsSpeed: this.supportsSpeed,
      supportsPitch: this.supportsPitch,
      supportsVolume: false,
      maxTextLength: this.maxTextLength,
      avgLatency: 3000,
    };
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export const createVoiceProvider = (
  provider: VoiceProvider,
  options?: { apiKey?: string; baseUrl?: string },
): VoiceProviderInterface => {
  switch (provider) {
    case 'elevenlabs':
      return new ElevenLabsProvider(options?.apiKey);
    case 'silero':
      return new SileroProvider();
    case 'coqui':
      return new CoquiProvider(options?.baseUrl);
    default:
      throw new Error(`Unknown voice provider: ${provider}`);
  }
};
