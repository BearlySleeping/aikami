// apps/frontend/client/src/lib/views/dev/voice/voice_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { KOKORO_VOICES, VOICE_ENGINES } from '$lib/services/config/config_service.svelte';
import { ttsService, type VoiceInfo } from '$services';

export type { VoiceInfo };

/** Supported audio output formats. */
export const OUTPUT_FORMATS = [
  { id: 'mp3', label: 'MP3' },
  { id: 'wav', label: 'WAV' },
  { id: 'flac', label: 'FLAC' },
  { id: 'opus', label: 'Opus' },
  { id: 'aac', label: 'AAC' },
  { id: 'pcm', label: 'PCM (raw)' },
] as const;

export type VoiceViewModelInterface = BaseViewModelInterface & {
  /** The script text to synthesize. */
  readonly text: string;
  /** Whether audio playback is currently active. */
  readonly isPlaying: boolean;
  /** Whether a voice synthesis/network request is in progress. */
  readonly isConnected: boolean;
  /** Synthesis progress percentage (0–100). Only meaningful during synthesis. */
  readonly synthesisProgress: number;
  /** Word-level playback progress (0–100), derived from currentWordIndex. */
  readonly playbackProgress: number;
  /** Available Kokoro voice presets (fetched from the voice server). */
  readonly voices: readonly VoiceInfo[];
  /** Fallback voice list if the server returns none. */
  readonly fallbackVoices: readonly VoiceInfo[];
  /** The currently selected voice ID. */
  readonly selectedVoice: string;
  /** Speech speed (0.25–4.0). */
  readonly speed: number;
  /** Output audio format. */
  readonly responseFormat: string;
  /** Whether to stream audio (lower latency, enables progress). */
  readonly streamEnabled: boolean;
  /** Available TTS engines. */
  readonly voiceEngines: ReadonlyArray<{ id: string; label: string }>;
  /** Currently selected engine. */
  readonly engine: string;
  /** Output volume multiplier (0.1–2.0). */
  readonly volumeMultiplier: number;
  /** POSTs text to the TTS endpoint and plays the returned audio. */
  generateAndPlay(): Promise<void>;
  /** Stops playback and aborts the in-progress synthesis request. */
  cancel(): void;
};

export type VoiceViewModelOptions = BaseViewModelOptions & {};

/** Default test phrase. */
const DEFAULT_TEXT =
  'Hello! This is a test of the Aikami voice synthesis pipeline. ' +
  'The quick brown fox jumps over the lazy dog.';

