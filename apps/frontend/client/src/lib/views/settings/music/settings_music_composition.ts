// apps/frontend/client/src/lib/views/settings/music/settings_music_composition.ts
//
// Production wiring for the music settings ViewModel.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { assetStore, audioService, trackRegistryService } from '$services';
import {
  createSettingsMusicViewModel,
  type SettingsMusicViewModelInterface,
} from './settings_music_view_model.svelte';

export const getSettingsMusicViewModel = (
  options: BaseViewModelOptions,
): SettingsMusicViewModelInterface =>
  createSettingsMusicViewModel({
    ...options,
    audio: {
      get bgmVolume(): number {
        return audioService.bgmVolume;
      },
      get activeTrackUrl(): string | null {
        return audioService.activeTrackUrl;
      },
      transitionToBgm: (url, durationMs) => audioService.transitionToBgm(url, durationMs),
      stopAll: () => audioService.stopAll(),
      setBgmVolume: (volume) => audioService.setBgmVolume(volume),
      setSfxVolume: (volume) => audioService.setSfxVolume(volume),
    },
    assets: {
      get audioMuted(): boolean {
        return assetStore.audioMuted;
      },
      setAudioMuted: (muted) => assetStore.setAudioMuted(muted),
    },
    registry: {
      getTrackById: (trackId) => trackRegistryService.getTrackById(trackId),
      setSceneOverrides: (overrides) => trackRegistryService.setSceneOverrides(overrides),
      discoverLocal: () => trackRegistryService.discoverLocal(),
      get tracks() {
        return trackRegistryService.tracks;
      },
      get isReady() {
        return trackRegistryService.isReady;
      },
    },
  });
