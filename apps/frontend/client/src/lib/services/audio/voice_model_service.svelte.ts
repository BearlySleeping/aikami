// apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts
//
// On-demand Kokoro voice model download manager (C-389 AC-4b / AC-4c / AC-5).
// Delegates to ModelAssetStore (C-427). Only the Kokoro bundle declaration
// and its cache-key helpers live here.

import { KOKORO_BUNDLE } from '@aikami/constants';
import { ModelAssetStore } from '@aikami/frontend/local-runtime';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { VoiceModelState } from '$types';

export type VoiceModelServiceOptions = BaseFrontendClassOptions;

export type VoiceModelServiceInterface = BaseFrontendClassInterface & {
  readonly state: VoiceModelState;
  readonly totalBytes: number;
  readonly isDownloading: boolean;
  checkStatus(): Promise<VoiceModelState>;
  download(): Promise<VoiceModelState>;
  cancel(): void;
  deleteModel(): Promise<void>;
};

const _store = new ModelAssetStore({ bundles: { 'kokoro-82m': KOKORO_BUNDLE } });

class VoiceModelService
  extends BaseFrontendClass<VoiceModelServiceOptions>
  implements VoiceModelServiceInterface
{
  // ModelAssetStore mutates its `states` object in place — not a Svelte
  // reactive value — so download progress would never re-render the UI
  // without mirroring updates into this $state field via subscribe().
  private _state: VoiceModelState = $state(_store.states['kokoro-82m'] as VoiceModelState);

  constructor(options: VoiceModelServiceOptions) {
    super(options);
    _store.subscribe('kokoro-82m', (state) => {
      this._state = state as VoiceModelState;
    });
  }

  get state(): VoiceModelState {
    return this._state;
  }

  get totalBytes(): number {
    return _store.totalBytes('kokoro-82m');
  }

  get isDownloading(): boolean {
    const s = this.state;
    return s.status === 'downloading' || s.status === 'verifying';
  }

  async checkStatus(): Promise<VoiceModelState> {
    return (await _store.status('kokoro-82m')) as VoiceModelState;
  }

  async download(): Promise<VoiceModelState> {
    return (await _store.download('kokoro-82m')) as VoiceModelState;
  }

  cancel(): void {
    _store.cancel('kokoro-82m');
  }

  async deleteModel(): Promise<void> {
    await _store.remove('kokoro-82m');
  }

  /** @internal Reset in-memory state for testing. */
  _reset(): void {
    _store._reset('kokoro-82m');
  }
}

export const voiceModelService: VoiceModelServiceInterface = VoiceModelService.create({
  className: 'VoiceModelService',
});
