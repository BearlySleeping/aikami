// apps/frontend/pwa/src/lib/views/dev/voice/voice_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { ttsService, type VoiceInfo } from '$services';

export type { VoiceInfo };

export type VoiceViewModelInterface = BaseViewModelInterface & {
  /** The script text to synthesize. */
  readonly text: string;
  /** Whether audio generation/playback is currently active. */
  readonly isPlaying: boolean;
  /** Whether a voice synthesis request is in progress. */
  readonly isConnected: boolean;
  /** Available Kokoro voice presets. */
  readonly voices: readonly VoiceInfo[];
  /** The currently selected voice ID. */
  readonly selectedVoice: string;
  /** POSTs text to the Kokoro TTS REST endpoint and plays the returned WAV. */
  generateAndPlay(): Promise<void>;
  /** Stops playback and aborts the in-progress synthesis request. */
  cancel(): void;
};

export type VoiceViewModelOptions = BaseViewModelOptions & {};

class VoiceViewModel
  extends BaseViewModel<VoiceViewModelOptions>
  implements VoiceViewModelInterface
{
  text = $state('');

  get isPlaying(): boolean {
    return ttsService.isPlaying;
  }

  get isConnected(): boolean {
    return ttsService.isSynthesizing;
  }

  get voices(): readonly VoiceInfo[] {
    return ttsService.voices;
  }

  get selectedVoice(): string {
    return ttsService.selectedVoice;
  }

  set selectedVoice(value: string) {
    ttsService.selectedVoice = value;
  }

  // ── Public API ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await super.initialize();
    void ttsService.loadVoices();
  }

  async generateAndPlay(): Promise<void> {
    this.debug('generateAndPlay', { textLength: this.text.length });
    await ttsService.speak({ text: this.text });
  }

  cancel(): void {
    this.debug('cancel');
    ttsService.stop();
  }
}

export const getVoiceViewModel = (options: VoiceViewModelOptions): VoiceViewModelInterface =>
  new VoiceViewModel(options);
