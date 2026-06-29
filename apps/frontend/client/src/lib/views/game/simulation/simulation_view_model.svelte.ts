// apps/frontend/client/src/lib/views/game/simulation/simulation_view_model.svelte.ts

import {
  type ActionMutationPayload,
  type MutationResult,
  Position,
  type StreamingOrchestratorOptions,
  StreamingOrchestratorService,
} from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// SimulationViewModel — Svelte 5 bridge for the streaming tool orchestrator
// ---------------------------------------------------------------------------

/**
 * Per-entity render data projected to the UI layer.
 *
 * Updated on each {@link requestAnimationFrame} tick from the bitECS
 * component arrays (unproxied SoA storage). The UI binds to
 * {@link SimulationViewModelInterface.renderMap} which is backed by
 * {@link $state.raw} — no Svelte proxy traps touch this data.
 */
export type RenderEntry = {
  /** World-space X position of the entity. */
  readonly x: number;
  /** World-space Y position of the entity. */
  readonly y: number;
};

/**
 * Describes a parsed tool invocation that was successfully injected
 * into the bitECS component arrays.
 */
export type ToolInvocationLog = {
  /** Monotonic sequence number. */
  readonly index: number;
  /** The parsed payload (all resolved fields). */
  readonly payload: ActionMutationPayload;
  /** Whether the target entity already existed in the world. */
  readonly entityExisted: boolean;
  /** Timestamp when the mutation was applied (ms since epoch). */
  readonly timestamp: number;
};

export type SimulationViewModelInterface = BaseViewModelInterface & {
  /**
   * Flat render map backed by {@link $state.raw}.
   *
   * Keys are entity IDs. Values are shallow `{ x, y }` records.
   * Updated on every {@link requestAnimationFrame} tick from the
   * bitECS Position component arrays.
   *
   * The UI binds to this map directly — no proxy traps, no deep reactivity.
   */
  readonly renderMap: Record<number, RenderEntry>;

  /** Number of entities currently tracked in the render map. */
  readonly entityCount: number;

  /** Log of the most recent tool invocations (most recent first, max 100). */
  readonly toolLog: readonly ToolInvocationLog[];

  /** Whether the rAF projection loop is currently running. */
  readonly isProjecting: boolean;

  /**
   * Processes a raw binary chunk from a Web Streams reader through the
   * orchestrator pipeline. Mutations are applied directly to bitECS
   * component arrays and logged to {@link toolLog}.
   *
   * @param chunk - Raw Uint8Array from `reader.read()`.
   * @returns The number of successfully parsed and applied mutations.
   */
  processChunk(chunk: Uint8Array): number;

  /**
   * Starts the {@link requestAnimationFrame} projection loop.
   *
   * Each frame, reads the bitECS Position component arrays and writes
   * shallow `{ x, y }` records to {@link renderMap} via {@link $state.raw}
   * reassignment. Runs until {@link stopProjection} is called.
   */
  startProjection(): void;

  /**
   * Stops the rAF projection loop.
   *
   * No further updates to {@link renderMap} will occur until
   * {@link startProjection} is called again.
   */
  stopProjection(): void;

  /**
   * Resets the orchestrator accumulator and clears the tool log.
   *
   * Call when starting a new streaming session to prevent stale
   * data from a previous stream from corrupting the new one.
   */
  reset(): void;

  /**
   * Cleanses a reactive Svelte proxy value via {@link $state.snapshot}
   * before it enters the engine layer.
   *
   * Use this as a boundary guard whenever UI-reflected state must be
   * passed to the orchestrator or bitECS arrays. Without snapshot
   * treatment, proxy traps corrupt monomorphic data structures and
   * degrade execution velocity by ~4×.
   *
   * @param value - Any Svelte proxy-backed value from the UI layer.
   * @returns A plain, unproxied copy safe for engine consumption.
   */
  cleanseProxy<T>(value: T): T;

  /**
   * Streams tool mutations from a fetch {@link Response} body.
   *
   * Reads chunks via `response.body.getReader()`, processes them through
   * the orchestrator, and starts the rAF projection loop. Returns when
   * the stream ends or the response has no body.
   *
   * @param response - A fetch Response with a streaming body.
   * @throws If the response has no body.
   */
  streamFromResponse(response: Response): Promise<void>;
};

