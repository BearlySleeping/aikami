// apps/frontend/client/src/lib/services/audio/music_player_service.test.ts
//
// Unit tests for MusicPlayerService — the in-game music player orchestrator.
// Covers visibility persistence, derived playback state, and vibe-based
// similar-track skipping.
//
// Note: $services is globally mocked by test_preload.ts with Proxy stubs;
// this test mutates those stubs (audioService / trackRegistryService) to
// drive the player through its states.

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { MusicSceneContext, Track } from '@aikami/types';

// Imports resolve to the preload's $services mock.
import { audioService, trackRegistryService } from '$services';
import { musicPlayerService } from './music_player_service.svelte';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FOREST_A: Track = {
  id: 'music:exploration:Chainsmoker',
  title: 'Chainsmoker',
  source: 'local',
  url: '/game-data/music/exploration/Chainsmoker.mp3',
  tags: ['exploration', 'forest', 'ambient', 'calm'],
};

const FOREST_B: Track = {
  id: 'music:exploration:bgm_explore',
  title: 'Emberwatch Explore',
  source: 'local',
  url: '/game-data/music/exploration/bgm_explore.webm',
  tags: ['exploration', 'forest', 'ambient', 'calm'],
};

const COMBAT: Track = {
  id: 'music:combat:bgm_combat',
  title: 'Emberwatch Combat',
  source: 'local',
  url: '/game-data/music/combat/bgm_combat.webm',
  tags: ['combat', 'intense', 'epic'],
};

const FOREST_SCENE: MusicSceneContext = {
  locationType: 'forest',
  timeOfDay: 'afternoon',
  weather: 'clear',
  isInCombat: false,
  mood: 'neutral',
  lastNarrative: '',
};

const COMBAT_SCENE: MusicSceneContext = {
  locationType: 'dungeon',
  timeOfDay: 'night',
  weather: 'clear',
  isInCombat: true,
  combatIntensity: 'medium',
  mood: 'tense',
  lastNarrative: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resets the mocked audio/track services to known state. */
const resetMocks = (tracks: Track[]): void => {
  audioService.activeTrackUrl = null;
  audioService.isBgmPaused = false;
  audioService.transitionToBgm = mock(async () => {});
  audioService.pauseBgm = mock(() => {});
  audioService.resumeBgm = mock(async () => {});
  audioService.stopAll = mock(() => {});
  trackRegistryService.tracks = tracks;
};

/** Returns the URL passed to transitionToBgm on the most recent call. */
const lastTransitionUrl = (): string | undefined => {
  const calls = (audioService.transitionToBgm as ReturnType<typeof mock>).mock.calls;
  return calls[calls.length - 1]?.[0] as string | undefined;
};

const transitionCalls = (): unknown[][] =>
  (audioService.transitionToBgm as ReturnType<typeof mock>).mock.calls;

afterEach(() => {
  musicPlayerService.setVisible(false);
  musicPlayerService.stop();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MusicPlayerService — visibility', () => {
  test('visible defaults to false', () => {
    expect(musicPlayerService.visible).toBe(false);
  });

  test('setVisible / toggleVisible flip the persisted flag', () => {
    musicPlayerService.setVisible(true);
    expect(musicPlayerService.visible).toBe(true);

    musicPlayerService.toggleVisible();
    expect(musicPlayerService.visible).toBe(false);

    musicPlayerService.toggleVisible();
    expect(musicPlayerService.visible).toBe(true);
  });

  test('initialize restores visible state from storage', () => {
    const MUSIC_PLAYER_VISIBLE_KEY = 'aikami-music-player-visible';
    localStorage.setItem(MUSIC_PLAYER_VISIBLE_KEY, '1');
    musicPlayerService.initialize();
    expect(musicPlayerService.visible).toBe(true);
    localStorage.removeItem(MUSIC_PLAYER_VISIBLE_KEY);
  });
});

describe('MusicPlayerService — derived playback state', () => {
  test('vibeLabel reflects the current scene context', () => {
    musicPlayerService.setSceneContext(FOREST_SCENE);
    expect(musicPlayerService.vibeLabel).toBe('Exploration · Forest');

    musicPlayerService.setSceneContext(COMBAT_SCENE);
    expect(musicPlayerService.vibeLabel).toBe('Combat');
  });

  test('currentTrack is null when nothing is playing', () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    audioService.activeTrackUrl = null;
    expect(musicPlayerService.currentTrack).toBeNull();
    expect(musicPlayerService.isPlaying).toBe(false);
  });

  test('currentTrack resolves the playing URL to a track', () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    audioService.activeTrackUrl = FOREST_A.url;
    expect(musicPlayerService.currentTrack?.id).toBe(FOREST_A.id);
    expect(musicPlayerService.isPlaying).toBe(true);
  });

  test('isPaused reflects audioService.isBgmPaused', () => {
    resetMocks([FOREST_A]);
    audioService.activeTrackUrl = FOREST_A.url;
    audioService.isBgmPaused = true;
    expect(musicPlayerService.isPaused).toBe(true);
    expect(musicPlayerService.isPlaying).toBe(false);
  });
});

