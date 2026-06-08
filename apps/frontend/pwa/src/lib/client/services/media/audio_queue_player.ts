// apps/frontend/pwa/src/lib/client/services/media/audio_queue_player.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import { audioContextManager } from './audio_context_manager';

// ---------------------------------------------------------------------------
// AudioQueuePlayer — Sequential, gapless playback of audio chunks via Web Audio API
//
// Receives binary PCM/WAV ArrayBuffer chunks, decodes them into AudioBuffers,
// and schedules them for sequential playback using audioContext.currentTime
// to ensure no gaps or overlaps between chunks.
//
// The queue explicitly plays chunk N only after chunk N-1 has finished,
// even if decodeAudioData for chunk N completes early. This prevents
// out-of-order playback when decoding times vary.
// ---------------------------------------------------------------------------

export type AudioQueuePlayerOptions = BaseClassOptions;

export type AudioQueuePlayerInterface = BaseClassInterface & {
  /** Number of chunks currently buffered and waiting to play. */
  readonly queueSize: number;

  /** Whether audio is currently playing. */
  readonly isPlaying: boolean;

  /**
   * Enqueues a raw audio ArrayBuffer for gapless playback.
   *
   * Decodes the buffer and schedules it to start precisely when the
   * previous chunk finishes. If no chunk is playing, starts immediately.
   *
   * When `sentenceIndex` is provided, chunks are buffered internally and
   * played in ascending index order — out-of-order arrivals are held until
   * their turn.
   *
   * The returned promise resolves once the chunk has been decoded and
   * scheduled (NOT when it finishes playing).
   */
  enqueueChunk(options: { buffer: ArrayBuffer; sentenceIndex?: number }): Promise<void>;

  /**
   * Prepares the audio queue for a new streaming session.
   *
   * Resets the scheduling clock and internal state. Must be called
   * before the first {@link enqueueChunk}.
   */
  startStream(): void;

  /**
   * Signals that no more chunks will be enqueued.
   *
   * The queue will naturally drain; this mainly informs the player
   * that the stream is complete for state-tracking purposes.
   */
  endStream(): void;

  /**
   * Immediately stops all queued and playing audio, resets state.
   */
  stop(): void;
};

/**
 * Sequential audio queue player.
 *
 * Decodes and schedules AudioBuffer chunks one after another using the
 * Web Audio API. Uses {@link AudioContext.currentTime} for precise scheduling
 * to eliminate gaps between consecutive chunks.
 *
 * @example
 * ```typescript
 * const player = new AudioQueuePlayer({ className: 'DialogueAudio' });
 * player.startStream();
 * await player.enqueueChunk({ buffer: chunk1 });
 * await player.enqueueChunk({ buffer: chunk2 });
 * player.endStream();
 * ```
 */
export class AudioQueuePlayer
  extends BaseClass<AudioQueuePlayerOptions>
  implements AudioQueuePlayerInterface
{
  private _nextStartTime = 0;
  private _sourceNodes: AudioBufferSourceNode[] = [];
  private _isPlaying = false;
  private _pendingChunks = 0;
  /** Buffer for out-of-order chunks, keyed by sentenceIndex. */
  private _outOfOrderChunks = new Map<number, AudioBuffer>();
  /** Next expected sentence index for sequential playback. */
  private _nextExpectedIndex = 0;

  get queueSize(): number {
    return this._pendingChunks;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  // -- Public API ----------------------------------------------------------

  startStream(): void {
    this.stop();

    audioContextManager.unlock();
    this._nextStartTime = audioContextManager.context.currentTime;
    this._isPlaying = true;
    this._pendingChunks = 0;
    this._outOfOrderChunks.clear();
    this._nextExpectedIndex = 0;
  }

  async enqueueChunk(options: { buffer: ArrayBuffer; sentenceIndex?: number }): Promise<void> {
    const { buffer, sentenceIndex } = options;

    this.debug('enqueueChunk', { byteLength: buffer.byteLength, sentenceIndex });

    const ctx = audioContextManager.context;

    let audioBuffer: AudioBuffer;
    try {
      // slice(0) creates a detached copy for decodeAudioData in case the
      // original buffer gets transferred elsewhere
      audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    } catch (error) {
      this.error('decodeAudioData failed', error);
      return;
    }

    // Out-of-order handling: if sentenceIndex is provided and doesn't match
    // the expected next index, store the buffer for later playback.
    if (sentenceIndex !== undefined) {
      if (sentenceIndex > this._nextExpectedIndex) {
        // Arrived too early — buffer it
        this._outOfOrderChunks.set(sentenceIndex, audioBuffer);
        return;
      }
      // This chunk is the expected next one — schedule it now
      this._scheduleAudioBuffer(audioBuffer, ctx);
      this._nextExpectedIndex++;
      // Drain any buffered chunks that are now in order
      this._drainOutOfOrderChunks(ctx);
    } else {
      // No index — schedule immediately (backwards-compatible path)
      this._scheduleAudioBuffer(audioBuffer, ctx);
    }
  }

  /**
   * Schedules an already-decoded AudioBuffer for gapless playback.
   */
  private _scheduleAudioBuffer(audioBuffer: AudioBuffer, ctx: AudioContext): void {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const scheduleTime = Math.max(ctx.currentTime, this._nextStartTime);
    source.start(scheduleTime);

    this._sourceNodes.push(source);

    source.onended = () => {
      const idx = this._sourceNodes.indexOf(source);
      if (idx !== -1) {
        this._sourceNodes.splice(idx, 1);
      }
      this._pendingChunks--;
      if (this._sourceNodes.length === 0 && this._pendingChunks <= 0) {
        this._isPlaying = false;
        this._pendingChunks = 0;
      }
    };

    this._nextStartTime = scheduleTime + audioBuffer.duration;
    this._pendingChunks++;
  }

  /**
   * Drains buffered out-of-order chunks that are now next in line.
   */
  private _drainOutOfOrderChunks(ctx: AudioContext): void {
    for (;;) {
      const chunk = this._outOfOrderChunks.get(this._nextExpectedIndex);
      if (!chunk) {
        break;
      }
      this._outOfOrderChunks.delete(this._nextExpectedIndex);
      this._scheduleAudioBuffer(chunk, ctx);
      this._nextExpectedIndex++;
    }
  }

  endStream(): void {
    // The stream is just a signal that no more chunks arrive.
    // Playback naturally finishes when the last scheduled source ends.
  }

  stop(): void {
    // Stop all active and scheduled source nodes
    for (const node of this._sourceNodes) {
      try {
        node.stop();
      } catch {
        // Already stopped — ignore (browsers throw if stop called twice)
      }
    }

    this._sourceNodes = [];
    this._isPlaying = false;
    this._pendingChunks = 0;
    this._nextStartTime = 0;
    this._outOfOrderChunks.clear();
    this._nextExpectedIndex = 0;
  }

  override async dispose(): Promise<void> {
    this.stop();
    await super.dispose();
  }
}

export const getAudioQueuePlayer = (options: AudioQueuePlayerOptions): AudioQueuePlayerInterface =>
  new AudioQueuePlayer(options);
