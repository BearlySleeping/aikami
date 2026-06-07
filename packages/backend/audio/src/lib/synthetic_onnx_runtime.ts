// packages/backend/audio/src/lib/synthetic_onnx_runtime.ts

/**
 * Configuration options for the SyntheticOnnxRuntime.
 *
 * These mirror what a real ONNX inference session would accept but are
 * simplified to control the mock output shape.
 */
export type OnnxRuntimeOptions = {
  /** Audio sample rate in Hz (default: 24000 for Kokoro-82M). */
  defaultSampleRate?: number;
  /** Duration of generated silence in seconds (default: 0.1). */
  defaultDurationSeconds?: number;
};

/**
 * Options passed to each `generate()` call.
 */
export type OnnxGenerateOptions = {
  /** The text sentence to synthesize (ignored by the mock). */
  text: string;
};

/**
 * Result returned by a single ONNX inference call.
 */
export type OnnxInferenceResult = {
  /** PCM audio samples as 32-bit floats in range [-1, 1]. */
  audio: Float32Array;
  /** Sample rate of the audio data. */
  sampleRate: number;
  /** Duration of the audio in seconds. */
  durationSeconds: number;
};

/** Default: 24kHz matches Kokoro-82M expected input/output. */
const DEFAULT_SAMPLE_RATE = 24000;

/** Default: 0.1 seconds — enough to validate streaming without bulk. */
const DEFAULT_DURATION_SECONDS = 0.1;

/**
 * Synthetic ONNX Runtime Mock — returns a static Float32Array of silence
 * without loading a real ONNX model.
 *
 * Used during testing and development to validate the full TTS pipeline
 * (chunker → worker → WebSocket) before integrating the real Kokoro-82M
 * ONNX graph. Every `generate()` call returns a zero-filled buffer of
 * configurable duration and sample rate.
 *
 * @example
 * ```typescript
 * const runtime = new SyntheticOnnxRuntime();
 * const { audio, sampleRate } = await runtime.generate({ text: 'Hello.' });
 * // audio: Float32Array of 2400 zeros (0.1s @ 24kHz)
 * ```
 */
export class SyntheticOnnxRuntime {
  private readonly _sampleRate: number;
  private readonly _durationSeconds: number;

  constructor(options: OnnxRuntimeOptions = {}) {
    this._sampleRate = options.defaultSampleRate ?? DEFAULT_SAMPLE_RATE;
    this._durationSeconds = options.defaultDurationSeconds ?? DEFAULT_DURATION_SECONDS;
  }

  /**
   * Generate synthetic audio for the given text.
   *
   * Always returns a zero-filled Float32Array — pure silence. The text
   * parameter is accepted but ignored; it exists to match the real ONNX
   * interface signature.
   *
   * @param options — Contains the text to "synthesize".
   * @returns A result with silent PCM audio, sample rate, and duration.
   */
  async generate(_options: OnnxGenerateOptions): Promise<OnnxInferenceResult> {
    const sampleCount = Math.round(this._sampleRate * this._durationSeconds);
    const audio = new Float32Array(sampleCount);

    return {
      audio,
      sampleRate: this._sampleRate,
      durationSeconds: this._durationSeconds,
    };
  }
}
