// apps/frontend/client/src/lib/services/audio/kokoro_stream_worker.ts

/// <reference lib="webworker" />

/**
 * Dedicated Web Worker for real-time Kokoro TTS streaming.
 *
 * Fetches chunked HTTP responses from the Kokoro FastAPI microservice
 * (Docker container on port 8880) and writes decoded PCM samples into
 * a lock-free SPSC `SharedArrayBuffer` ring buffer consumed by the
 * `AudioWorkletProcessor`.
 *
 * Message protocol:
 *   Main → Worker: { action: 'initialize', sharedBuffer: SharedArrayBuffer, sampleCapacity: number }
 *   Worker → Main: { type: 'ready' }
 *   Main → Worker: { action: 'synthesize', text: string, voice: string }
 *   Worker → Main: { type: 'progress', samplesWritten: number }
 *   Worker → Main: { type: 'complete', totalSamples: number, sampleRate: number }
 *   Worker → Main: { type: 'error', message: string }
 *   Main → Worker: { action: 'abort' }
 *
 * Contract: C-211
 */

import { ringBufferPush, type WaitFreeRingBuffer } from './wait_free_ring_buffer';

// ── Ring buffer reference ────────────────────────────────────────────────

const HEADER_FLOATS = 2;
const HEADER_BYTES = HEADER_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const reconstructRing = (
  sharedBuffer: SharedArrayBuffer,
  sampleCapacity: number,
): WaitFreeRingBuffer => {
  const indices = new Float32Array(sharedBuffer, 0, HEADER_FLOATS);
  const storage = new Float32Array(sharedBuffer, HEADER_BYTES, sampleCapacity);
  return { sampleCapacity, sharedBuffer, indices, storage };
};

// ── Worker-scoped state ──────────────────────────────────────────────────

let ring: WaitFreeRingBuffer | null = null;
let abortController: AbortController | null = null;

// ── Message types ────────────────────────────────────────────────────────

type InitializeMessage = {
  action: 'initialize';
  sharedBuffer: SharedArrayBuffer;
  sampleCapacity: number;
};

type SynthesizeMessage = {
  action: 'synthesize';
  text: string;
  voice: string;
};

type AbortMessage = {
  action: 'abort';
};

type WorkerMessage = InitializeMessage | SynthesizeMessage | AbortMessage;

// ── WAV header parsing ───────────────────────────────────────────────────

type WavHeader = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSize: number;
};

/**
 * Parses a minimal WAV header from the first 44 bytes.
 * Returns the header fields needed for PCM extraction.
 */
const parseWavHeader = (buffer: ArrayBufferLike): WavHeader | null => {
  if (buffer.byteLength < 44) {
    return null;
  }

  const view = new DataView(buffer);

  // RIFF header check
  if (view.getUint32(0, false) !== 0x52494646) {
    return null; // Not "RIFF"
  }
  if (view.getUint32(8, false) !== 0x57415645) {
    return null; // Not "WAVE"
  }

  // fmt  sub-chunk
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Find "data" sub-chunk (may not be at offset 36 if there are extra chunks)
  let dataSize = 0;

  for (let offset = 12; offset < buffer.byteLength - 8; ) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 0x64617461) {
      // "data"
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataSize === 0) {
    return null;
  }

  return { sampleRate, channels, bitsPerSample, dataSize };
};

/**
 * Converts Int16 PCM samples to Float32 in the range [-1, 1].
 *
 * Kokoro outputs 16-bit mono PCM at 24 kHz. This converts each sample
 * from Int16 to Float32 by dividing by 32768.
 */
const convertInt16ToFloat32 = (int16Data: Int16Array): Float32Array => {
  const out = new Float32Array(int16Data.length);
  for (let i = 0; i < int16Data.length; i++) {
    out[i] = int16Data[i] / 32768;
  }
  return out;
};

// ── Handlers ─────────────────────────────────────────────────────────────

const handleInitialize = (options: {
  sharedBuffer: SharedArrayBuffer;
  sampleCapacity: number;
}): void => {
  const { sharedBuffer, sampleCapacity } = options;

  ring = reconstructRing(sharedBuffer, sampleCapacity);

  self.postMessage({ type: 'ready' });
};

