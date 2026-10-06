// apps/frontend/client/src/lib/utils/music_playback_intent.ts
//
// The player's BGM intent, as it survives a reload.
//
// 🔴 This is INTENT, never playback. An `AudioContext` cannot be built before a
// user gesture, so nothing here can restart music on its own — the value exists
// so a reload can honour what the player last asked for.
//
// The central distinction is between NO RECORD and a recorded decision:
//   - no record   → the player never expressed an opinion. Scene music plays
//                   exactly as it always has.
//   - a record    → the player decided. `stopped` and `paused` suppress the
//                   scene; `playing` lets it through.
//   - a record we cannot read → treated as `stopped`, because we know an
//                   opinion was recorded and failing to honour it is worse than
//                   an unnecessary silence.
//
// Pure and untrusted-by-design, so the service can trust a value that came off
// disk without a second parsing path.

import { MUSIC_PLAYER_PLAYBACK_KEY } from '@aikami/constants';

/** What the player last asked BGM to do. */
export type MusicPlaybackIntent = {
  readonly state: 'playing' | 'paused' | 'stopped';
  /** Track id the intent refers to, when there was one. */
  readonly trackId: string | undefined;
};

const PLAYBACK_STATES: readonly MusicPlaybackIntent['state'][] = ['playing', 'paused', 'stopped'];

/**
 * The intent used when a record EXISTS but cannot be read.
 *
 * 🔴 Stopped, because a bad read must not surprise anyone with noise. This is
 * deliberately not the no-record case: absence is handled by returning
 * `undefined` from {@link readMusicPlaybackIntent} instead.
 */
export const SAFE_UNREADABLE_INTENT: MusicPlaybackIntent = {
  state: 'stopped',
  trackId: undefined,
};

/**
 * Parses a stored record, falling back to stopped for anything unrecognised.
 *
 * 🔴 Untrusted bytes. A hand-edited, truncated or future-format record must
 * never be able to put the player into a state the rest of the app has no
 * branch for.
 */
export const parseMusicPlaybackIntent = (raw: string): MusicPlaybackIntent => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return SAFE_UNREADABLE_INTENT;
    }
    const { state, trackId } = parsed as { state?: unknown; trackId?: unknown };
    if (!PLAYBACK_STATES.includes(state as MusicPlaybackIntent['state'])) {
      return SAFE_UNREADABLE_INTENT;
    }
    return {
      state: state as MusicPlaybackIntent['state'],
      trackId: typeof trackId === 'string' && trackId.length > 0 ? trackId : undefined,
    };
  } catch {
    return SAFE_UNREADABLE_INTENT;
  }
};

/** Serialises an intent for storage. */
export const serializeMusicPlaybackIntent = (intent: MusicPlaybackIntent): string =>
  JSON.stringify({ state: intent.state, trackId: intent.trackId });

/**
 * The player's stored intent, or `undefined` when they have never touched the
 * controls.
 *
 * 🔴 `undefined` means "no opinion" and is the whole reason this is not a plain
 * default: defaulting a never-touched player to `stopped` would silence the
 * game's music for everyone who never opened the player.
 */
export const readMusicPlaybackIntent = (): MusicPlaybackIntent | undefined => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(MUSIC_PLAYER_PLAYBACK_KEY);
  } catch {
    return SAFE_UNREADABLE_INTENT;
  }
  if (raw === null) {
    return undefined;
  }
  return parseMusicPlaybackIntent(raw);
};

/**
 * Writes the player's intent.
 *
 * 🔴 Best-effort by design: a private-mode or quota failure must not break
 * playback. The in-memory intent still governs the session, which is strictly
 * better than losing the choice or throwing mid-toggle.
 */
export const writeMusicPlaybackIntent = (intent: MusicPlaybackIntent): void => {
  try {
    localStorage.setItem(MUSIC_PLAYER_PLAYBACK_KEY, serializeMusicPlaybackIntent(intent));
  } catch {
    // Storage unavailable — the in-memory intent still governs this session.
  }
};

/**
 * Whether the player has switched music off, so no BGM may start.
 *
 * 🔴 This is the authority the SCENE-driven cue path must consult. Map entry,
 * combat and combat exit all call `playSceneBgm`, which is a different path
 * from the mini music player: it never went through `MusicPlayerService`, so a
 * player who pressed Stop still got the next map's cue. The player's decision
 * outranks the scene's, so a suppressed player is silent until they ask again.
 *
 * No record means no opinion, and the scene is left alone.
 */
export const isBgmSuppressedByPlayer = (): boolean => {
  const intent = readMusicPlaybackIntent();
  return intent !== undefined && intent.state !== 'playing';
};
