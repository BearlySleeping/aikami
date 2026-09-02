<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/asset_download_status.svelte
//
// The start menu's asset-download strip (C-448). Four shapes, one slot:
// an opt-in offer, live progress, a done chip, and a retryable error. The
// parent decides *when* this renders — the ViewModel holds it back until the
// pipeline has settled so it never flashes on a warm-cache load.
import type { AssetDownloadStatus } from '../start_view_model.svelte';

type Props = {
  status: AssetDownloadStatus;
  ondownload: () => void;
  onretry: () => void;
};

let { status, ondownload, onretry }: Props = $props();
</script>

<div class="w-full text-center" data-testid="download-indicator" data-kind={status.kind}>
  {#if status.kind === 'offer'}
    <button
      type="button"
      class="btn btn-ghost btn-xs gap-1.5 font-normal text-base-content/50 hover:text-base-content"
      onclick={ondownload}
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path
          d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {status.label}
    </button>
  {:else if status.kind === 'progress'}
    <div class="mx-auto w-full max-w-xs text-left">
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-base-content/50">{status.label}</span>
        {#if status.percentLabel}
          <span class="font-mono text-[11px] tabular-nums text-base-content/40"
            >{status.percentLabel}</span
          >
        {/if}
      </div>
      {#if status.fraction === undefined}
        <progress class="progress progress-primary h-1 w-full"></progress>
      {:else}
        <progress
          class="progress progress-primary h-1 w-full"
          value={status.fraction}
          max="1"
        ></progress>
      {/if}
    </div>
  {:else if status.kind === 'complete'}
    <span class="inline-flex items-center gap-1.5 text-[11px] text-success/80">
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {status.label}
    </span>
  {:else}
    <div class="inline-flex items-center gap-2 text-[11px] text-warning">
      <span>{status.label}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs h-auto min-h-0 px-1.5 py-0.5 text-warning"
        onclick={onretry}
      >
        Retry
      </button>
    </div>
  {/if}
</div>
