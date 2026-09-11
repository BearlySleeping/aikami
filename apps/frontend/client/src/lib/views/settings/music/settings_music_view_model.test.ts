// apps/frontend/client/src/lib/views/settings/music/settings_music_view_model.test.ts
//
// Music settings ViewModel — capability wiring and filter/volume behavior.

import { describe, expect, test } from 'bun:test';
import type { Track } from '@aikami/types';
import {
  createSettingsMusicViewModel,
  type SettingsMusicViewModelOptions,
} from './settings_music_view_model.svelte';

const TRACKS: Track[] = [
  { id: 't1', title: 'Forest', url: 'url/t1', tags: ['exploration', 'calm'] } as unknown as Track,
  { id: 't2', title: 'Battle', url: 'url/t2', tags: ['combat', 'intense'] } as unknown as Track,
];

const createVm = (overrides: Partial<SettingsMusicViewModelOptions> = {}) => {
  const audioCalls = { bgm: [] as number[], sfx: [] as number[], transitions: [] as string[] };
  let muted = false;
  const vm = createSettingsMusicViewModel({
    className: 'SettingsMusicViewModel',
    audio: {
      bgmVolume: 0.5,
      activeTrackUrl: null,
      transitionToBgm: async (url) => {
        audioCalls.transitions.push(url);
      },
      stopAll: () => {},
      setBgmVolume: (v) => audioCalls.bgm.push(v),
      setSfxVolume: (v) => audioCalls.sfx.push(v),
    },
    assets: {
      audioMuted: false,
      setAudioMuted: (value) => {
        muted = value;
      },
    },
    registry: {
      getTrackById: (id) => TRACKS.find((t) => t.id === id),
      setSceneOverrides: () => {},
      discoverLocal: async () => {},
      tracks: TRACKS,
      isReady: true,
    },
    ...overrides,
  });
  return { vm, audioCalls, isMuted: () => muted };
};

describe('SettingsMusicViewModel', () => {
  test('initialize discovers tracks and reports the count', async () => {
    const { vm } = createVm();
    await vm.initialize();
    expect(vm.tracks).toHaveLength(2);
    expect(vm.isReady).toBe(true);
    expect(vm.feedback).toBe('Found 2 track(s)');
  });

  test('filters tracks by active tags', async () => {
    const { vm } = createVm();
    await vm.initialize();
    vm.toggleGenreFilter('combat');
    expect(vm.filteredTracks.map((t) => t.id)).toEqual(['t2']);
    vm.clearFilters();
    expect(vm.filteredTracks).toHaveLength(2);
  });

  test('setMusicVolume clamps and forwards to the audio capability', () => {
    const { vm, audioCalls } = createVm();
    vm.setMusicVolume(1.5);
    expect(vm.musicVolume).toBe(1);
    expect(audioCalls.bgm).toEqual([1]);
    vm.setMusicVolume(-1);
    expect(vm.musicVolume).toBe(0);
    expect(audioCalls.bgm).toEqual([1, 0]);
  });

  test('toggleMute persists via the asset capability and zeroes volume', () => {
    const { vm, audioCalls, isMuted } = createVm();
    vm.toggleMute();
    expect(isMuted()).toBe(true);
    expect(audioCalls.bgm).toEqual([0]);
    expect(audioCalls.sfx).toEqual([0]);
  });

  test('previewTrack transitions to the track url', async () => {
    const { vm, audioCalls } = createVm();
    await vm.previewTrack('t1');
    expect(audioCalls.transitions).toEqual(['url/t1']);
    expect(vm.previewingTrackId).toBe('t1');
    await vm.stopPreview();
  });
});
