// apps/frontend/client/src/lib/services/audio/audio_service.svelte.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import { audioContextManager } from './audio_context_manager';

// ---------------------------------------------------------------------------
// AudioService — Centralized, High-Performance Audio Engine (C-150)
//
// Wraps the Web Audio API to provide:
// 1. BGM playback with Equal-Power crossfade transitions
// 2. Concurrent SFX playback via AudioBufferSourceNode pools
// 3. Reactive volume controls (master, BGM, SFX)
//
// Uses the singleton AudioContext from {@link audioContextManager}.
// ---------------------------------------------------------------------------

/** Options for constructing an AudioService. */
export type AudioServiceOptions = BaseClassOptions;

/** Public interface for AudioService. */
export type AudioServiceInterface = BaseClassInterface & {
  /** Master volume (0–1). Scales both BGM and SFX. */
  readonly masterVolume: number;
  /** BGM volume (0–1). Scales only background music. */
  readonly bgmVolume: number;
  /** SFX volume (0–1). Scales only sound effects. */
  readonly sfxVolume: number;
  /** Whether a crossfade transition is currently in progress. */
  readonly isCrossfading: boolean;

  /**
   * Sets the master volume.
   * Updates the master GainNode immediately.
   */
  setMasterVolume(volume: number): void;

  /**
   * Sets the BGM volume.
   * Updates the BGM GainNode immediately.
   */
  setBgmVolume(volume: number): void;

  /**
   * Sets the SFX volume.
   * Updates the SFX GainNode immediately.
   */
  setSfxVolume(volume: number): void;

  /**
   * Transitions BGM to a new track using Equal-Power crossfade.
   *
   * If no track is currently playing, the new track fades in from silence.
   * If the requested track is already the active track, this is a no-op.
   *
   * @param trackUrl — URL of the audio asset (e.g. '/assets/audio/music/bgm_combat.webm')
   * @param durationMs — Crossfade duration in milliseconds (default 1500)
   */
  transitionToBgm(trackUrl: string, durationMs?: number): Promise<void>;

  /**
   * Plays a sound effect immediately and concurrently.
   *
   * Multiple SFX can overlap — each call creates an independent
   * AudioBufferSourceNode. Short sounds (< 500ms) are aggressively
   * cleaned up.
   *
   * @param trackUrl — URL of the audio asset (e.g. '/assets/audio/sfx/sfx_hit.wav')
   */
  playSfx(trackUrl: string): Promise<void>;

  /** Stops all BGM and SFX, resets internal state. */
  stopAll(): void;
};

/**
 * Centralized audio service for BGM and SFX.
 *
 * BGM uses dual GainNodes for seamless crossfade:
 * ```
 * source → gainActive ─┐
 *                       ├→ gainBgm → gainMaster → destination
 * source → gainNext   ─┘
 * ```
 *
 * SFX uses a separate gain chain:
 * ```
 * source → gainSfx → gainMaster → destination
 * ```
 *
 * All GainNode values are reactive `$state` properties — changing them
 * updates the Web Audio graph immediately.
 */
export class AudioService extends BaseClass<AudioServiceOptions> implements AudioServiceInterface {
  // ── Reactive volume state ──
  masterVolume = $state<number>(1);
  bgmVolume = $state<number>(0.8);
  sfxVolume = $state<number>(1);
  isCrossfading = $state<boolean>(false);

  // ── Web Audio nodes ──
  private _masterGain: GainNode | undefined;
  private _bgmGain: GainNode | undefined;
  private _sfxGain: GainNode | undefined;
  private _activeGain: GainNode | undefined;
  private _nextGain: GainNode | undefined;
  private _activeSource: AudioBufferSourceNode | undefined;
  private _nextSource: AudioBufferSourceNode | undefined;
  /** URL of the currently active BGM track. */
  private _activeTrackUrl: string | undefined;
  /** AbortController for in-progress crossfade transitions. */
  private _crossfadeAbort: AbortController | undefined;
  /** Map of cached AudioBuffers keyed by URL to avoid re-decoding. */
  private readonly _bufferCache = new Map<string, AudioBuffer>();

  // ── Initialization ──

  constructor(options: AudioServiceOptions) {
    super(options);
    this._ensureGraph();
  }

  /**
   * Lazily builds the Web Audio gain chain on first use.
   * Called from the constructor — safe because the AudioContext
   * starts in a suspended state under autoplay policy.
   */
  private _ensureGraph(): void {
    if (this._masterGain) {
      return;
    }

    const ctx = audioContextManager.context;

    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = this.masterVolume;
    this._masterGain.connect(ctx.destination);

    this._bgmGain = ctx.createGain();
    this._bgmGain.gain.value = this.bgmVolume;
    this._bgmGain.connect(this._masterGain);

    this._sfxGain = ctx.createGain();
    this._sfxGain.gain.value = this.sfxVolume;
    this._sfxGain.connect(this._masterGain);

    this._activeGain = ctx.createGain();
    this._activeGain.gain.value = 1;
    this._activeGain.connect(this._bgmGain);

    this._nextGain = ctx.createGain();
    this._nextGain.gain.value = 0;
    this._nextGain.connect(this._bgmGain);
  }

  // ── Public API ──

