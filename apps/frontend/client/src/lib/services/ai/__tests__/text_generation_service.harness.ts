// apps/frontend/client/src/lib/services/ai/__tests__/text_generation_service.harness.ts
//
// Shared mocks and helpers for the TextGenerationService unit suites.
//
// Extracted so the service's behaviour can be split across focused suites —
// delegation, coalescing, deadlines, admission — without each one re-declaring
// the gateway and local-pool mocks. Two copies of a mock that decides whether a
// provider call happens is worse than one large file, so the mocks moved first
// and the suites followed.
//
// One MUTABLE OBJECT, `mocks`, owns every piece of fake state. An exported
// `let` cannot be assigned to from another module, which would force a setter
// per field; an object property can. Test suites mutate `mocks.x` directly and
// read it back the same way.
//
// 🔴 ORDERING: `mock.module` calls run when THIS module is evaluated, which is
// before the service module is imported by the first `loadService()`. Every
// suite must therefore import this file before it touches the service.
//
// 🔴 The mock specifiers are `../`-relative and must stay that way: they resolve
// against THIS file's directory. A relative path that happens to resolve to the
// same absolute path is fine; one that does not silently installs no mock at
// all, and the suite then runs against the real gateway and fails in ways that
// look like product bugs.

import { mock } from 'bun:test';
import { textTelemetryService } from '../text_telemetry_service.svelte.ts';

/** Every piece of fake state the suites mutate. */
export const mocks = {
  gatewayGenerateCalls: [] as Array<Record<string, unknown>>,
  gatewayChunks: [] as string[],
  gatewayStructured: undefined as unknown,
  gatewayError: undefined as unknown,
  /** Optional hang used by cancelAll tests: resolve only when aborted. */
  blockUntilAbort: false,
  /** Simulated provider work, so a test can make a call take MEASURABLE time. */
  gatewayDelayMs: 0,
  gatewayUsage: undefined as { inputTokens: number; outputTokens: number } | undefined,
  /** Holds the NEXT gateway call open, so in-flight behaviour is observable. */
  gatewayGate: undefined as { promise: Promise<void>; release: () => void } | undefined,
  /** The routing `resolveText` reports, so policy can be exercised per test. */
  gatewayRouting: {
    capability: 'text',
    mode: 'offline',
    provider: 'local-qwen3',
    model: '',
    endpoint: '',
  } as Record<string, unknown>,
  localBlockUntilAbort: false,
  localSignal: undefined as AbortSignal | undefined,
  localSubmitOutput: '',
  localSubmitError: undefined as unknown,
  localSubmitCalls: 0,
  localEnsureLoadedCalls: 0,
  /** Simulated on-device work, for the local-first duration test. */
  localDelayMs: 0,
  /** Model ids the fake engine claims to serve; drives readiness. */
  localServedModels: ['local-qwen3'] as string[],
};

// ---------------------------------------------------------------------------
// Mock: aiGatewayService (the C-320 delegation target)
// ---------------------------------------------------------------------------

/**
 * Simulated provider work, so a test can make a call take MEASURABLE time.
 *
 * The point of the duration tests is that a call which really took time reports
 * that time. Without a delay in the mock there is nothing to measure, and the
 * assertion would pass against the very bug it exists to catch.
 */
/** Provider-reported usage the mock should return, when a test sets it. */
/**
 * The admission quiet window, in ms, for the NEXT service instance loaded.
 *
 * Set before `loadService()`, because the gate reads it when the module is
 * first imported. Zero by default so tests that are not ABOUT admission do not
 * silently wait out a real 1.5 s window — and, more importantly, so a test
 * cannot pass by accident while its subject is queued.
 */
/** Holds the NEXT gateway call open, so in-flight behaviour is observable. */
/** The routing `resolveText` reports, so policy can be exercised per test. */

const mockAiGatewayService = {
  resolveText: mock((options?: { model?: string; task?: string }) => ({
    ...mocks.gatewayRouting,
    ...(options?.model === undefined ? {} : { model: options.model }),
  })),
  generateText: mock(async (options: Record<string, unknown>) => {
    mocks.gatewayGenerateCalls.push(options);
    // A test may hold every gateway call open to observe what happens while a
    // request is genuinely in flight.
    if (mocks.gatewayGate) {
      const gate = mocks.gatewayGate;
      mocks.gatewayGate = undefined;
      await gate.promise;
    }
    const { onChunk, onResolve, signal, model } = options as {
      onChunk?: (text: string) => void;
      onResolve?: (resolution: unknown) => void;
      signal?: AbortSignal;
      model?: string;
    };

    // Stands in for real inference time. Abort-aware, so a deadline test can
    // still cut it short.
    if (mocks.gatewayDelayMs > 0) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted === true) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, mocks.gatewayDelayMs);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }

    if (mocks.gatewayError) {
      throw mocks.gatewayError;
    }

    onResolve?.({
      provider: 'openrouter',
      model: model ?? 'test-model',
      endpoint: 'https://api.openrouter.ai',
    });

    if (onChunk) {
      for (const chunk of mocks.gatewayChunks) {
        onChunk(chunk);
      }
    }

    // Optional hang used by cancelAll tests: resolve only when aborted.
    if (mocks.blockUntilAbort && signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }

    if (signal?.aborted) {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    }

    return {
      text: mocks.gatewayChunks.join(''),
      structured: mocks.gatewayStructured,
      ...(mocks.gatewayUsage === undefined ? {} : { usage: mocks.gatewayUsage }),
    };
  }),
  cancelAll: mock(() => {}),
};