export type SimulationViewModelOptions = BaseViewModelOptions & {
  /** Maximum tool log entries to retain (default: 100). */
  maxToolLogSize?: number;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Maximum tool log entries when no explicit size is configured. */
const DEFAULT_MAX_TOOL_LOG = 100;

class SimulationViewModel
  extends BaseViewModel<SimulationViewModelOptions>
  implements SimulationViewModelInterface
{
  // ── State ────────────────────────────────────────────────────────────

  /**
   * Flat render map backed by `$state.raw`.
   *
   * Svelte will NOT proxy this object — it only reacts to top-level
   * reassignment. Each rAF tick writes a new object, so the UI re-renders
   * only once per frame, not for every individual entity update.
   *
   * Contract: AC-3 Unidirectional View Synchronization
   */
  renderMap = $state.raw<Record<number, RenderEntry>>({});

  /**
   * Tool invocation log (most recent first).
   *
   * Bounded to {@link _maxToolLogSize} entries. Used by dev sandboxes
   * and visual test suites to verify mutation delivery.
   */
  toolLog: ToolInvocationLog[] = $state([]);

  /** Whether the rAF projection loop is currently running. */
  isProjecting = $state(false);

  // ── Private fields ───────────────────────────────────────────────────

  /** The underlying engine-level streaming orchestrator. */
  private readonly _orchestrator: StreamingOrchestratorService;

  /** Maximum tool log size. */
  private readonly _maxToolLogSize: number;

  /** Monotonic counter for tool log sequence numbers. */
  private _toolLogCounter = 0;

  /** rAF handle for the projection loop (undefined = not running). */
  private _rafHandle: number | undefined;

  /** Timestamp of the last projection frame for throttling diagnostics. */
  private _lastProjectionTime = 0;

  // ── Construction ────────────────────────────────────────────────────

  /**
   * Do NOT use `new SimulationViewModel()`. Use the exported factory
   * function {@link getSimulationViewModel} instead.
   */
  constructor(options: SimulationViewModelOptions) {
    super(options);
    this._maxToolLogSize = options.maxToolLogSize ?? DEFAULT_MAX_TOOL_LOG;

    this._orchestrator = (
      StreamingOrchestratorService.create as (
        opts: StreamingOrchestratorOptions,
      ) => StreamingOrchestratorService
    )({
      className: 'StreamingOrchestratorService',
      onMutation: (result: MutationResult) => {
        this._logMutation(result);
      },
    });
  }

  // ── Computed ────────────────────────────────────────────────────────

  /** Number of entities currently tracked in the render map. */
  get entityCount(): number {
    return Object.keys(this.renderMap).length;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** @inheritdoc */
  processChunk(chunk: Uint8Array): number {
    const results = this._orchestrator.processChunk(chunk);
    return results.length;
  }

  /** @inheritdoc */
  startProjection(): void {
    if (this._rafHandle !== undefined) {
      return;
    }

    this.isProjecting = true;

    const tick = (): void => {
      this._projectFrame();
      this._rafHandle = requestAnimationFrame(tick);
    };

    this._rafHandle = requestAnimationFrame(tick);
  }

  /** @inheritdoc */
  stopProjection(): void {
    if (this._rafHandle !== undefined) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = undefined;
    }
    this.isProjecting = false;
  }

  /** @inheritdoc */
  reset(): void {
    this._orchestrator.reset();
    this.toolLog = [];
    this._toolLogCounter = 0;
    this.renderMap = {};
  }

  /** @inheritdoc */
  cleanseProxy<T>(value: T): T {
    // $state.snapshot() strips Svelte proxy traps from reactive objects,
    // returning a plain object safe for engine consumption.
    // biome-ignore lint/suspicious/noExplicitAny: $state.snapshot() needs untyped pass-through
    return $state.snapshot(value as any) as T;
  }

  /** @inheritdoc */
  async streamFromResponse(response: Response): Promise<void> {
    this.startProjection();

    try {
      for await (const _result of this._orchestrator.streamFromResponse(response)) {
        // Mutations are applied by the orchestrator and logged via
        // the onMutation callback. The rAF loop handles rendering.
      }
    } finally {
      this.stopProjection();
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this.stopProjection();
    this.toolLog = [];
    await super.dispose();
  }

  // ── Private: rAF projection ─────────────────────────────────────────

  /**
   * Reads the Position component arrays and writes shallow `{ x, y }`
   * records to {@link renderMap} via a single reassignment.
   *
   * This is the unidirectional projection engine from AC-3:
   * - Reads from unproxied bitECS SoA arrays (monomorphic, no traps)
   * - Writes to `$state.raw` via flat reassignment (one DOM update per frame)
   * - No proxy contamination crosses in either direction
   *
   * Throttling: skips frames that arrive within 8ms of the last projection
   * (≈120fps cap) to prevent rAF pileups on high-refresh displays.
   */
  private _projectFrame(): void {
    const now = performance.now();
    if (now - this._lastProjectionTime < 8) {
      return;
    }
    this._lastProjectionTime = now;

    // Position is a pure SoA component from the engine — no Svelte
    // runes, no proxy traps, monomorphic numeric arrays.
    const nextMap: Record<number, RenderEntry> = {};

    // Iterate over all indices in the Position.x array.
    // Only include entries where x is a defined number. This avoids
    // rendering every allocated array slot — only entities with valid
    // positions appear.
    for (let eid = 0; eid < Position.x.length; eid++) {
      const x = Position.x[eid];
      const y = Position.y[eid];
      if (typeof x !== 'number' || typeof y !== 'number') {
        continue;
      }
      nextMap[eid] = { x, y };
    }

    // Single reassignment — Svelte detects the top-level reference change
    // and re-renders once. No per-entity proxy notifications.
    this.renderMap = nextMap;
  }

  // ── Private: mutation logging ───────────────────────────────────────

  /**
   * Appends a resolved mutation result to the tool log.
   *
   * Bounded to {@link _maxToolLogSize} entries (oldest entries trimmed
   * when the limit is exceeded). Most recent entries appear first.
   */
  private _logMutation(result: MutationResult): void {
    const entry: ToolInvocationLog = {
      index: ++this._toolLogCounter,
      payload: result.payload,
      entityExisted: result.entityExisted,
      timestamp: Date.now(),
    };

    this.toolLog = [entry, ...this.toolLog].slice(0, this._maxToolLogSize);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new {@link SimulationViewModel} instance.
 *
 * @param options - ViewModel options including optional log size.
 */
export const getSimulationViewModel = (
  options: SimulationViewModelOptions,
): SimulationViewModel => {
  return new SimulationViewModel(options);
};

export { SimulationViewModel };
