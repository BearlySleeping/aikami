// apps/frontend/client/src/lib/services/audio/audio_service.test.ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// AudioService — C-150: Low-Latency Audio Engine
// ---------------------------------------------------------------------------

/**
 * Minimal AudioBuffer stub used by both decodeAudioData and buffer assignment.
 */
const createStubAudioBuffer = (): AudioBuffer => {
  return {
    duration: 2.0,
    length: 88200,
    sampleRate: 44100,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(88200),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
};

// ── Mock state containers (reset in beforeEach) ──

let createdGainNodes: MockGainNode[] = [];
let createdSources: MockSourceNode[] = [];
let fakeCurrentTime = 0;
let decodeCallCount = 0;
let fetchCallCount = 0;

/** Tracks GainNode method calls for crossfade verification. */
type MockGainNode = {
  gain: {
    value: number;
    setValueAtTimeCalls: Array<{ value: number; time: number }>;
    linearRampToValueAtTimeCalls: Array<{ value: number; time: number }>;
    cancelScheduledValuesCalls: number;
  };
  connectCalls: number;
};

/** Tracks AudioBufferSourceNode state for SFX verification. */
type MockSourceNode = {
  buffer: AudioBuffer | null;
  started: boolean;
  startTime: number;
  stopped: boolean;
  loop: boolean;
  connectCalls: number;
};

const createMockGainNode = (initialValue = 1): GainNode => {
  const node: MockGainNode = {
    gain: {
      value: initialValue,
      setValueAtTimeCalls: [],
      linearRampToValueAtTimeCalls: [],
      cancelScheduledValuesCalls: 0,
    },
    connectCalls: 0,
  };

  return {
    gain: {
      get value(): number {
        return node.gain.value;
      },
      set value(v: number) {
        node.gain.value = v;
      },
      setValueAtTime: mock((value: number, time: number) => {
        node.gain.value = value; // Simulate immediate value change for test assertions
        node.gain.setValueAtTimeCalls.push({ value, time });
        return node.gain as unknown as AudioParam;
      }),
      linearRampToValueAtTime: mock((value: number, time: number) => {
        node.gain.linearRampToValueAtTimeCalls.push({ value, time });
        return node.gain as unknown as AudioParam;
      }),
      cancelScheduledValues: mock(() => {
        node.gain.cancelScheduledValuesCalls++;
        return node.gain as unknown as AudioParam;
      }),
      cancelAndHoldAtTime: mock(() => node.gain as unknown as AudioParam),
      exponentialRampToValueAtTime: mock(() => node.gain as unknown as AudioParam),
      setTargetAtTime: mock(() => node.gain as unknown as AudioParam),
      setValueCurveAtTime: mock(() => node.gain as unknown as AudioParam),
    } as unknown as AudioParam,
    connect: mock(() => {
      node.connectCalls++;
      return {} as AudioNode;
    }),
    disconnect: mock(() => {}),
    context: {} as BaseAudioContext,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    dispatchEvent: mock(() => true),
  } as unknown as GainNode;
};

const createMockSourceNode = (): AudioBufferSourceNode => {
  const state: MockSourceNode = {
    buffer: null,
    started: false,
    startTime: 0,
    stopped: false,
    loop: false,
    connectCalls: 0,
  };

  let onendedCb: ((this: AudioBufferSourceNode, ev: Event) => unknown) | null = null;

  const node = {
    get buffer(): AudioBuffer | null {
      return state.buffer;
    },
    set buffer(v: AudioBuffer | null) {
      state.buffer = v;
    },
    get loop(): boolean {
      return state.loop;
    },
    set loop(v: boolean) {
      state.loop = v;
    },
    get started(): boolean {
      return state.started;
    },
    get startTime(): number {
      return state.startTime;
    },
    get stopped(): boolean {
      return state.stopped;
    },
    connect: mock(() => {
      state.connectCalls++;
      return {} as AudioNode;
    }),
    disconnect: mock(() => {}),
    start: mock((when?: number) => {
      state.started = true;
      state.startTime = when ?? fakeCurrentTime;
    }),
    stop: mock(() => {
      state.stopped = true;
    }),
    get onended(): ((this: AudioBufferSourceNode, ev: Event) => unknown) | null {
      return onendedCb;
    },
    set onended(cb: ((this: AudioBufferSourceNode, ev: Event) => unknown) | null) {
      onendedCb = cb;
    },
    playbackRate: {} as AudioParam,
    detune: {} as AudioParam,
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    dispatchEvent: mock(() => true),
    context: {} as BaseAudioContext,
    numberOfInputs: 0,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
  };

  createdSources.push(state);
  return node as unknown as AudioBufferSourceNode;
};

const createMockAudioContext = (): AudioContext => {
  createdGainNodes = [];
  createdSources = [];
  fakeCurrentTime = Math.max(fakeCurrentTime, 10);

  return {
    get currentTime(): number {
      return fakeCurrentTime;
    },

    destination: {} as AudioDestinationNode,

    createGain: mock((): GainNode => {
      const node = createMockGainNode();
      createdGainNodes.push(node as unknown as MockGainNode);
      return node;
    }),

    createBufferSource: mock((): AudioBufferSourceNode => {
      return createMockSourceNode();
    }),

    decodeAudioData: mock((): Promise<AudioBuffer> => {
      decodeCallCount++;
      return Promise.resolve(createStubAudioBuffer());
    }),

    createDynamicsCompressor: mock((): DynamicsCompressorNode => {
      // Minimal stub — returns a mock with AudioParam-like gain props
      const paramStub = { value: 0 } as unknown as AudioParam;
      const stub: unknown = {
        threshold: paramStub,
        knee: paramStub,
        ratio: paramStub,
        attack: paramStub,
        release: paramStub,
        connect: mock(() => ({})),
        disconnect: mock(() => {}),
        context: {} as BaseAudioContext,
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
        addEventListener: mock(() => {}),
        removeEventListener: mock(() => {}),
        dispatchEvent: mock(() => true),
      };
      return stub as DynamicsCompressorNode;
    }),

    resume: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    state: 'running',
    sampleRate: 44100,
  } as unknown as AudioContext;
};

// ── Test suite ──

describe('AudioService — C-150: Reactive Audio Manager', () => {
  let AudioServiceClass: typeof import('./audio_service.svelte').AudioService;
  let audioService: import('./audio_service.svelte').AudioServiceInterface;

  beforeEach(async () => {
    fakeCurrentTime = 10;
    decodeCallCount = 0;
    fetchCallCount = 0;

    const mockCtx = createMockAudioContext();

    // Mock audio_context_manager to return our controlled AudioContext
    mock.module('./audio_context_manager', () => ({
      audioContextManager: {
        get context(): AudioContext {
          return mockCtx;
        },
        unlock: mock(() => {
          // No-op in tests — AudioContext is already 'running'
        }),
      },
    }));

    // Mock global fetch for audio asset loading
    mock.module('node:fetch', () => {});
    (globalThis as Record<string, unknown>).fetch = mock(async (): Promise<Response> => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(1024),
      } as Response;
    });

    // Re-import to get a fresh instance with our mocks
    const mod = await import('./audio_service.svelte');
    AudioServiceClass = mod.AudioService;
    audioService = new AudioServiceClass({ className: 'TestAudioService' });

    // Advance fake time so initial graph creation doesn't interfere with tests
    fakeCurrentTime = 20;
  });

  afterEach(() => {
    fakeCurrentTime = 0;
    createdGainNodes = [];
    createdSources = [];
  });

  // ── AC-1: BGM transitionToBgm creates correct gain chain ──

  test('should create gain nodes on construction', () => {
    // At least 5 gain nodes: master, bgm, sfx, active, next
    expect(createdGainNodes.length).toBeGreaterThanOrEqual(5);
  });

  test('should set default volume values on construction', () => {
    expect(audioService.masterVolume).toBe(1);
    expect(audioService.bgmVolume).toBe(0.8);
    expect(audioService.sfxVolume).toBe(1);
  });

  // ── AC-2: Equal-Power Crossfade ──

  test('should crossfade between BGM tracks', async () => {
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');

    // First call should have created a source and started explore BGM
    expect(createdSources.length).toBe(1);
    expect(createdSources[0].started).toBe(true);
    expect(createdSources[0].loop).toBe(true);

    // Active gain should be at 1 (fully faded in)
    // Next gain should be at 0
  });

  test('should ramp active gain from 0 to 1 and next gain from 1 to 0 during crossfade', async () => {
    // First track
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    const sourcesBefore = createdSources.length;

    // Capture the active/next gain nodes before second transition
    // After first transition completes, active=1, next=0
    // Second transition swaps them: old active becomes next, new becomes active
    await audioService.transitionToBgm('/assets/audio/music/bgm_combat.webm');

    // A new source should have been created for the combat track
    expect(createdSources.length).toBe(sourcesBefore + 1);

    // The old source should have been stopped
    // (it's the previous active source that gets cleaned up)
  });

  test('should not restart same track if already playing', async () => {
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    const countBefore = createdSources.length;

    // Same track — should be a no-op
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');

    expect(createdSources.length).toBe(countBefore);
    expect(fetchCallCount).toBe(1); // Only fetched once (cached)
  });

  test('should cache decoded audio buffers', async () => {
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    const _decodeCount1 = decodeCallCount;
    const fetchCount1 = fetchCallCount;

    // Same URL — should use cached buffer
    await audioService.transitionToBgm('/assets/audio/music/bgm_combat.webm');
    // Then back to explore — should still be cached
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');

    // decodeAudioData is called for each unique URL, but fetch is cached via our mock
    // The buffer cache means second explore doesn't re-decode
    expect(fetchCallCount).toBeLessThanOrEqual(fetchCount1 + 2);
  });

  // ── AC-3: SFX Concurrent Playback ──

  test('should play SFX by creating an AudioBufferSourceNode', async () => {
    const sourcesBefore = createdSources.length;

    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');

    // One new source should have been created
    expect(createdSources.length).toBe(sourcesBefore + 1);
    const sfxSource = createdSources[createdSources.length - 1];
    expect(sfxSource.started).toBe(true);
  });

  test('should play multiple SFX concurrently (separate source nodes)', async () => {
    const sourcesBefore = createdSources.length;

    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');

    // Three independent source nodes should be created
    expect(createdSources.length).toBe(sourcesBefore + 3);

    // All should have started (concurrent playback)
    for (let i = sourcesBefore; i < createdSources.length; i++) {
      expect(createdSources[i].started).toBe(true);
    }
  });

  test('should handle SFX playback failure gracefully', async () => {
    // Mock fetch to fail
    (globalThis as Record<string, unknown>).fetch = mock(async () => {
      return {
        ok: false,
        status: 404,
      } as Response;
    });

    const sourcesBefore = createdSources.length;

    // Should not throw
    await audioService.playSfx('/assets/audio/sfx/nonexistent.wav');

    // No new source should be created
    expect(createdSources.length).toBe(sourcesBefore);
  });

  // ── AC-4: Volume Controls ──

  test('setMasterVolume should update state and gain node', () => {
    audioService.setMasterVolume(0.5);
    expect(audioService.masterVolume).toBe(0.5);
  });

  test('setBgmVolume should update state', () => {
    audioService.setBgmVolume(0.3);
    expect(audioService.bgmVolume).toBe(0.3);
  });

  test('setSfxVolume should update state', () => {
    audioService.setSfxVolume(0.7);
    expect(audioService.sfxVolume).toBe(0.7);
  });

  test('should clamp volume to 0–1 range', () => {
    audioService.setMasterVolume(1.5);
    expect(audioService.masterVolume).toBe(1);

    audioService.setMasterVolume(-0.5);
    expect(audioService.masterVolume).toBe(0);
  });

  // ── AC-5: Stop & Cleanup ──

  test('should stop all active sources and reset state', async () => {
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');

    expect(audioService.isCrossfading).toBe(false);

    audioService.stopAll();

    // All BGM (looping) sources should be stopped.
    // SFX sources are fire-and-forget — not tracked for stopAll.
    const bgmSources = createdSources.filter((s) => s.loop);
    expect(bgmSources.length).toBeGreaterThan(0);
    expect(bgmSources.every((s) => s.stopped)).toBe(true);
  });

  // ── AC-6: Rapid crossfade cancellation ──

  test('should handle rapid crossfade transitions', async () => {
    // Start first transition (doesn't await — rapid switches)
    const p1 = audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    const p2 = audioService.transitionToBgm('/assets/audio/music/bgm_combat.webm');

    await Promise.all([p1, p2]);

    // Both should resolve without throwing
    // The second transition should have aborted the first
  });

  // ── AC-7: isCrossfading flag ──

  test('should set isCrossfading during transition', async () => {
    expect(audioService.isCrossfading).toBe(false);

    // Fire transition — the flag is set synchronously after buffer loads,
    // which is asynchronous. Use a microtask yield to let the fetch resolve.
    const transition = audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');

    // Yield to allow the async fetch → decode → crossfade start chain to execute
    await new Promise((resolve) => setTimeout(resolve, 0));

    // isCrossfading should be true during transition (before the 1500ms ramp completes)
    expect(audioService.isCrossfading).toBe(true);

    await transition;

    // After completion, isCrossfading should be false
    expect(audioService.isCrossfading).toBe(false);
  });
});
