// .pi/guidance/examples/view_model_canonical.ts
//
// Canonical ViewModel pattern: interface + factory + `create()`. This is a
// **representative illustration** — a real ViewModel extends BaseViewModel
// (which provides this.debug(), auto-logging via create(), etc.) and imports
// from $services. See the full svelte-conventions skill for the complete
// production pattern.
//
// ✅ executable: compiles and lints under the scripts project configuration.
// The structure mirrors what guard_mvvm_conventions M1–M7 enforce.

export type CounterViewModelOptions = {
  readonly initialCount: number;
};

export type CounterViewModelInterface = {
  readonly count: number;
  increment(): void;
  reset(): void;
};

class CounterViewModel implements CounterViewModelInterface {
  private _count: number;

  private constructor(options: CounterViewModelOptions) {
    this._count = options.initialCount;
  }

  static create(options: CounterViewModelOptions): CounterViewModelInterface {
    return new CounterViewModel(options);
  }

  get count(): number {
    return this._count;
  }

  increment(): void {
    this._count += 1;
  }

  reset(): void {
    this._count = 0;
  }
}

export const getCounterViewModel = (options: CounterViewModelOptions): CounterViewModelInterface =>
  CounterViewModel.create(options);
