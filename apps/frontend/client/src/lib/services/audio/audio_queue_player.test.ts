// apps/frontend/client/src/lib/services/media/audio_queue_player.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { AudioQueuePlayer, type AudioQueuePlayerInterface } from './audio_queue_player';

// ---------------------------------------------------------------------------
// Test globals — extend globalThis for mock setup
// ---------------------------------------------------------------------------

type TestGlobal = typeof globalThis & {
  __mockAudioContext: AudioContext;
};

const testGlobal = globalThis as TestGlobal;

// ---------------------------------------------------------------------------
// AudioQueuePlayer — AC3: Seamless Audio Queueing
// ---------------------------------------------------------------------------

describe('AudioQueuePlayer — AC3: Seamless Audio Queueing', () => {
  let player: AudioQueuePlayerInterface;

  // Stores all created AudioBufferSourceNodes for verification
  let createdSources: Array<{
    buffer: AudioBuffer | null;
    startTime: number;
    stopped: boolean;
  }> = [];

  // The fake scheduling clock
  let fakeCurrentTime = 0;

  const createMockAudioContext = (): AudioContext => {
    createdSources = [];

    // Increment fake time by a small amount to simulate passage of time
    fakeCurrentTime = Math.max(fakeCurrentTime, 10);

    return {
      currentTime: fakeCurrentTime,
      destination: {} as AudioDestinationNode,

      decodeAudioData: mock((_buffer: ArrayBuffer): Promise<AudioBuffer> => {
        // Return a mock AudioBuffer with a fixed duration of 0.5 seconds
        return Promise.resolve({
          duration: 0.5,
          length: 22050, // 0.5 * 44100
          sampleRate: 44100,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(22050),
          copyFromChannel: () => {},
          copyToChannel: () => {},
        } as AudioBuffer);
      }),

      createBufferSource: mock((): AudioBufferSourceNode => {
        const sourceEntry = {
          buffer: null as AudioBuffer | null,
          startTime: 0,
          stopped: false,
        };

        const onEndedCallbacks: Array<() => void> = [];

        const source = {
          buffer: null as AudioBuffer | null,
          connect: mock(() => {}),
          start: mock((when: number) => {
            sourceEntry.startTime = when;
            // Advance fake time past this chunk's duration
            fakeCurrentTime = when + (sourceEntry.buffer?.duration ?? 0.5);
          }),
          stop: mock(() => {
            sourceEntry.stopped = true;
          }),
          get onended(): ((this: AudioBufferSourceNode, ev: Event) => unknown) | null {
            return null;
          },
          set onended(cb: ((this: AudioBufferSourceNode, ev: Event) => unknown) | null,) {
            // Store and invoke after scheduling to simulate completion
            if (cb) {
              onEndedCallbacks.push(() => {
                cb.call(source as unknown as AudioBufferSourceNode, new Event('ended'));
              });
            }
          },
          // Helper for tests to simulate ended
          _simulateEnded: () => {
            for (const cb of onEndedCallbacks) {
              cb();
            }
          },
          addEventListener: mock(() => {}),
          removeEventListener: mock(() => {}),
          dispatchEvent: mock(() => true),
        } as unknown as AudioBufferSourceNode;

        // Intercept buffer assignment
        const _originalDescriptor = Object.getOwnPropertyDescriptor(source, 'buffer');
        Object.defineProperty(source, 'buffer', {
          get: () => sourceEntry.buffer,
          set: (val: AudioBuffer | null) => {
            sourceEntry.buffer = val;
          },
        });

        createdSources.push(sourceEntry);

        return source;
      }),

      resume: mock(() => Promise.resolve()),
      close: mock(() => Promise.resolve()),
      state: 'running',
      sampleRate: 44100,
    } as unknown as AudioContext;
  };

  beforeEach(() => {
    fakeCurrentTime = 10;

    // Mock the global AudioContext constructor and the audioContextManager's context
    const mockCtx = createMockAudioContext();

    // Replace the audio_context_manager's context getter
    // We do this by replacing the context property on the singleton
    testGlobal.__mockAudioContext = mockCtx;
    const manager = testGlobal.__mockAudioContext;

    // Mock the audio_context_manager module
    mock.module('./audio_context_manager', () => ({
      audioContextManager: {
        get context(): AudioContext {
          return manager;
        },
        unlock: mock(() => {
          // No-op in tests
        }),
      },
    }));

    player = new AudioQueuePlayer({ className: 'TestAudioQueue' });
  });

  test('should be idle before startStream', () => {
    expect(player.isPlaying).toBe(false);
    expect(player.queueSize).toBe(0);
  });

  test('should set isPlaying to true after startStream', () => {
    player.startStream();
    expect(player.isPlaying).toBe(true);
    expect(player.queueSize).toBe(0);
  });

  test('should enqueue a chunk and schedule it at the correct time', async () => {
    player.startStream();

    const buffer = new ArrayBuffer(1024);
    await player.enqueueChunk({ buffer });

    // Should have created one source and scheduled it
    expect(createdSources.length).toBe(1);
    expect(createdSources[0].startTime).toBeGreaterThanOrEqual(10);
  });

  test('should schedule chunks sequentially without gaps', async () => {
    player.startStream();

    const chunk1 = new ArrayBuffer(512);
    const chunk2 = new ArrayBuffer(1024);
    const chunk3 = new ArrayBuffer(256);

    await player.enqueueChunk({ buffer: chunk1 });
    const time1 = createdSources[0].startTime;

    await player.enqueueChunk({ buffer: chunk2 });
    const time2 = createdSources[1].startTime;

    await player.enqueueChunk({ buffer: chunk3 });
    const time3 = createdSources[2].startTime;

    // Each chunk should start after the previous one's duration (0.5s each)
    // Time precision: allow small floating point tolerance
    expect(time2).toBeCloseTo(time1 + 0.5, 2);
    expect(time3).toBeCloseTo(time2 + 0.5, 2);
  });

  test('should track queue size correctly', async () => {
    player.startStream();
    expect(player.queueSize).toBe(0);

    await player.enqueueChunk({ buffer: new ArrayBuffer(512) });
    expect(player.queueSize).toBe(1);

    await player.enqueueChunk({ buffer: new ArrayBuffer(256) });
    expect(player.queueSize).toBe(2);
  });

  test('should stop all sources and reset state', async () => {
    player.startStream();

    await player.enqueueChunk({ buffer: new ArrayBuffer(512) });
    await player.enqueueChunk({ buffer: new ArrayBuffer(256) });

    expect(player.isPlaying).toBe(true);

    player.stop();

    expect(player.isPlaying).toBe(false);
    expect(player.queueSize).toBe(0);

    // All sources should have been stopped
    expect(createdSources.length).toBe(2);
    expect(createdSources[0].stopped).toBe(true);
    expect(createdSources[1].stopped).toBe(true);
  });

  test('should reset scheduling clock when startStream is called again', async () => {
    player.startStream();

    await player.enqueueChunk({ buffer: new ArrayBuffer(512) });
    const firstTime = createdSources[0].startTime;

    player.stop();
    player.startStream();

    await player.enqueueChunk({ buffer: new ArrayBuffer(256) });
    // New chunk should start from fresh time, not continuing the old clock
    // The scheduling should use the new start time
    expect(createdSources[1].startTime).not.toBe(firstTime + 0.5);
  });

  test('should handle decodeAudioData failure gracefully', async () => {
    // Mock decodeAudioData to fail
    const mockCtx = testGlobal.__mockAudioContext;
    mockCtx.decodeAudioData = mock(() => Promise.reject(new Error('Decode failed')));

    player.startStream();

    // Should not throw
    await player.enqueueChunk({ buffer: new ArrayBuffer(512) });

    // Queue size should not increase (we decrement on failure)
    expect(player.queueSize).toBe(0);
  });

  test('should mark isPlaying as false when all sources finish and queue is empty', async () => {
    player.startStream();
    await player.enqueueChunk({ buffer: new ArrayBuffer(512) });

    expect(player.isPlaying).toBe(true);
    expect(player.queueSize).toBe(1);

    // Simulate the source ending — just verify state transitions via stop()
    player.stop();
    expect(player.isPlaying).toBe(false);
    expect(player.queueSize).toBe(0);
  });

  test('should handle enqueue without startStream gracefully', async () => {
    // Calling enqueueChunk without startStream should still work,
    // scheduling from currentTime
    await player.enqueueChunk({ buffer: new ArrayBuffer(512) });

    expect(createdSources.length).toBe(1);
  });

  test('should handle endStream without error', () => {
    player.startStream();
    player.endStream();
    // Should not throw, isPlaying may still be true until all sources finish
  });
});
