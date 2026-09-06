// apps/frontend/client/src/lib/views/reactive_lifecycle/reactive_counter_view_model.svelte.ts
//
// Compiled-component test fixture for C-477. Demonstrates real Svelte 5
// reactivity: $state, $derived, registered $effect.root and dispose cleanup.
//
// Deliberately built on the production BaseViewModel rather than a standalone
// class: C-477 exists to prove the *real* lifecycle works under compilation,
// so the fixture exercises BaseViewModel.registerEffectRoot and the inherited
// dispose() chain instead of re-implementing them.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type ReactiveCounterViewModelOptions = BaseViewModelOptions & {
  /** Starting value for the counter. Defaults to 0. */
  readonly initialCount?: number;
};

export type ReactiveCounterViewModelInterface = BaseViewModelInterface & {
  /** Current counter value — plain $state. */
  readonly count: number;
  /** count * 2 — recomputed by a real $derived. */
  readonly doubled: number;
  /** Human-readable label — a $derived.by() with multi-step logic. */
  readonly label: string;
  /** Ticks accumulated by the registered interval effect. */
  readonly tickCount: number;
  /** True once the effect's cleanup function has run. */
  readonly effectCleanupFired: boolean;
  /** Result of the last completed async operation, if any. */
  readonly asyncResult: string | undefined;
  /** True while an async operation is in flight. */
  readonly isAsyncPending: boolean;

  increment(): void;
  decrement(): void;
  reset(): void;
  /** Starts a simulated async operation that dispose() can cancel. */
  startAsyncOperation(options: { delayMs: number; result: string }): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ReactiveCounterViewModel
  extends BaseViewModel<ReactiveCounterViewModelOptions>
  implements ReactiveCounterViewModelInterface
{
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
    if (c === 0) {
      return 'zero';
    }
    if (c > 0) {
      return `positive (${c})`;
    }
    return `negative (${c})`;
  });

  private _intervalId: ReturnType<typeof setInterval> | undefined;
  private _asyncController: AbortController | undefined;

  constructor(options: ReactiveCounterViewModelOptions) {
    super(options);
    this.count = options.initialCount ?? 0;
    this._startTickEffect();
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
    const { signal } = this._asyncController;
    this.isAsyncPending = true;
    this.asyncResult = undefined;

    const timer = setTimeout(() => {
      if (signal.aborted) {
        return;
      }
      this.asyncResult = options.result;
      this.isAsyncPending = false;
    }, options.delayMs);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      this.isAsyncPending = false;
    });
  }

  /**
   * Cancels the in-flight async operation, then defers to BaseViewModel, whose
   * dispose() fires every cleanup registered through registerEffectRoot — that
   * is what clears the interval and sets effectCleanupFired.
   */
  override async dispose(): Promise<void> {
    this._asyncController?.abort();
    this._asyncController = undefined;
    await super.dispose();
  }

  private _startTickEffect(): void {
    this.registerEffectRoot(() => {
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

export const getReactiveCounterViewModel = (
  options?: Omit<ReactiveCounterViewModelOptions, 'className'>,
): ReactiveCounterViewModelInterface =>
  ReactiveCounterViewModel.create({ className: 'ReactiveCounterViewModel', ...options });
