<script lang="ts">
  // apps/frontend/client/src/lib/components/agent/agent_thought_bubble.svelte
  import type { ThoughtBubble } from '$types/agent_types';

  type Props = {
    bubble: ThoughtBubble;
  };

  const { bubble }: Props = $props();

  const phaseClass = (() => {
    if (bubble.phase === 'pre') {
      return 'badge-info';
    }
    if (bubble.phase === 'post') {
      return 'badge-accent';
    }
    return 'badge-ghost';
  })();

  const formattedTime = (() => {
    const d = new Date(bubble.timestamp);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  })();
</script>

<div class="chat chat-start">
  <div class="chat-header flex items-center gap-2 mb-1">
    <span class="font-mono text-xs font-semibold text-base-content">{bubble.agentName}</span>
    <span class="badge badge-xs {phaseClass}">{bubble.phase}</span>
    <time class="text-xs text-base-content/40 font-mono">{formattedTime}</time>
  </div>
  <div class="chat-bubble chat-bubble-accent text-sm">{bubble.text}</div>
</div>
