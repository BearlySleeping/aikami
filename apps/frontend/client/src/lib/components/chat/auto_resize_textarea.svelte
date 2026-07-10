<script lang="ts">
// apps/frontend/client/src/lib/components/chat/auto_resize_textarea.svelte
//
// Auto-resizing textarea that grows/shrinks based on content.
// Uses CSS field-sizing: content as primary, JS rows fallback.
// Clamped at 8 rows maximum.
//
// Contract: C-231 AC-4 Auto-Resize Textarea

type Props = {
  /** Current text value (controlled input). */
  value: string;
  /** Called when the user changes the text. */
  onchange?: (value: string) => void;
  /** Called on keydown (Enter to submit, etc.). */
  onkeydown?: (event: KeyboardEvent) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Whether the textarea is disabled. */
  disabled?: boolean;
  /** CSS class string for additional styling. */
  class?: string;
};

const {
  value,
  onchange,
  onkeydown,
  placeholder = 'Type your message...',
  disabled = false,
  class: classProp = '',
}: Props = $props();

// ── Row calculation ──────────────────────────────────────────────────

const MAX_ROWS = 8;

const computedRows = $derived(Math.min(MAX_ROWS, Math.max(1, value.split('\n').length)));

// ── Event handlers ───────────────────────────────────────────────────

const handleInput = (e: Event) => {
  const target = e.target as HTMLTextAreaElement;
  onchange?.(target.value);
};

const handleKeyDown = (e: KeyboardEvent) => {
  onkeydown?.(e);
};
</script>

<textarea
  {value}
  oninput={handleInput}
  class="textarea textarea-bordered resize-y text-sm field-sizing-content {classProp}"
  style:max-height="calc(1.5em * {MAX_ROWS} + 1rem)"
  style:min-height="2.5rem"
  rows={computedRows}
  {placeholder}
  {disabled}
  onkeydown={handleKeyDown}
></textarea>

<style>
/**
 * Progressive enhancement: field-sizing: content for Chrome 123+ /
 * Firefox 124+ / Safari 17.4+. Falls back to JS rows attribute
 * in older browsers.
 */
textarea.field-sizing-content {
  field-sizing: content;
}
</style>