const handleSynthesize = async (options: { text: string; voice: string }): Promise<void> => {
  const { text, voice } = options;

  if (!ring) {
    self.postMessage({
      type: 'error',
      message: 'Ring buffer not initialized. Call initialize first.',
    });
    return;
  }

  if (!text.trim()) {
    self.postMessage({
      type: 'error',
      message: 'Empty text — nothing to synthesize.',
    });
    return;
  }

  abortController = new AbortController();
  const { signal } = abortController;

  try {
    const response = await fetch('http://localhost:8880/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        // biome-ignore lint/style/useNamingConvention: voice API uses snake_case
        response_format: 'wav',
      }),
      signal,
    });

    if (!response.ok) {
      self.postMessage({
        type: 'error',
        message: `Kokoro server returned ${response.status}: ${response.statusText}`,
      });
      return;
    }

    if (!response.body) {
      self.postMessage({
        type: 'error',
        message: 'Response body is null — streaming not supported.',
      });
      return;
    }

    const reader = response.body.getReader();
    let headerParsed = false;
    let header: WavHeader | null = null;
    let totalSamplesWritten = 0;
    let pendingBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (signal.aborted) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      // Prepend any previously buffered partial data
      let chunk: Uint8Array;
      if (pendingBuffer.byteLength > 0) {
        const merged = new Uint8Array(pendingBuffer.byteLength + value.byteLength);
        merged.set(pendingBuffer, 0);
        merged.set(value, pendingBuffer.byteLength);
        chunk = merged;
        pendingBuffer = new Uint8Array(0);
      } else {
        chunk = value;
      }

      // Parse WAV header from first chunk
      if (!headerParsed) {
        if (chunk.byteLength >= 44) {
          header = parseWavHeader(
            chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
          );
          if (!header) {
            self.postMessage({
              type: 'error',
              message: 'Failed to parse WAV header from Kokoro response.',
            });
            return;
          }

          headerParsed = true;

          // Report sample rate so the main thread can configure the AudioContext
          self.postMessage({
            type: 'header',
            sampleRate: header.sampleRate,
            channels: header.channels,
            bitsPerSample: header.bitsPerSample,
          });

          // Extract PCM data after the header
          const pcmOffset = 44; // Simple case — data starts right after header
          if (chunk.byteLength > pcmOffset) {
            const pcmBytes = chunk.subarray(pcmOffset);
            const samplesWritten = writePcmChunk(pcmBytes);
            totalSamplesWritten += samplesWritten;
          }
        } else {
          // Not enough data for header — buffer and wait for next chunk
          pendingBuffer = chunk;
          continue;
        }
      } else {
        // Subsequent chunks are pure PCM data
        const samplesWritten = writePcmChunk(chunk);
        totalSamplesWritten += samplesWritten;
      }

      // Report progress periodically
      if (totalSamplesWritten > 0) {
        self.postMessage({
          type: 'progress',
          samplesWritten: totalSamplesWritten,
        });
      }
    }

    if (signal.aborted) {
      self.postMessage({ type: 'aborted' });
      return;
    }

    self.postMessage({
      type: 'complete',
      totalSamples: totalSamplesWritten,
      sampleRate: header?.sampleRate ?? 24000,
    });
  } catch (error: unknown) {
    if ((error as Error).name === 'AbortError') {
      self.postMessage({ type: 'aborted' });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown synthesis error';
    self.postMessage({ type: 'error', message });
  } finally {
    abortController = null;
  }
};

/**
 * Converts raw Int16 PCM bytes to Float32 and pushes into the ring buffer.
 * Handles odd-length buffers by discarding the final byte.
 *
 * @returns Number of Float32 samples written to the ring buffer.
 */
const writePcmChunk = (pcmBytes: Uint8Array): number => {
  if (!ring) {
    return 0;
  }

  // Align to 2-byte boundaries (Int16)
  const alignedLength = pcmBytes.byteLength - (pcmBytes.byteLength % 2);
  if (alignedLength === 0) {
    return 0;
  }

  const int16Data = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, alignedLength / 2);
  const floatData = convertInt16ToFloat32(int16Data);

  return ringBufferPush(ring, floatData);
};

const handleAbort = (): void => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

// ── Message router ───────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { data } = event;

  switch (data.action) {
    case 'initialize':
      handleInitialize({
        sharedBuffer: data.sharedBuffer,
        sampleCapacity: data.sampleCapacity,
      });
      break;

    case 'synthesize':
      handleSynthesize({ text: data.text, voice: data.voice });
      break;

    case 'abort':
      handleAbort();
      break;

    default:
      break;
  }
};
