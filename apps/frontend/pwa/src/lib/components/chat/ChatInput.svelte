<script lang="ts">
/**
 * Props for the ChatInput component.
 * Text input area for typing and sending chat messages.
 */
type Props = {
  /** Current message text (bindable) */
  message: string;
  /** Whether a message is currently being sent (disables input) */
  isSending: boolean;
  /** Callback when user sends a message */
  onSend: (message: string) => void;
  /** Placeholder text when input is empty */
  placeholder?: string;
};

let {
  message = $bindable(),
  isSending,
  onSend,
  placeholder = 'Type your message...',
}: Props = $props();

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (message.trim()) {
      onSend(message);
      message = '';
    }
  }
}

function handleSubmit() {
  if (message.trim()) {
    onSend(message);
    message = '';
  }
}
</script>

<div class="flex gap-2">
  <textarea
    bind:value={message}
    {placeholder}
    class="textarea textarea-bordered flex-grow resize-none"
    rows="1"
    disabled={isSending}
    onkeydown={handleKeydown}
  ></textarea>
  <button
    type="button"
    class="btn btn-primary"
    disabled={isSending || !message.trim()}
    onclick={handleSubmit}
  >
    {#if isSending}
      <span class="loading loading-spinner"></span>
    {:else}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
        />
      </svg>
    {/if}
  </button>
</div>
