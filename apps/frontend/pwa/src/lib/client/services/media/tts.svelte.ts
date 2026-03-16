// apps/frontend/pwa/src/lib/client/services/media/tts.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

export type TtsOptions = BaseFrontendClassOptions;

export type TtsResult = {
  audioUrl: string;
  isDemo: boolean;
};

export type TtsServiceInterface = BaseFrontendClassInterface & {
  /**
   * Converts text to speech.
   * @param options - Configuration object.
   * @param options.text The text to convert to speech.
   * @param options.voiceId Optional voice ID to use.
   * @returns A promise that resolves to the audio URL.
   */
  speak(options: { text: string; voiceId?: string }): Promise<TtsResult>;

  /**
   * Stops any currently playing audio.
   */
  stop(): void;

  /**
   * Checks if the service is running in demo/emulator mode.
   */
  isDemoMode(): boolean;
};

class TtsService extends BaseFrontendClass<TtsOptions> implements TtsServiceInterface {
  private isDemo = true;
  private currentAudio: HTMLAudioElement | null = null;

  isDemoMode(): boolean {
    return this.isDemo;
  }

  async speak(options: { text: string; voiceId?: string }): Promise<TtsResult> {
    this.debug('speak', options);
    const { text, voiceId } = options;

    this.stop();

    if (this.isDemo) {
      this.debug('speak: demo mode - returning mock audio');
      return {
        audioUrl: `https://placehold.co/1x1.mp3?text=${encodeURIComponent(text.slice(0, 20))}`,
        isDemo: true,
      };
    }

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        audioUrl: data.audioUrl,
        isDemo: false,
      };
    } catch (error) {
      this.error('speak failed', error);
      throw error;
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }
}

export const ttsService: TtsServiceInterface = new TtsService({
  className: 'TtsService',
});
