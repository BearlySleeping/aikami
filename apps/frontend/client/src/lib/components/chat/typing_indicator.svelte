<script lang="ts">
  /**
   * Props for the TypingIndicator component.
   * Animated indicator shown when the AI is typing a response.
   */
  type Props = {
    /** Whether to show the typing indicator */
    visible?: boolean;
    /** Label text to display next to indicator */
    label?: string;
  };

  let { visible = false, label = 'AI is typing' }: Props = $props();
</script>

{#if visible}
  <div class="chat chat-start">
    <div class="chat-bubble chat-bubble-secondary flex items-center gap-1 py-3">
      <span class="flex gap-1">
        <span
          class="w-2 h-2 bg-current rounded-full animate-bounce"
          style="animation-delay: 0ms;"
        ></span>
        <span
          class="w-2 h-2 bg-current rounded-full animate-bounce"
          style="animation-delay: 150ms;"
        ></span>
        <span
          class="w-2 h-2 bg-current rounded-full animate-bounce"
          style="animation-delay: 300ms;"
        ></span>
      </span>
      <span class="text-xs opacity-70 ml-2">{label}</span>
    </div>
  </div>
{/if}
