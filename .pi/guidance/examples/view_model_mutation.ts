// .pi/guidance/examples/view_model_mutation.ts
//
// 🔴 INTENTIONALLY INVALID — MUTATION FIXTURE
//
// Violates M4: uses `new ClassName(` instead of `ClassName.create()`.
// Must be rejected by guard_mvvm_conventions when scanned.
//
// This file is deliberately placed outside the client source tree so it does
// not pollute the baseline. The validate_agent_guidance test asserts that
// the guard_mvvm_conventions scanner would flag this pattern if it were
// inside the client.

export type BadViewModelOptions = { label: string };
export type BadViewModelInterface = { label: string; greet(): string };

class BadViewModel implements BadViewModelInterface {
  readonly label: string;

  private constructor(options: BadViewModelOptions) {
    this.label = options.label;
  }

  greet(): string {
    return `Hello, ${this.label}`;
  }
}

// ❌ VIOLATION: must use BadViewModel.create() factory, not `new`
export const createBadViewModel = (options: BadViewModelOptions): BadViewModelInterface =>
  new BadViewModel(options);
