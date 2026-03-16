<script lang="ts">
  // apps/frontend/pwa/src/lib/components/chat/AffectionMeter.svelte
  type Props = {
    value?: number;
    maxValue?: number;
    level?: 'hostile' | 'neutral' | 'friendly' | 'romantic';
    showLabel?: boolean;
  };

  let { value = 0, maxValue = 100, level = 'neutral', showLabel = true }: Props = $props();

  const percentage = $derived(Math.max(0, Math.min(100, (value / maxValue) * 100)));

  const levelConfig = $derived(() => {
    switch (level) {
      case 'hostile':
        return { emoji: '😠', color: 'bg-error', label: 'Hostile' };
      case 'neutral':
        return { emoji: '😐', color: 'bg-warning', label: 'Neutral' };
      case 'friendly':
        return { emoji: '😊', color: 'bg-success', label: 'Friendly' };
      case 'romantic':
        return { emoji: '💕', color: 'bg-pink-500', label: 'Romantic' };
    }
  });

  const config = $derived(levelConfig());
</script>

<div class="flex items-center gap-2">
  {#if showLabel}
    <span class="text-sm">{config.emoji}</span>
  {/if}
  <div class="flex-grow">
    <progress class="progress {config.color} w-full" value={percentage} max="100"></progress>
  </div>
  <span class="text-xs opacity-70">{value}/{maxValue}</span>
</div>
