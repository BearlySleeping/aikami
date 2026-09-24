// apps/frontend/client/src/lib/views/settings/audio/settings_audio_view_model.test.ts
//
// Unit tests for the settings-audio ViewModel. Collaborators are injected
// capabilities, so no global `$services` mock is required.

import { describe, expect, mock, test } from 'bun:test';
import type { VoiceModelState } from '$types';
import {
  createSettingsAudioViewModel,
  type SettingsAudioEngineCapabilities,
  type SettingsAudioRuntimeConfigCapabilities,
  type SettingsAudioTtsCapabilities,
  type SettingsAudioVoiceModelCapabilities,
} from './settings_audio_view_model.svelte';

const notDownloaded: VoiceModelState = { status: 'not-downloaded' } as VoiceModelState;

const createAudio = (
  overrides: Partial<SettingsAudioEngineCapabilities> = {},
): SettingsAudioEngineCapabilities => ({
  masterVolume: 1,
  bgmVolume: 0.8,
  sfxVolume: 0.7,
  isCrossfading: false,
  setMasterVolume: mock(() => {}),
  setBgmVolume: mock(() => {}),
  setSfxVolume: mock(() => {}),
  playTestSfx: mock(() => {}),
  stopAll: mock(() => {}),
  ...overrides,
});

const createTts = (
  overrides: Partial<SettingsAudioTtsCapabilities> = {},
): SettingsAudioTtsCapabilities => ({
  ttsVolume: 0.5,
  status: 'ready',
  backend: 'webgpu',
  errorMessage: null,
  isPlaying: false,
  selectedVoice: 'af_heart',
  isKokoroServerAvailable: false,
  setTtsVolume: mock(() => {}),
  initialize: mock(async () => {}),
  reset: mock(() => {}),
  synthesize: mock(async () => {}),
  stop: mock(() => {}),
  ...overrides,
});

const createVoiceModel = (
  overrides: Partial<SettingsAudioVoiceModelCapabilities> = {},
): SettingsAudioVoiceModelCapabilities => ({
  state: notDownloaded,
  totalBytes: 92_880_000,
  checkStatus: mock(async () => notDownloaded),
  download: mock(async () => notDownloaded),
  cancel: mock(() => {}),
  deleteModel: mock(async () => {}),
  ...overrides,
});

const createRuntimeConfig = (): SettingsAudioRuntimeConfigCapabilities => ({
  getVoiceTtsMode: () => 'browser',
  getVoiceTtsUrl: () => undefined,
});

const createViewModel = (options?: {
  audio?: SettingsAudioEngineCapabilities;
  tts?: SettingsAudioTtsCapabilities;
  voiceModel?: SettingsAudioVoiceModelCapabilities;
  playSceneBgm?: (scene: 'explore' | 'combat') => Promise<void>;
}) =>
  createSettingsAudioViewModel({
    className: 'SettingsAudioViewModelTest',
    audio: options?.audio ?? createAudio(),
    tts: options?.tts ?? createTts(),
    voiceModel: options?.voiceModel ?? createVoiceModel(),
    runtimeConfig: createRuntimeConfig(),
    playSceneBgm: options?.playSceneBgm ?? mock(async () => {}),
  });

describe('SettingsAudioViewModel — volume state', () => {
  test('exposes the injected engine volumes', () => {
    const vm = createViewModel();

    expect(vm.masterVolume).toBe(1);
    expect(vm.bgmVolume).toBe(0.8);
    expect(vm.sfxVolume).toBe(0.7);
    expect(vm.ttsVolume).toBe(0.5);
  });

  test('delegates volume setters to the audio capability', () => {
    const setMasterVolume = mock(() => {});
    const setBgmVolume = mock(() => {});
    const setSfxVolume = mock(() => {});
    const setTtsVolume = mock(() => {});
    const vm = createViewModel({
      audio: createAudio({ setMasterVolume, setBgmVolume, setSfxVolume }),
      tts: createTts({ setTtsVolume }),
    });

    vm.setMasterVolume(0.4);
    vm.setBgmVolume(0.3);
    vm.setSfxVolume(0.2);
    vm.setTtsVolume(0.1);

    expect(setMasterVolume).toHaveBeenCalledWith(0.4);
    expect(setBgmVolume).toHaveBeenCalledWith(0.3);
    expect(setSfxVolume).toHaveBeenCalledWith(0.2);
    expect(setTtsVolume).toHaveBeenCalledWith(0.1);
  });
});

describe('SettingsAudioViewModel — test playback', () => {
  test('testExploreBgm crossfades and reports feedback', async () => {
    const playSceneBgm = mock(async () => {});
    const vm = createViewModel({ playSceneBgm });

    await vm.testExploreBgm();

    expect(playSceneBgm).toHaveBeenCalledWith('explore');
    expect(vm.feedback).toBe('Playing: Exploration BGM');
  });

  test('testHitSfx uses the synthesized SFX tone', async () => {
    const playTestSfx = mock(() => {});
    const vm = createViewModel({ audio: createAudio({ playTestSfx }) });

    await vm.testHitSfx();

    expect(playTestSfx).toHaveBeenCalledTimes(1);
    expect(vm.feedback).toBe('Playing: Hit SFX');
  });
});

describe('SettingsAudioViewModel — voice model', () => {
  test('voiceModelSizeLabel formats the injected byte count', () => {
    const vm = createViewModel();

    expect(vm.voiceModelSizeLabel).toBe('88.6 MB');
  });

  test('ttsBackendLabel maps the injected backend', () => {
    const vm = createViewModel({ tts: createTts({ backend: 'server' }) });

    expect(vm.ttsBackendLabel).toBe('Local server');
  });
});
