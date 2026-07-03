<script lang="ts">
  // packages/frontend/components/src/lib/select/select.svelte

  /** Option shape for the select dropdown. */
  type SelectOption = {
    value: string;
    label: string;
  };

  type Props = {
    /** The current value of the select input. Supports Svelte 5 two-way binding. */
    value: string;
    /** Array of options to render within the dropdown. */
    options: SelectOption[];
    /** Optional callback triggered when the value changes. */
    onchange?: (value: string) => void;
    /** DaisyUI sizing modifier. @default 'md' */
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** Applies the 'select-bordered' DaisyUI class if true. @default true */
    bordered?: boolean;
    /** Additional Tailwind/DaisyUI classes to apply to the root select element. */
    class?: string;
  };

  let {
    value = $bindable(),
    options,
    onchange,
    size = 'md',
    bordered = true,
    class: className = '',
  }: Props = $props();

  const handleChange = (event: Event): void => {
    const target = event.target as HTMLSelectElement;
    value = target.value;
    if (onchange) {
      onchange(value);
    }
  };
</script>

<select
  class="select select-{size} {bordered ? 'select-bordered' : ''} {className}"
  value={value}
  onchange={handleChange}
>
  {#each options as option (option.value)}
    <option value={option.value}>{option.label}</option>
  {/each}
</select>
