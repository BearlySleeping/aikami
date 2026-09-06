// apps/frontend/client/src/lib/views/reactive_lifecycle/reactive_counter_view_model.svelte.ts
//
// Compiled-component test fixture for C-477. Demonstrates real Svelte 5
// reactivity: $state, $derived, $effect.root, and dispose cleanup.
// Intentionally kept minimal — a representative C-475-aligned ViewModel.

export type ReactiveCounterOptions = {
  readonly initialCount?: number;
};

export type ReactiveCounterInterface = {
  readonly count: number;
  readonly doubled: number;
  readonly label: string;
  readonly tickCount: number;
  readonly effectCleanupFired: boolean;
  readonly asyncResult: string | undefined;
  readonly isAsyncPending: boolean;
  increment(): void;
  decrement(): void;
  reset(): void;
  startAsyncOperation(options: { delayMs: number; result: string }): void;
  dispose(): void;
};

class ReactiveCounter implements ReactiveCounterInterface {
  count = $state(0);
  tickCount = $state(0);
  effectCleanupFired = $state(false);
  asyncResult = $state<string | undefined>();
  isAsyncPending = $state(false);

  /** Derived value — real Svelte $derived recomputes on $state changes. */
  doubled = $derived(this.count * 2);

  /** Derived label — demonstrates $derived.by() with multi-step logic. */
  label = $derived.by(() => {
    const c = this.count;
    if (c === 0) return "zero";
    if (c > 0) return `positive (${c})`;
    return `negative (${c})`;
  });

  private _intervalId: ReturnType<typeof setInterval> | undefined;
  private _asyncController: AbortController | undefined;
  private _effectCleanup: (() => void) | undefined;

  private constructor() {}

  static create(options?: ReactiveCounterOptions): ReactiveCounterInterface {
    const instance = new ReactiveCounter();
    instance.count = options?.initialCount ?? 0;
    instance._startTickEffect();
    return instance;
  }

  increment(): void {
    this.count += 1;
  }

  decrement(): void {
    this.count -= 1;
  }

  reset(): void {
    this.count = 0;
    this.tickCount = 0;
    this.asyncResult = undefined;
    this.isAsyncPending = false;
  }

  /**
   * Starts a simulated async operation. The ViewModel can be disposed while
   * the operation is pending — the AbortController prevents stale updates.
   */
  startAsyncOperation(options: { delayMs: number; result: string }): void {
    this._asyncController?.abort();
    this._asyncController = new AbortController();
    const signal = this._asyncController.signal;
    this.isAsyncPending = true;
    this.asyncResult = undefined;

    const timer = setTimeout(() => {
      if (signal.aborted) {
        return;
      }
      this.asyncResult = options.result;
      this.isAsyncPending = false;
    }, options.delayMs);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      this.isAsyncPending = false;
    });
  }

  dispose(): void {
    this._asyncController?.abort();
    this._asyncController = undefined;
    if (this._intervalId !== undefined) {
      clearInterval(this._intervalId);
      this._intervalId = undefined;
    }
    this._effectCleanup?.();
    this._effectCleanup = undefined;
    this.effectCleanupFired = true;
  }

  private _startTickEffect(): void {
    // $effect.root captures the effect so cleanup can be called explicitly
    this._effectCleanup = $effect.root(() => {
      $effect(() => {
        this._intervalId = setInterval(() => {
          this.tickCount += 1;
        }, 1000);

        return () => {
          if (this._intervalId !== undefined) {
            clearInterval(this._intervalId);
            this._intervalId = undefined;
            this.effectCleanupFired = true;
          }
        };
      });
    });
  }
}

export const getReactiveCounter = (
  options?: ReactiveCounterOptions,
): ReactiveCounterInterface => ReactiveCounter.create(options);