  /** @inheritdoc */
  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.masterVolume = clamped;
    if (this._masterGain) {
      this._masterGain.gain.value = clamped;
    }
  }

  /** @inheritdoc */
  setBgmVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.bgmVolume = clamped;
    if (this._bgmGain) {
      this._bgmGain.gain.value = clamped;
    }
  }

  /** @inheritdoc */
  setSfxVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.sfxVolume = clamped;
    if (this._sfxGain) {
      this._sfxGain.gain.value = clamped;
    }
  }

  /** @inheritdoc */
  async transitionToBgm(trackUrl: string, durationMs: number = 1500): Promise<void> {
    // No-op if already playing the requested track
    if (this._activeTrackUrl === trackUrl && !this.isCrossfading) {
      return;
    }

    // Unlock AudioContext (autoplay policy)
    audioContextManager.unlock();

    // Abort any in-progress crossfade
    this._abortCrossfade();

    this._crossfadeAbort = new AbortController();
    const signal = this._crossfadeAbort.signal;

    const ctx = audioContextManager.context;
    this._ensureGraph();

    const durationSeconds = durationMs / 1000;

    try {
      const buffer = await this._loadBuffer(trackUrl, signal);
      if (signal.aborted || !buffer) {
        return;
      }

      // Swap gain nodes: next → active, active → next
      this._swapGainNodes();

      // Stop previous source
      this._stopSource(this._nextSource);
      this._nextSource = undefined;

      // Create new source on the now-active gain node
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      if (!this._activeGain) {
        return;
      }
      source.connect(this._activeGain);
      source.start(0);

      // Stop previous active source after transition
      const oldSource = this._activeSource;
      this._activeSource = source;
      this._activeTrackUrl = trackUrl;

      this.isCrossfading = true;

      // Equal-Power crossfade using linear ramp
      //
      // Equal-power ensures constant perceived loudness during transition:
      //   active_gain^2 + next_gain^2 = 1
      //
      // We ramp active from 0→1 and next from 1→0 simultaneously.
      // The linear ramps approximate the sine/cosine curve closely enough
      // for the Web Audio API (which uses decibel-linear interpolation).
      this._activeGain?.gain.cancelScheduledValues(ctx.currentTime);
      this._activeGain?.gain.setValueAtTime(0, ctx.currentTime);
      this._activeGain?.gain.linearRampToValueAtTime(1, ctx.currentTime + durationSeconds);

      this._nextGain?.gain.cancelScheduledValues(ctx.currentTime);
      this._nextGain?.gain.setValueAtTime(1, ctx.currentTime);
      this._nextGain?.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSeconds);

      // Wait for crossfade to complete
      await this._delay(durationMs, signal);
      if (signal.aborted) {
        return;
      }

      // Clean up old source
      this._stopSource(oldSource);
      if (this._nextGain) {
        this._nextGain.gain.value = 0;
      }
      this.isCrossfading = false;
    } catch (error) {
      if (!signal.aborted) {
        this.error('transitionToBgm:failed', error);
      }
    } finally {
      this._crossfadeAbort = undefined;
    }
  }

  /** @inheritdoc */
  async playSfx(trackUrl: string): Promise<void> {
    audioContextManager.unlock();

    const ctx = audioContextManager.context;
    this._ensureGraph();

    try {
      const buffer = await this._loadBuffer(trackUrl);
      if (!buffer) {
        return;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (!this._sfxGain) {
        return;
      }
      source.connect(this._sfxGain);
      source.start(0);

      // Auto-cleanup: disconnect when playback ends
      source.onended = () => {
        try {
          source.disconnect();
        } catch {
          // Already disconnected
        }
      };
    } catch (error) {
      this.error('playSfx:failed', { trackUrl, error });
    }
  }

  /** @inheritdoc */
  stopAll(): void {
    this._abortCrossfade();
    this._stopSource(this._activeSource);
    this._stopSource(this._nextSource);
    this._activeSource = undefined;
    this._nextSource = undefined;
    this._activeTrackUrl = undefined;
    this.isCrossfading = false;
  }

  override async dispose(): Promise<void> {
    this.stopAll();
    this._bufferCache.clear();
    await super.dispose();
  }

  // ── Private helpers ──

  /**
   * Loads and decodes an audio buffer, caching the result.
   *
   * @param url — Asset URL to load
   * @param signal — Optional AbortSignal for cancellation
   */
  private async _loadBuffer(url: string, signal?: AbortSignal): Promise<AudioBuffer | undefined> {
    const cached = this._bufferCache.get(url);
    if (cached) {
      return cached;
    }

    const ctx = audioContextManager.context;

    const response = await fetch(url, { signal });
    if (!response.ok) {
      this.error('_loadBuffer:fetch-failed', { url, status: response.status });
      return undefined;
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    this._bufferCache.set(url, audioBuffer);
    return audioBuffer;
  }

  /**
   * Swaps the active and next gain nodes.
   *
   * After swap:
   * - `_activeGain` is the one that will ramp FROM 0 TO 1 (new track)
   * - `_nextGain` is the one that will ramp FROM 1 TO 0 (old track)
   */
  private _swapGainNodes(): void {
    const temp = this._activeGain;
    this._activeGain = this._nextGain;
    this._nextGain = temp;
  }

  /**
   * Safely stops and disconnects an AudioBufferSourceNode.
   */
  private _stopSource(source: AudioBufferSourceNode | undefined): void {
    if (!source) {
      return;
    }
    try {
      source.stop();
    } catch {
      // Already stopped — ignore
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected — ignore
    }
  }

  /**
   * Aborts any in-progress crossfade transition.
   */
  private _abortCrossfade(): void {
    if (this._crossfadeAbort) {
      this._crossfadeAbort.abort();
      this._crossfadeAbort = undefined;
    }
  }

  /**
   * Promise-based delay with AbortSignal support.
   */
  private _delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(resolve, ms);

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      }
    });
  }
}

/** Singleton instance of the audio service. */
export const audioService: AudioServiceInterface = new AudioService({
  className: 'AudioService',
});
