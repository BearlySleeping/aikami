// apps/frontend/client/src/lib/utils/music_playback_intent.test.ts
//
// The BGM intent record, read as untrusted data.
//
// The load-bearing distinction is no-record vs recorded-decision: defaulting a
// player who never used the music player to "stopped" would silence the game's
// music for everyone, so absence must read as "no opinion".

import { describe, expect, test } from 'bun:test';
import { MUSIC_PLAYER_PLAYBACK_KEY } from '@aikami/constants';
import {
  isBgmSuppressedByPlayer,
  parseMusicPlaybackIntent,
  readMusicPlaybackIntent,
  SAFE_UNREADABLE_INTENT,
  serializeMusicPlaybackIntent,
  writeMusicPlaybackIntent,
} from './music_playback_intent.ts';

describe('music playback intent — persisted BGM choice', () => {
  test('a player who never used the controls has NO opinion, not a Stop', () => {
    localStorage.removeItem(MUSIC_PLAYER_PLAYBACK_KEY);
    expect(readMusicPlaybackIntent()).toBeUndefined();
    // 🔴 The regression this guards: defaulting absence to `stopped` would
    // mute scene music for every player who never opened the music player.
    expect(isBgmSuppressedByPlayer()).toBe(false);
  });

  test('every state round-trips through storage', () => {
    for (const state of ['playing', 'paused', 'stopped'] as const) {
      const intent = { state, trackId: 'music:exploration:bgm_explore' };
      const restored = parseMusicPlaybackIntent(serializeMusicPlaybackIntent(intent));
      expect(restored).toEqual(intent);
    }
  });

  test('a recorded Stop or Pause suppresses; a recorded Play does not', () => {
    const suppressionByState = {
      playing: false,
      paused: true,
      stopped: true,
    } as const;
    for (const [state, suppressed] of Object.entries(suppressionByState)) {
      writeMusicPlaybackIntent({ state: state as 'playing', trackId: undefined });
      expect(isBgmSuppressedByPlayer()).toBe(suppressed);
    }
  });

  test('🔴 an unreadable record suppresses rather than blasting music', () => {
    // We know an opinion was recorded; failing to honour it is worse than an
    // unnecessary silence.
    localStorage.setItem(MUSIC_PLAYER_PLAYBACK_KEY, '{not json');
    expect(readMusicPlaybackIntent()).toEqual(SAFE_UNREADABLE_INTENT);
    expect(isBgmSuppressedByPlayer()).toBe(true);
    localStorage.removeItem(MUSIC_PLAYER_PLAYBACK_KEY);
  });

  test('unrecognised shapes are rejected rather than partially trusted', () => {
    for (const raw of ['', 'null', '"stopped"', '[]', '[{"state":"playing"}]', '7']) {
      expect(parseMusicPlaybackIntent(raw)).toEqual(SAFE_UNREADABLE_INTENT);
    }
    expect(parseMusicPlaybackIntent(JSON.stringify({ state: 'wat' })).state).toBe('stopped');
    expect(parseMusicPlaybackIntent(JSON.stringify({ state: 'PLAYING' })).state).toBe('stopped');
  });

  test('a non-string or empty trackId is dropped rather than carried', () => {
    expect(parseMusicPlaybackIntent(JSON.stringify({ state: 'playing', trackId: 7 })).trackId).toBe(
      undefined,
    );
    expect(
      parseMusicPlaybackIntent(JSON.stringify({ state: 'playing', trackId: '' })).trackId,
    ).toBe(undefined);
    expect(parseMusicPlaybackIntent(JSON.stringify({ state: 'playing' })).trackId).toBeUndefined();
  });

  test('what the player wrote is what the next session reads back', () => {
    writeMusicPlaybackIntent({ state: 'paused', trackId: 'music:exploration:bgm_explore' });
    expect(readMusicPlaybackIntent()).toEqual({
      state: 'paused',
      trackId: 'music:exploration:bgm_explore',
    });

    writeMusicPlaybackIntent({ state: 'stopped', trackId: undefined });
    expect(readMusicPlaybackIntent()?.state).toBe('stopped');
    localStorage.removeItem(MUSIC_PLAYER_PLAYBACK_KEY);
  });
});
