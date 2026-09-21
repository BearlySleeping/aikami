// apps/frontend/client/src/lib/views/game/ui/hud/music_player_view_model.test.ts
//
// MusicPlayerViewModel — explicit capability wiring. The reactive `$effect`
// registered in `initialize()` only runs inside a Svelte component, so these
// tests pin construction plus the capability-backed getters and delegation.

import { describe, expect, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { MusicSceneContext } from '@aikami/types';
import type { GameOverlayType } from '$types';
import {
  createMusicPlayerViewModel,
  type MusicPlayerCapabilities,
  type MusicPlayerContextCapabilities,
} from './music_player_view_model.svelte';

type PlayerCalls = {
  setVisible: boolean[];
  resume: number;
  pause: number;
  skip: number;
  stop: number;
  scene: MusicSceneContext[];
};

const createPlayer = (
  overrides: Partial<MusicPlayerCapabilities> = {},
): { player: MusicPlayerCapabilities; calls: PlayerCalls } => {
  const calls: PlayerCalls = {
    setVisible: [],
    resume: 0,
    pause: 0,
    skip: 0,
    stop: 0,
    scene: [],
  };
  const player: MusicPlayerCapabilities = {
    visible: true,
    currentTrack: { title: 'Forest Theme' },
    vibeLabel: 'Exploration · Forest',
    isPlaying: true,
    isPaused: false,
    hasSimilarTracks: true,
    feedback: '',
    setVisible: (v) => {
      calls.setVisible.push(v);
    },
    resume: async () => {
      calls.resume += 1;
    },
    pause: () => {
      calls.pause += 1;
    },
    skip: async () => {
      calls.skip += 1;
    },
    stop: () => {
      calls.stop += 1;
    },
    setSceneContext: (ctx) => {
      calls.scene.push(ctx);
    },
    ...overrides,
  };
  return { player, calls };
};

const CONTEXT: MusicPlayerContextCapabilities = {
  playerScene: 'forest',
  currentMapId: 'map-1',
  gameHour: 20,
  rainIntensity: 0,
  activeOverlay: 'NONE' as GameOverlayType,
  buildSceneContext: (): MusicSceneContext => ({
    locationType: 'forest',
    timeOfDay: 'evening',
    weather: 'clear',
    isInCombat: false,
    mood: 'calm',
    lastNarrative: '',
  }),
};

const createVm = (
  options: {
    player?: Partial<MusicPlayerCapabilities>;
    context?: Partial<MusicPlayerContextCapabilities>;
  } = {},
) => {
  const { player, calls } = createPlayer(options.player);
  const vm = createMusicPlayerViewModel({
    className: 'MusicPlayerViewModel',
    player,
    context: { ...CONTEXT, ...options.context },
  });
  return { vm, calls };
};

describe('MusicPlayerViewModel — construction', () => {
  test('constructs from explicit capabilities and extends the real base', () => {
    const { vm } = createVm();
    expect(vm).toBeInstanceOf(BaseViewModel);
  });
});

describe('MusicPlayerViewModel — getters', () => {
  test('reflect the injected player capabilities', () => {
    const { vm } = createVm();
    expect(vm.visible).toBe(true);
    expect(vm.currentTrackTitle).toBe('Forest Theme');
    expect(vm.vibeLabel).toBe('Exploration · Forest');
    expect(vm.isPlaying).toBe(true);
    expect(vm.isPaused).toBe(false);
    expect(vm.hasSimilarTracks).toBe(true);
    expect(vm.hasActiveTrack).toBe(true);
    expect(vm.feedback).toBe('');
  });

  test('fall back to the placeholder when no track is loaded', () => {
    const { vm } = createVm({ player: { currentTrack: null } });
    expect(vm.currentTrackTitle).toBe('No music playing');
    expect(vm.hasActiveTrack).toBe(false);
  });
});

describe('MusicPlayerViewModel — controls', () => {
  test('hide sets visibility to false', () => {
    const { vm, calls } = createVm();
    vm.hide();
    expect(calls.setVisible).toEqual([false]);
  });

  test('togglePlayPause resumes when paused', async () => {
    const { vm, calls } = createVm({ player: { isPlaying: false, isPaused: true } });
    await vm.togglePlayPause();
    expect(calls.resume).toBe(1);
    expect(calls.pause).toBe(0);
    expect(calls.skip).toBe(0);
  });

  test('togglePlayPause pauses when playing', async () => {
    const { vm, calls } = createVm({ player: { isPlaying: true, isPaused: false } });
    await vm.togglePlayPause();
    expect(calls.pause).toBe(1);
    expect(calls.resume).toBe(0);
    expect(calls.skip).toBe(0);
  });

  test('togglePlayPause skips when stopped', async () => {
    const { vm, calls } = createVm({ player: { isPlaying: false, isPaused: false } });
    await vm.togglePlayPause();
    expect(calls.skip).toBe(1);
    expect(calls.resume).toBe(0);
    expect(calls.pause).toBe(0);
  });

  test('skip and stop delegate to the player capability', async () => {
    const { vm, calls } = createVm();
    await vm.skip();
    vm.stop();
    expect(calls.skip).toBe(1);
    expect(calls.stop).toBe(1);
  });
});
