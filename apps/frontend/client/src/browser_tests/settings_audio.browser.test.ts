// apps/frontend/client/src/browser_tests/settings_audio.browser.test.ts
import { flushSync } from 'svelte';
import { expect, test, vi } from 'vitest';
import { createSettingsAudioViewModel } from '../lib/views/settings/audio/settings_audio_view_model.svelte';
import { observeAudioBusy } from './settings_audio_observer.svelte';

test('TTS busy state notifies reactive consumers until synthesis settles', async () => {
  const synthesis = Promise.withResolvers<unknown>();
  const viewModel = createSettingsAudioViewModel({
    className: 'SettingsAudioViewModelTest',
    audio: {
      masterVolume: 1,
      bgmVolume: 1,
      sfxVolume: 1,
      isCrossfading: false,
      setMasterVolume: vi.fn(),
      setBgmVolume: vi.fn(),
      setSfxVolume: vi.fn(),
      playTestSfx: vi.fn(),
      stopAll: vi.fn(),
    },
    tts: {
      ttsVolume: 1,
      status: 'ready',
      backend: 'wasm',
      errorMessage: null,
      isPlaying: false,
      selectedVoice: 'af_heart',
      isKokoroServerAvailable: false,
      setTtsVolume: vi.fn(),
      initialize: vi.fn(async () => {}),
      reset: vi.fn(),
      synthesize: vi.fn(() => synthesis.promise),
      stop: vi.fn(),
    },
    voiceModel: {
      state: { status: 'ready' },
      totalBytes: 100,
      checkStatus: vi.fn(async () => ({ status: 'ready' as const })),
      download: vi.fn(async () => ({ status: 'ready' as const })),
      cancel: vi.fn(),
      deleteModel: vi.fn(async () => {}),
    },
    runtimeConfig: {
      getVoiceTtsMode: () => 'browser',
      getVoiceTtsUrl: () => undefined,
    },
    playSceneBgm: vi.fn(async () => {}),
  });
  const observed: boolean[] = [];
  const cleanup = observeAudioBusy(() => {
    observed.push(viewModel.isTtsBusy);
  });
  try {
    flushSync();
    const pending = viewModel.testTts();
    flushSync();
    expect(observed).toEqual([false, true]);
    synthesis.resolve({ kind: 'scheduled' });
    await pending;
    flushSync();
    expect(observed).toEqual([false, true, false]);
  } finally {
    synthesis.resolve({ kind: 'cancelled' });
    cleanup();
    await viewModel.dispose();
  }
});
