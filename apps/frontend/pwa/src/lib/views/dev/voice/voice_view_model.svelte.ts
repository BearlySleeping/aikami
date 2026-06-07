// apps/frontend/pwa/src/lib/views/dev/voice/voice_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { ttsService } from '$services';

export type VoiceViewModelInterface = BaseViewModelInterface & {
  /** The script text to synthesize. */
  readonly text: string;
  /** Whether audio generation/playback is currently active. */
  readonly isPlaying: boolean;
  /** Triggers TTS via the production TTS service. */
  generateAndPlay(): Promise<void>;
  /** Stops playback. */
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

  // ── Public API ────────────────────────────────────────────────────────

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