mock.module('../ai_gateway_service.svelte.ts', () => ({
  aiGatewayService: mockAiGatewayService,
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Mock: localTaskPoolService (local-first micro-task path)
// ---------------------------------------------------------------------------

/** Simulated on-device work, for the local-first duration test. */
/** Model the fake engine claims to serve; drives readiness. */

const mockLocalPool = {
  ensureLoaded: mock(async (signal: AbortSignal) => {
    mocks.localEnsureLoadedCalls++;
    mocks.localSignal = signal;
    if (mocks.localBlockUntilAbort) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new DOMException('Aborted', 'AbortError');
    }
    if (mocks.localSubmitError) {
      throw mocks.localSubmitError;
    }
  }),
  submit: mock(async () => {
    mocks.localSubmitCalls++;
    if (mocks.localDelayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, mocks.localDelayMs);
      });
    }
    if (mocks.localSubmitError) {
      throw mocks.localSubmitError;
    }
    return { type: 'text', output: mocks.localSubmitOutput, latencyMs: 1, ok: true };
  }),
  readiness: {
    state: 'ready' as const,
    get servedModelIds() {
      return mocks.localServedModels;
    },
    confirmedModelIds: [] as string[],
  },
  canServeLocal: mock((model?: string) => {
    if (model === undefined || model.trim().length === 0) {
      return true;
    }
    return mocks.localServedModels.some((id) => id.toLowerCase() === model.toLowerCase());
  }),
};

mock.module('../local_task_pool_service.svelte.ts', () => ({
  localTaskPoolService: {
    pool: mockLocalPool,
    readiness: mockLocalPool.readiness,
    canServeLocal: mockLocalPool.canServeLocal,
  },
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const loadService = async () => {
  const mod = await import('../text_generation_service.svelte.ts');
  return mod.textGenerationService as import('../text_generation_service.svelte.ts').TextGenerationServiceInterface;
};

/** Holds the next gateway call open until the returned release is invoked. */
export const holdGateway = (): (() => void) => {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.gatewayGate = { promise, release };
  return () => release();
};

export const resetGatewayMocks = (): void => {
  setQuietWindow(0);
  mocks.gatewayGenerateCalls = [];
  mocks.gatewayChunks = [];
  mocks.gatewayStructured = undefined;
  mocks.gatewayError = undefined;
  mocks.blockUntilAbort = false;
  mocks.gatewayDelayMs = 0;
  mocks.gatewayUsage = undefined;
  mocks.localDelayMs = 0;
  mocks.localBlockUntilAbort = false;
  mocks.localSignal = undefined;
  textTelemetryService.clear();
  mocks.gatewayGate = undefined;
  mocks.gatewayRouting = {
    capability: 'text',
    mode: 'offline',
    provider: 'local-qwen3',
    model: '',
    endpoint: '',
  };
};

// ---------------------------------------------------------------------------
// Setters
//
// The suites ASSIGN to mock state; an imported binding cannot be assigned to.
// These setters keep the mutable state private to the harness and make every
// mutation go through one named place.
// ---------------------------------------------------------------------------

/** Sets the routing `resolveText` reports, so policy can be exercised. */
export const setGatewayRouting = (routing: Record<string, unknown>): void => {
  mocks.gatewayRouting = routing;
};

/** Sets the structured value the mocked gateway returns. */
export const setGatewayStructured = (value: unknown): void => {
  mocks.gatewayStructured = value;
};

/** Sets (or clears) the error the mocked gateway throws. */
export const setGatewayError = (error: unknown): void => {
  mocks.gatewayError = error;
};

/** Sets the output the fake on-device engine produces. */
export const setLocalSubmitOutput = (output: string): void => {
  mocks.localSubmitOutput = output;
};

/** Sets the model ids the fake on-device engine claims to serve. */
export const setLocalServedModels = (models: string[]): void => {
  mocks.localServedModels = models;
};

/** Sets the admission quiet window for the NEXT service instance loaded. */
export const setQuietWindow = (ms: number): void => {
  (globalThis as Record<string, unknown>).__text_admission_quiet_window_ms = ms;
};
