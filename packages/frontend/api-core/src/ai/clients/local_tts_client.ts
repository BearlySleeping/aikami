// packages/frontend/api-core/src/ai/clients/local_tts_client.ts

import type { z } from 'zod';

import type { FrontendAiInterface } from '../frontend_ai_interface.ts';
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
  LocalTtsClientOptions,
} from '../types.ts';

/**
 * Local TTS provider using the browser's Web Speech API.
 *
 * Runs entirely client-side — no network calls, no backend, no API keys.
 * Uses `window.speechSynthesis` to speak text aloud.
 *
 * Gracefully degrades when `window.speechSynthesis` is unavailable
 * (SSR, headless browsers, some mobile browsers).
 */
class LocalTtsClient implements FrontendAiInterface {
  readonly name = 'local-tts';
  readonly capabilities!: AiProviderCapabilities;

  private preferredVoice: string | undefined;
  private defaultRate: number;
  private defaultPitch: number;
  private defaultVolume: number;
  private ttsAvailable: boolean;

  /**
   * @param options - TTS client configuration.
   */
  constructor(options: LocalTtsClientOptions = {}) {
    this.preferredVoice = options.preferredVoice;
    this.defaultRate = options.rate ?? 1.0;
    this.defaultPitch = options.pitch ?? 1.0;
    this.defaultVolume = options.volume ?? 1.0;

    // Check if Web Speech API is available
    this.ttsAvailable = this.checkTtsAvailability();

    // Assign readonly capabilities via defineProperty
    const caps: AiProviderCapabilities = {
      dialogue: false,
      contentDescription: false,
      speech: this.ttsAvailable,
      image: false,
      structured: false,
      requiresBackend: false,
      isLocal: true,
    };

    Object.defineProperty(this, 'capabilities', {
      value: caps,
      writable: false,
      enumerable: true,
    });
  }

  // -----------------------------------------------------------------------
  // Unsupported capabilities
  // -----------------------------------------------------------------------

  async generateDialogue(_context: DialogueContext, _options?: DialogueOptions): Promise<DialogueResponse> {
    throw new Error('LocalTtsClient does not support dialogue generation. Use a text AI provider.');
  }

  async generateContentDescription(_prompt: string, _options?: ContentDescriptionOptions): Promise<string> {
    throw new Error('LocalTtsClient does not support content description. Use a text AI provider.');
  }

  async generateImage(_prompt: string, _options?: ImageOptions): Promise<ImageResult> {
    throw new Error('LocalTtsClient does not support image generation. Use ComfyUiClient.');
  }

  async generateStructured<T>(
    _instruction: string,
    _schema: z.ZodSchema<T>,
    _context?: string,
  ): Promise<T> {
    throw new Error('LocalTtsClient does not support structured data generation.');
  }

  // -----------------------------------------------------------------------
  // Speech — the main capability
  // -----------------------------------------------------------------------

  async synthesizeSpeech(text: string, options?: TtsOptions): Promise<SpeechResult> {
    if (!this.ttsAvailable) {
      return {
        audioData: null,
        durationMs: 0,
        voicesAvailable: [],
      };
    }

    const voices = this.getVoices();
    const voice = this.findVoice(options?.voice ?? this.preferredVoice, voices);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options?.rate ?? this.defaultRate;
    utterance.pitch = options?.pitch ?? this.defaultPitch;
    utterance.volume = options?.volume ?? this.defaultVolume;

    if (voice) {
      utterance.voice = voice;
    }

    // Estimate duration (rough: ~15 chars per second at rate 1.0)
    const estimatedDurationMs = Math.round((text.length / 15) * (1 / utterance.rate) * 1000);

    // Speak (fire-and-forget for live playback)
    window.speechSynthesis.speak(utterance);

    return {
      audioData: null, // Live playback — no capture by default
      durationMs: estimatedDurationMs,
      voicesAvailable: voices.map((v) => v.name),
    };
  }

  // -----------------------------------------------------------------------
  // Health Check
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.ttsAvailable) {
      return {
        available: false,
        latencyMs: 0,
        message: 'Web Speech API not available in this environment',
      };
    }

    const voices = this.getVoices();

    return {
      available: voices.length > 0,
      latencyMs: 0,
      message: voices.length > 0
        ? `Web Speech API ready (${voices.length} voices available)`
        : 'Web Speech API available but no voices found',
    };
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  /**
   * Checks if the browser's Web Speech API is available.
   */
  private checkTtsAvailability(): boolean {
    try {
      return typeof window !== 'undefined'
        && typeof window.speechSynthesis !== 'undefined'
        && window.speechSynthesis !== null
        && typeof SpeechSynthesisUtterance !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Gets the list of available speech synthesis voices.
   * Uses synchronous API which works after the first `getVoices()` call.
   */
  private getVoices(): SpeechSynthesisVoice[] {
    if (!this.ttsAvailable) {
      return [];
    }

    return window.speechSynthesis.getVoices();
  }

  /**
   * Finds a voice by fuzzy name matching.
   */
  private findVoice(
    preferred: string | undefined,
    voices: SpeechSynthesisVoice[],
  ): SpeechSynthesisVoice | undefined {
    if (!preferred || voices.length === 0) {
      return undefined;
    }

    const lowerPreferred = preferred.toLowerCase();

    // Try exact match first
    const exact = voices.find((v) => v.name.toLowerCase() === lowerPreferred);

    if (exact) {
      return exact;
    }

    // Try fuzzy match (contains)
    const fuzzy = voices.find((v) => v.name.toLowerCase().includes(lowerPreferred));

    if (fuzzy) {
      return fuzzy;
    }

    // Return any English voice as fallback
    return voices.find((v) => v.lang.startsWith('en'));
  }
}

export { LocalTtsClient };
