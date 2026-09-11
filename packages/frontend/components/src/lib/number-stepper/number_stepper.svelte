<script lang="ts">
// packages/frontend/components/src/lib/number_stepper/number_stepper.svelte
//
// Aikami number stepper — a numeric input with explicit decrement/increment
// buttons and the native spinner arrows suppressed. Pure and stateless: the
// value is owned by the consumer (via `bind:value` or `onchange`).

/** Visual size of the stepper. */
type NumberStepperSize = 'xs' | 'sm' | 'md';

type Props = {
  /** Current numeric value. Supports Svelte 5 two-way binding. */
  value: number;
  /** Lower bound (inclusive). The decrement button disables at the bound. */
  min?: number;
  /** Upper bound (inclusive). The increment button disables at the bound. */
  max?: number;
  /** Increment/decrement amount. @default 1 */
  step?: number;
  /**
   * Called with the clamped value after any change (typing, blur, or a
   * button press).
   */
  onchange?: (value: number) => void;
  /** Accessible name used for the input and the +/- buttons. */
  label: string;
  /** Visual size. @default 'md' */
  size?: NumberStepperSize;
  /** Disables the whole control. @default false */
  disabled?: boolean;
  /** Additional classes for the root element. */
  class?: string;
};

let {
  value = $bindable(),
  min,
  max,
  step = 1,
  onchange,
  label,
  size = 'md',
  disabled = false,
  class: className = '',
}: Props = $props();

const _clamp = (candidate: number): number => {
  let result = candidate;
  if (min !== undefined && result < min) {
    result = min;
  }
  if (max !== undefined && result > max) {
    result = max;
  }
  return result;
};

const _commit = (candidate: number): void => {
  const next = _clamp(candidate);
  value = next;
  if (onchange) {
    onchange(next);
  }
};

const _decrement = (): void => {
  _commit(value - step);
};

const _increment = (): void => {
  _commit(value + step);
};

const _handleInput = (event: Event): void => {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === '') {
    return;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return;
  }
  value = parsed;
  if (onchange) {
    onchange(parsed);
  }
};

const _handleBlur = (): void => {
  _commit(value);
};

const _atMin = $derived(min !== undefined && value <= min);
const _atMax = $derived(max !== undefined && value >= max);
</script>

<div class="number-stepper number-stepper-{size} {className}">
  <button
    type="button"
    class="number-stepper-button"
    aria-label="Decrease {label}"
    disabled={disabled || _atMin}
    onclick={_decrement}
  >
    −
  </button>

  <input
    type="number"
    class="number-stepper-input"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    {disabled}
    oninput={_handleInput}
    onblur={_handleBlur}
  >

  <button
    type="button"
    class="number-stepper-button"
    aria-label="Increase {label}"
    disabled={disabled || _atMax}
    onclick={_increment}
  >
    +
  </button>
</div>
