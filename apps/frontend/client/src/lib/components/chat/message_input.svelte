<script lang="ts">
  // apps/frontend/client/src/lib/components/chat/MessageInput.svelte
  type Props = {
    message?: string;
    isSending?: boolean;
    onSend?: (message: string) => void;
    onAttach?: (file: File) => void;
    placeholder?: string;
  };

  let {
    message = $bindable(''),
    isSending = false,
    onSend,
    onAttach,
    placeholder = 'Type your message...',
  }: Props = $props();

  let fileInput: HTMLInputElement;

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (message.trim()) {
        onSend?.(message);
        message = '';
      }
    }
  }

  function handleSubmit() {
    if (message.trim()) {
      onSend?.(message);
      message = '';
    }
  }

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      onAttach?.(input.files[0]);
      input.value = '';
    }
  }
</script>

<div class="flex gap-2 items-end">
  <button
    type="button"
    class="btn btn-ghost btn-square"
    onclick={() => fileInput.click()}
    disabled={isSending}
    title="Attach file"
  >
    📎
  </button>
  <input
    type="file"
    bind:this={fileInput}
    class="hidden"
    accept="image/*,.pdf,.doc,.docx"
    onchange={handleFileSelect}
  >

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
