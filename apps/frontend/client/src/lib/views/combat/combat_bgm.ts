// apps/frontend/client/src/lib/views/combat/combat_bgm.ts
//
// Mood-driven BGM crossfade for the combat surface (C-151, C-385 AC-3).
//
// Extracted from `combat_view_model.svelte.ts` (which is on the source-file-size
// guard's grandfathered baseline) so the ViewModel keeps only delegation.
// Behaviour is unchanged: fire-and-forget, errors logged and degraded to the
// scene-based resolver, never propagated to the UI.
//
// Contract: C-151 AI Dynamic Music, C-385 AC-3

/**
 * The audio capabilities the director uses.
 *
 * Declared as the surface it actually needs (a `Pick` of the ViewModel's audio
 * capability type would couple this module to the whole combat capability
 * contract).
 */
export type CombatBgmAudio = {
  getTracksByMood(mood: string): Promise<readonly { title: string }[]>;
  resolveAudioTrackUrl(track: { title: string }): Promise<string>;
  transitionToBgm(url: string, ms?: number): Promise<void>;
  playSceneBgm(scene: 'explore' | 'combat', ms?: number): Promise<void>;
};

export type CombatBgmDirectorDeps = {
  audio: CombatBgmAudio;
  debug(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: unknown): void;
};

/**
 * Resolves and crossfades BGM for a scene mood, falling back to the
 * scene-based resolver. Stateless — the ViewModel owns the audio service.
 */
export class CombatBgmDirector {
  private readonly _deps: CombatBgmDirectorDeps;

  constructor(deps: CombatBgmDirectorDeps) {
    this._deps = deps;
  }

  // -----------------------------------------------------------------------
  // Private — AI Director: mood-driven BGM crossfade (C-151)
  // -----------------------------------------------------------------------

  /**
   * Resolves audio tracks matching a scene mood from the static catalog
   * and triggers an equal-power BGM crossfade via {@link audioService}.
   *
   * The catalog is a synchronous in-memory map read after first load
   * (C-385 AC-3) — no per-combat network request. Picks a random track
   * from matching results for variety. Unknown moods degrade to a
   * documented fallback track inside the catalog resolver; a failed
   * transition falls back to scene-based BGM resolution.
   *
   * Fire-and-forget — errors are logged but never propagated to the UI.
   *
   * @param mood - Musical mood tag (e.g. 'epic', 'tense', 'triumph').
   *
   * Contract: C-151 AI Dynamic Music, C-385 AC-3
   */
  async transitionByMood(mood: string): Promise<void> {
    try {
      const tracks = await this._deps.audio.getTracksByMood(mood);
      const selected = tracks[Math.floor(Math.random() * tracks.length)];
      if (!selected) {
        return;
      }

      const url = await this._deps.audio.resolveAudioTrackUrl(selected);

      this._deps.debug('_transitionBgmByMood: crossfading', {
        mood,
        track: selected.title,
        url,
        availableTracks: tracks.length,
      });

      await this._deps.audio.transitionToBgm(url, 2000);
    } catch (error) {
      // Catalog or playback failure — fall back to scene-based resolution
      this._deps.debug('_transitionBgmByMood: transition failed, using scene fallback', {
        mood,
        error: (error as Error).message,
      });
      await this.transitionFallback(mood);
    }
  }

  /**
   * Fallback BGM resolution for when the audio catalog transition fails
   * or the requested mood cannot be resolved.
   *
   * Resolves through the manifest-backed audio resolver (C-372) instead
   * of legacy /assets/audio/* URLs. Routes through playSceneBgm's recency
   * guard to serialize transitions.
   *
   * @param mood - Musical mood tag.
   */
  async transitionFallback(mood: string): Promise<void> {
    const combatMoods = new Set(['epic', 'heroic', 'tense', 'foreboding']);
    const normalizedMood = mood.toLowerCase();
    const scene = combatMoods.has(normalizedMood) ? 'combat' : 'explore';

    this._deps.debug('_transitionBgmFallback', { mood, normalizedMood, scene });

    try {
      await this._deps.audio.playSceneBgm(scene, 2000);
    } catch (error) {
      this._deps.warn('_transitionBgmFallback: transition failed', error);
    }
  }
}
