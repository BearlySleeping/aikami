<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/webgpu_recommendation.svelte
//
// The "your browser can't use WebGPU" advisory. Shown on the start menu
// only, only when the shared adapter probe came back negative, and only
// until the player dismisses it — the dismissal is persisted by
// WebGpuSupportService, so this never reappears on its own.
//
// Copy is deliberately short and non-alarming: a missing GPU backend costs
// the player speed on local models, not correctness. Nothing here is a
// blocker, and the game is fully playable without WebGPU — the banner says
// so in the link label rather than implying a problem must be fixed.
type Props = {
  /** Public compatibility checker to send the player to. */
  checkUrl: string;
  onDismiss: () => void;
};

let { checkUrl, onDismiss }: Props = $props();
</script>

<div
  class="flex w-full items-start gap-2 rounded-lg border border-base-content/10 bg-base-200/60 px-3 py-2"
  data-testid="webgpu-recommendation"
  role="status"
>
  <svg
    class="mt-0.5 h-4 w-4 shrink-0 text-warning"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path
      d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>

  <div class="min-w-0 flex-1">
    <p class="text-[11px] leading-snug text-base-content/70">
      WebGPU is unavailable, so local speech and text models run slower on the CPU.
      <a
        href={checkUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="link link-primary no-underline hover:underline"
      >
        Check compatibility
      </a>
    </p>
  </div>

  <button
    type="button"
    class="btn btn-ghost btn-xs -mt-0.5 h-auto min-h-0 px-1.5 py-0.5 text-base-content/40 hover:text-base-content"
    aria-label="Dismiss WebGPU recommendation"
    onclick={onDismiss}
  >
    <svg
      class="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
</div>