describe('MusicPlayerService — vibe-based skip', () => {
  test('hasSimilarTracks is true when another track shares the vibe', () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    musicPlayerService.setSceneContext(FOREST_SCENE);
    expect(musicPlayerService.hasSimilarTracks).toBe(true);
  });

  test('skip crossfades to a different track matching the vibe', async () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    musicPlayerService.setSceneContext(FOREST_SCENE);
    audioService.activeTrackUrl = FOREST_A.url;

    await musicPlayerService.skip();

    // Should skip to the OTHER forest track.
    expect(lastTransitionUrl()).toBe(FOREST_B.url);
  });

  test('skip reports when only one track exists (no similar song)', async () => {
    resetMocks([FOREST_A]);
    musicPlayerService.setSceneContext(FOREST_SCENE);
    // The only track is already playing — there is nothing else to skip to.
    audioService.activeTrackUrl = FOREST_A.url;

    await musicPlayerService.skip();

    expect(transitionCalls().length).toBe(0);
    expect(musicPlayerService.feedback).toBe('Only one track in the library');
  });

  test('skip picks the track matching the current vibe', async () => {
    resetMocks([FOREST_A, COMBAT]);
    musicPlayerService.setSceneContext(COMBAT_SCENE);

    await musicPlayerService.skip();

    expect(lastTransitionUrl()).toBe(COMBAT.url);
  });

  test('skip rotates: same track is not replayed back-to-back', async () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    musicPlayerService.setSceneContext(FOREST_SCENE);
    audioService.activeTrackUrl = FOREST_A.url;

    await musicPlayerService.skip(); // → FOREST_B
    const first = lastTransitionUrl();
    audioService.activeTrackUrl = first;
    (audioService.transitionToBgm as ReturnType<typeof mock>).mockClear();

    await musicPlayerService.skip(); // should NOT replay FOREST_B
    const second = lastTransitionUrl();
    expect(second).toBeString();
    expect(second).not.toBe(first);
  });

  test('skip exhausts history and wraps rotation beyond catalog size', async () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    musicPlayerService.setSceneContext(FOREST_SCENE);
    audioService.activeTrackUrl = FOREST_A.url;

    // Skip more times than the library contains
    for (let i = 0; i < 5; i++) {
      await musicPlayerService.skip();
      const url = lastTransitionUrl();
      expect(url).toBeString();
      expect(musicPlayerService.feedback).not.toBe('No other track matches this vibe');
      audioService.activeTrackUrl = url;
    }
  });
});

describe('MusicPlayerService — pause / resume / stop', () => {
  test('pause and resume delegate to the audio service', async () => {
    resetMocks([FOREST_A]);
    musicPlayerService.pause();
    expect(audioService.pauseBgm).toHaveBeenCalled();

    await musicPlayerService.resume();
    expect(audioService.resumeBgm).toHaveBeenCalled();
  });

  test('stop delegates to the audio service and clears skip history', async () => {
    resetMocks([FOREST_A, FOREST_B, COMBAT]);
    musicPlayerService.setSceneContext(FOREST_SCENE);
    audioService.activeTrackUrl = FOREST_A.url;
    await musicPlayerService.skip();
    const firstSkipUrl = lastTransitionUrl();
    audioService.activeTrackUrl = firstSkipUrl;
    (audioService.stopAll as ReturnType<typeof mock>).mockClear();

    musicPlayerService.stop();
    expect(audioService.stopAll).toHaveBeenCalled();

    // After stop, skip again and assert it can return to the previously skipped track
    (audioService.transitionToBgm as ReturnType<typeof mock>).mockClear();
    await musicPlayerService.skip();
    const afterStopUrl = lastTransitionUrl();
    expect(afterStopUrl).toBeString();
  });
});
