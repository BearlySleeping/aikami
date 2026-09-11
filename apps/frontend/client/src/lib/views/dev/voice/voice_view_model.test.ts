// apps/frontend/client/src/lib/views/dev/voice/voice_view_model.test.ts
//
// VoiceViewModel — TTS state projection and lifecycle delegation through an
// explicit TTS capability fixture.
//
// Contract: voice synthesis pipeline

import { describe, expect, mock, test } from 'bun:test';
import type { VoiceInfo } from '@aikami/types';
import { createVoiceViewModel, type TtsCapabilities } from './voice_view_model.svelte.ts';

const VOICES: VoiceInfo[] = [{ id: 'af_bella', description: 'Bella' }];

const createHarness = () => {
  const state = {
    isPlaying: false,
    isSynthesizing: false,
    currentWordIndex: -1,
    voices: VOICES,
    selectedVoice: 'af_bella',
  };
  const loadVoices = mock(async () => {});
  const stop = mock(() => {});
  const startStream = mock((_options: { messageId: string; text: string }) => {});
  const enqueueChunk = mock(async (_options: { buffer: ArrayBuffer; words?: string[] }) => {});
  const endStream = mock(() => {});

  const tts = {
    get isPlaying() {
      return state.isPlaying;
    },
    get isSynthesizing() {
      return state.isSynthesizing;
    },
    get currentWordIndex() {
      return state.currentWordIndex;
    },
    get voices() {
      return state.voices;
    },
    get selectedVoice() {
      return state.selectedVoice;
    },
    set selectedVoice(value: string) {
      state.selectedVoice = value;
    },
    loadVoices,
    stop,
    startStream,
    enqueueChunk,
    endStream,
  } satisfies TtsCapabilities;

  const viewModel = createVoiceViewModel({ className: 'VoiceViewModel', tts });
  return { viewModel, state, loadVoices, stop };
};

describe('VoiceViewModel — state projection', () => {
  test('playbackProgress derives from word index while playing', () => {
    const { viewModel, state } = createHarness();
    viewModel.text = 'one two three four';
    state.isPlaying = true;
    state.currentWordIndex = 1;

    expect(viewModel.playbackProgress).toBe(50);
  });

  test('playbackProgress is zero when not playing', () => {
    const { viewModel } = createHarness();
    expect(viewModel.playbackProgress).toBe(0);
  });

  test('voices and isConnected proxy the TTS capability', () => {
    const { viewModel, state } = createHarness();
    expect(viewModel.voices).toEqual(VOICES);
    expect(viewModel.isConnected).toBe(false);

    state.isSynthesizing = true;
    expect(viewModel.isConnected).toBe(true);
  });

  test('selectedVoice getter/setter proxies the TTS capability', () => {
    const { viewModel, state } = createHarness();
    expect(viewModel.selectedVoice).toBe('af_bella');
    viewModel.selectedVoice = 'am_adam';
    expect(state.selectedVoice).toBe('am_adam');
  });
});

describe('VoiceViewModel — lifecycle', () => {
  test('initialize loads voices from the capability', async () => {
    const { viewModel, loadVoices } = createHarness();
    await viewModel.initialize();
    expect(loadVoices).toHaveBeenCalledTimes(1);
  });

  test('cancel stops playback and clears synthesis state', () => {
    const { viewModel, stop } = createHarness();
    viewModel.isSynthesizing = true;
    viewModel.synthesisProgress = 50;

    viewModel.cancel();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(viewModel.isSynthesizing).toBe(false);
    expect(viewModel.synthesisProgress).toBe(0);
  });
});
