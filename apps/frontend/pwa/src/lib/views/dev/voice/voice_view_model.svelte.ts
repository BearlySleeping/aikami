// apps/frontend/pwa/src/lib/views/dev/voice/voice_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type VoiceViewModelInterface = BaseViewModelInterface;

export type VoiceViewModelOptions = BaseViewModelOptions & {};

class VoiceViewModel
  extends BaseViewModel<VoiceViewModelOptions>
  implements VoiceViewModelInterface {}

export const getVoiceViewModel = (options: VoiceViewModelOptions): VoiceViewModelInterface =>
  new VoiceViewModel(options);