class VoiceViewModel
  extends BaseViewModel<VoiceViewModelOptions>
  implements VoiceViewModelInterface
{
  text = $state(DEFAULT_TEXT);
  speed = $state(1.0);
  engine = $state('kokoro');
  responseFormat = $state('mp3');
  streamEnabled = $state(false);
  volumeMultiplier = $state(1.0);
  synthesisProgress = $state(0);
  /** Tracks whether we're in the fetch/download phase (before playback starts). */
  isSynthesizing = $state(false);

  private _abortController: AbortController | undefined;

  /** Full word list derived from the current script text, used for word tracking. */
  private get _words(): string[] {
    return this.text.split(/\s+/).filter(Boolean);
  }

  /** Word-level playback progress (0–100), derived from TTS word tracking. */
  get playbackProgress(): number {
    if (!ttsService.isPlaying) {
      return 0;
    }
    const total = this._words.length;
    if (total === 0) {
      return 0;
    }
    return Math.min(100, Math.round(((ttsService.currentWordIndex + 1) / total) * 100));
  }

  get isPlaying(): boolean {
    return ttsService.isPlaying;
  }

  get isConnected(): boolean {
    return this.isSynthesizing || ttsService.isSynthesizing;
  }

  get voices(): readonly VoiceInfo[] {
    return ttsService.voices.length > 0 ? ttsService.voices : [];
  }

  get fallbackVoices(): readonly VoiceInfo[] {
    return KOKORO_VOICES.map((v) => ({ id: v.id, description: v.label }));
  }

  get selectedVoice(): string {
    return ttsService.selectedVoice;
  }

  set selectedVoice(value: string) {
    ttsService.selectedVoice = value;
  }

  get voiceEngines(): ReadonlyArray<{ id: string; label: string }> {
    return VOICE_ENGINES;
  }

  // ── Public API ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await super.initialize();
    void ttsService.loadVoices();
  }

  async generateAndPlay(): Promise<void> {
    const trimmed = this.text.trim();
    if (!trimmed) {
      return;
    }

    // Cancel any in-progress request
    this.cancel();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.synthesisProgress = 0;
    this.isSynthesizing = true;

    try {
      const useStream = this.streamEnabled && this.engine === 'kokoro';
      const response = await fetch('/api/voice/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: trimmed,
          model: 'tts-1',
          voice: this.selectedVoice,
          response_format: this.responseFormat,
          speed: this.speed,
          volume_multiplier: this.volumeMultiplier,
          stream: useStream,
          stream_format: useStream ? 'audio' : undefined,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.error('generateAndPlay:fetch-failed', {
          status: response.status,
          body: errorText.slice(0, 200),
        });
        return;
      }

      if (useStream) {
        await this._playStreamResponse(response, signal);
      } else {
        await this._playBatchResponse(response, signal);
      }
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('generateAndPlay:failed', error);
    } finally {
      this.isSynthesizing = false;
      this._abortController = undefined;
    }
  }

  cancel(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = undefined;
    }
    ttsService.stop();
    this.isSynthesizing = false;
    this.synthesisProgress = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Reads raw audio chunks from a chunked transfer-encoding response.
   * Each chunk is a self-contained audio segment (mp3 frame, wav segment, etc.)
   * that can be enqueued directly into the TTS pipeline for gapless playback.
   * Progress is tracked by chunk count vs estimated sentence count.
   */
  private async _playStreamResponse(response: Response, _signal: AbortSignal): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      this.error('_playStreamResponse: no body reader');
      return;
    }

    const contentLength = Number(response.headers.get('Content-Length') ?? 0);
    let chunkCount = 0;
    let totalReceived = 0;
    const allWords = this._words;
    const estimatedChunks = Math.max(1, this.text.split(/[.!?]\s+/).filter(Boolean).length);
    // Precompute per-chunk word slices for proportional word tracking
    const wordsPerChunk = Math.max(1, Math.ceil(allWords.length / estimatedChunks));

    ttsService.startStream({ messageId: `tts_${Date.now()}`, text: this.text });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (value && value.byteLength > 0) {
          // Slice words for this chunk to enable word-level progress tracking
          const startIdx = chunkCount * wordsPerChunk;
          const chunkWords = allWords.slice(startIdx, startIdx + wordsPerChunk);

          chunkCount++;
          totalReceived += value.byteLength;

          await ttsService.enqueueChunk({
            buffer: value.buffer as ArrayBuffer,
            words: chunkWords.length > 0 ? chunkWords : undefined,
          });

          // Progress: prefer Content-Length, fall back to chunk count estimate
          if (contentLength > 0) {
            this.synthesisProgress = Math.min(
              95,
              Math.round((totalReceived / contentLength) * 100),
            );
          } else {
            this.synthesisProgress = Math.min(95, Math.round((chunkCount / estimatedChunks) * 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    this.synthesisProgress = 100;
    ttsService.endStream();
  }

  /**
   * Fetches audio in a single request. Tracks download progress via
   * Content-Length + stream reader, then plays through the TTS pipeline.
   */
  private async _playBatchResponse(response: Response, signal: AbortSignal): Promise<void> {
    const contentLength = Number(response.headers.get('Content-Length') ?? 0);
    const reader = response.body?.getReader();

    if (!reader) {
      // Fallback: read as arrayBuffer (no progress tracking possible)
      const buffer = await response.arrayBuffer();
      if (signal.aborted) {
        return;
      }

      this.synthesisProgress = 100;
      ttsService.startStream({ messageId: `tts_${Date.now()}`, text: this.text });
      await ttsService.enqueueChunk({ buffer, words: this._words });
      ttsService.endStream();
      return;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (value) {
          chunks.push(value);
          received += value.byteLength;

          if (contentLength > 0) {
            this.synthesisProgress = Math.min(95, Math.round((received / contentLength) * 100));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    this.synthesisProgress = 100;

    // Combine chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    if (signal.aborted) {
      return;
    }

    ttsService.startStream({ messageId: `tts_${Date.now()}`, text: this.text });
    await ttsService.enqueueChunk({
      buffer: combined.buffer as ArrayBuffer,
      words: this._words,
    });
    ttsService.endStream();
  }
}

export const getVoiceViewModel = (options: VoiceViewModelOptions): VoiceViewModelInterface =>
  new VoiceViewModel(options);
