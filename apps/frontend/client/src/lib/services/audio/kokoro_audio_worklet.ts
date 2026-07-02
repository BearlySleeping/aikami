// apps/frontend/client/src/lib/services/audio/kokoro_audio_worklet.ts

/**
 * AudioWorkletProcessor for gapless real-time Kokoro TTS playback.
 *
 * Runs on the browser's hardware audio thread. Reads PCM samples from a
 * lock-free SPSC `SharedArrayBuffer` ring buffer (produced by the
 * `kokoro_stream_worker.ts` Web Worker) and outputs them to the
 * AudioWorkletNode's output channel. Outputs silence when the ring
 * buffer underruns (network jitter / buffering).
 *
 * Message protocol (via port):
 *   Main → Worklet: { type: 'init', sharedBuffer: SharedArrayBuffer, sampleCapacity: number }
 *
 * Contract: C-211
 */

// ── Ring buffer layout (must match wait_free_ring_buffer.ts) ─────────────

const WORKLET_HEADER_FLOATS = 2;
const WORKLET_HEADER_BYTES = WORKLET_HEADER_FLOATS * Float32Array.BYTES_PER_ELEMENT;

type WorkletRingRefs = {
  readonly indices: Float32Array;
  readonly storage: Float32Array;
  readonly sampleCapacity: number;
};

const workletLoadUint32AtIndex = (indices: Float32Array, index: number): number => {
  const ui32 = new Uint32Array(indices.buffer, indices.byteOffset, WORKLET_HEADER_FLOATS);
  return Atomics.load(ui32, index);
};

const workletStoreUint32AtIndex = (indices: Float32Array, index: number, value: number): void => {
  const ui32 = new Uint32Array(indices.buffer, indices.byteOffset, WORKLET_HEADER_FLOATS);
  Atomics.store(ui32, index, value);
};

const workletRingAvailable = (ring: WorkletRingRefs): number => {
  return workletLoadUint32AtIndex(ring.indices, 0) - workletLoadUint32AtIndex(ring.indices, 1);
};

const workletRingPop = (ring: WorkletRingRefs, out: Float32Array): number => {
  const available = workletRingAvailable(ring);
  if (available === 0) {
    return 0;
  }

  const readCount = Math.min(available, out.length);
  const readIdx = workletLoadUint32AtIndex(ring.indices, 1) % ring.sampleCapacity;
  const cap = ring.sampleCapacity;

  const firstChunk = Math.min(readCount, cap - readIdx);
  out.set(ring.storage.subarray(readIdx, readIdx + firstChunk), 0);

  if (readCount > firstChunk) {
    const remaining = readCount - firstChunk;
    out.set(ring.storage.subarray(0, remaining), firstChunk);
  }

  workletStoreUint32AtIndex(ring.indices, 1, workletLoadUint32AtIndex(ring.indices, 1) + readCount);
  return readCount;
};

// ── Worklet globals type stubs ───────────────────────────────────────────

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

// ── Processor ────────────────────────────────────────────────────────────

/**
 * Kokoro TTS streaming audio processor.
 *
 * Reads PCM data from the shared ring buffer on every render quantum
 * (128 frames at typical 48 kHz = ~2.67 ms). When the buffer is empty,
 * outputs zeros (silence) rather than glitching.
 */
class KokoroAudioProcessor extends AudioWorkletProcessor {
  private _ring: WorkletRingRefs | null = null;

  constructor() {
    super();

    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        sharedBuffer?: SharedArrayBuffer;
        sampleCapacity?: number;
      };

      if (data.type === 'init' && data.sharedBuffer && data.sampleCapacity) {
        const indices = new Float32Array(data.sharedBuffer, 0, WORKLET_HEADER_FLOATS);
        const storage = new Float32Array(
          data.sharedBuffer,
          WORKLET_HEADER_BYTES,
          data.sampleCapacity,
        );

        this._ring = { indices, storage, sampleCapacity: data.sampleCapacity };
      }
    };
  }

  /**
   * Audio rendering callback — called by the hardware audio thread.
   *
   * MUST be non-blocking and fast. Never allocates memory or calls
   * blocking APIs. Returns `true` to keep the processor alive.
   *
   * @param _inputs  — Unused (this processor generates audio, doesn't process input).
   * @param outputs  — Output buffers: outputs[0][0] = left/mono channel.
   */
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const channel = output[0];
    if (!channel) {
      return true;
    }

    const ring = this._ring;
    if (!ring) {
      // No ring buffer yet — output silence
      channel.fill(0);
      return true;
    }

    const samplesNeeded = channel.length;
    const read = workletRingPop(ring, channel);

    if (read < samplesNeeded) {
      // Partial read or underrun — fill remainder with silence
      channel.fill(0, read);
    }

    return true;
  }
}

registerProcessor('kokoro-audio-processor', KokoroAudioProcessor);
