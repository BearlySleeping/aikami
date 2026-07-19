<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai_privacy/ai_privacy_view.svelte
import type { AIPrivacyViewModelInterface } from './ai_privacy_view_model.svelte';

type Props = {
  viewModel: AIPrivacyViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="space-y-6">
  <!-- ── AI Connection Status ── -->
  <div>
    <h3 class="text-lg font-semibold mb-3">AI Connection</h3>

    {#if viewModel.aiConnectionStatus === 'loading'}
      <div class="flex items-center gap-3">
        <span class="loading loading-spinner loading-sm"></span>
        <span class="text-base-content/60">Loading configuration…</span>
      </div>
    {:else if viewModel.aiConnectionStatus === 'connected'}
      <div class="flex items-center gap-3 mb-3">
        <span class="badge badge-success gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          Connected
        </span>
        {#if viewModel.activeProviderLabel}
          <span class="text-sm text-base-content/60">via {viewModel.activeProviderLabel}</span>
        {/if}
      </div>
      <p class="text-sm text-base-content/60 mb-2">
        Your AI provider is configured and ready. Advanced settings are available in the AI Engine
        section when Advanced mode is enabled.
      </p>
    {:else if viewModel.aiConnectionStatus === 'offline'}
      <div class="flex items-center gap-3 mb-3">
        <span class="badge badge-warning gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          Offline
        </span>
      </div>
      <p class="text-sm text-base-content/60 mb-2">
        AI is configured but the service appears to be unreachable. Check your connection or the
        provider endpoint.
      </p>
    {:else}
      <!-- not_configured -->
      <div class="flex items-center gap-3 mb-4">
        <span class="badge badge-ghost gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Not Configured
        </span>
      </div>
      <p class="text-sm text-base-content/60 mb-4">
        No AI provider is connected yet. Connect one to enable AI-powered NPCs, dialogue generation,
        and dynamic storytelling — or keep playing offline.
      </p>
      <button type="button" class="btn btn-primary btn-sm" onclick={() => viewModel.connectAi()}>
        Connect AI Provider
      </button>
    {/if}
  </div>

  <div class="divider"></div>

  <!-- ── Offline Mode ── -->
  <div class="flex items-center justify-between">
    <div>
      <h4 class="font-medium">Play Offline</h4>
      <p class="text-sm text-base-content/60">
        Disable all AI calls — even if a provider is configured.
      </p>
    </div>
    <input
      type="checkbox"
      class="toggle toggle-primary"
      checked={viewModel.offlineMode}
      onchange={() => viewModel.toggleOfflineMode()}
      aria-label="Play Offline — disable all AI calls"
    >
  </div>

  <!-- ── Telemetry Opt-Out ── -->
  <div class="flex items-center justify-between">
    <div>
      <h4 class="font-medium">Telemetry</h4>
      <p class="text-sm text-base-content/60">Share anonymous usage data to help improve Aikami.</p>
    </div>
    <input
      type="checkbox"
      class="toggle toggle-primary"
      checked={!viewModel.telemetryOptOut}
      onchange={() => viewModel.toggleTelemetry()}
      aria-label="Telemetry — share anonymous usage data"
    >
  </div>
</div>
