<script lang="ts">
// packages/frontend/components/src/lib/voice-model-download/voice_model_download.svelte
//
// Reusable voice model download UI section. Renders the appropriate state
// (idle, downloading/verifying, ready, error) based on the provided state
// and delegates user actions via callbacks.

import type { VoiceModelState } from '@aikami/types';

type Props = {
  /** Whether to show this section at all. */
  show: boolean;
  /** Current voice model download state. */
  state: VoiceModelState;
  /** Download progress (0–100). */
  progress: number;
  /** Human-readable model size label (e.g. "88.2 MB"). */
  sizeLabel: string;
  /** Fired when the user clicks the download button. */
  ondownload?: () => void;
  /** Fired when the user clicks the cancel button. */
  oncancel?: () => void;
};

let { show, state, progress, sizeLabel, ondownload, oncancel }: Props = $props();
</script>

{#if show}
  <div class="divider text-sm text-base-content/60">Or download the local voice model</div>
  <div class="flex flex-col gap-2 p-3 bg-base-200 rounded-box">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">Kokoro TTS Model</span>
      <span class="text-xs text-base-content/50">{sizeLabel}</span>
    </div>
    {#if state.status === 'downloading' || state.status === 'verifying'}
      <progress class="progress progress-primary w-full" value={progress} max="100"></progress>
      <div class="flex gap-2">
        <button type="button" class="btn btn-sm btn-outline flex-1" onclick={oncancel}>
          Cancel
        </button>
      </div>
    {:else if state.status === 'ready'}
      <p class="text-xs text-success">✓ Voice model ready</p>
    {:else if state.status === 'error'}
      <p class="text-xs text-error">{state.message || 'Download failed'}</p>
    {:else}
      <button type="button" class="btn btn-sm btn-primary" onclick={ondownload}>
        Download Voice Model
      </button>
    {/if}
  </div>
{/if}
