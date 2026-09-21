<script lang="ts">
// packages/frontend/components/src/lib/capability_error_banner/capability_error_banner.svelte

type Props = {
  error: { title: string; message: string } | null;
  ondismiss: () => void;
  onsettings: () => void;
};

let { error, ondismiss, onsettings }: Props = $props();
</script>

{#if error}
  <div
    class="rounded-xl border border-error/30 bg-error/10 p-3"
    role="alert"
    data-testid="capability-error"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="text-sm font-semibold text-error">{error.title}</p>
        <p class="mt-0.5 text-xs text-base-content/80">{error.message}</p>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs shrink-0 text-base-content/50"
        onclick={ondismiss}
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
    <button type="button" class="btn btn-primary btn-sm mt-2 w-full" onclick={onsettings}>
      Fix in Settings
    </button>
  </div>
{/if}
