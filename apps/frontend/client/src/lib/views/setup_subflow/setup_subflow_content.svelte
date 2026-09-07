<script lang="ts">
// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_content.svelte
//
// Presentation for the setup steps. Every label, glyph and class comes from
// the ViewModel — the markup holds no conditionals, transformations or
// derived state (svelte-conventions § View Structural Constraints).

import AiConnectionModals from '../settings/ai/ai_connection_modals.svelte';
import type { SetupSubflowViewModelInterface } from './setup_subflow_view_model.svelte';

type Props = {
  viewModel: SetupSubflowViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel.isEntryStep}
  <!-- The three paths diverge immediately, so each button says what it does. -->
  <div class="flex flex-col gap-3">
    <button
      type="button"
      class="btn btn-primary h-auto flex-col items-start gap-0.5 py-3 text-left normal-case"
      onclick={() => viewModel.selectRecommended()}
    >
      <span class="font-semibold">Find AI for me</span>
      <span class="text-xs font-normal opacity-80">
        Looks for AI you can already use, then suggests a setup.
      </span>
    </button>
    <button
      type="button"
      class="btn btn-outline h-auto flex-col items-start gap-0.5 py-3 text-left normal-case"
      onclick={() => viewModel.selectExisting()}
    >
      <span class="font-semibold">I'll enter my own provider</span>
      <span class="text-xs font-normal opacity-70">
        Enter a service and API key, or the address of a server you run.
      </span>
    </button>
    <button
      type="button"
      class="btn btn-ghost h-auto flex-col items-start gap-0.5 py-3 text-left normal-case"
      onclick={() => viewModel.selectTextOnly()}
    >
      <span class="font-semibold">Just the story, nothing else</span>
      <span class="text-xs font-normal opacity-70">
        Set up text only and start playing. Artwork and read-aloud can wait.
      </span>
    </button>
  </div>
{:else if viewModel.isDetectingStep}
  <div class="flex flex-col items-center gap-3 py-8">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="text-sm text-base-content/60">Looking for AI providers…</p>
    <button type="button" class="btn btn-ghost btn-xs" onclick={() => viewModel.goBack()}>
      Cancel
    </button>
  </div>
{:else if viewModel.isPlanStep}
  <!-- The review hub: what is set up, what was found, what can still be added.
       Always reachable, so a wrong connection can be corrected here. -->
  <div class="flex flex-col gap-4">
    {#if viewModel.requiredRow}
      {@const row = viewModel.requiredRow}
      <div>
        <p class="mb-2 text-sm font-medium text-base-content/70">Required</p>
        <div class="rounded-lg border border-base-300 p-3">
          <div class="flex items-center gap-3">
            <span class="text-lg">{row.icon}</span>
            <div class="flex-1">
              <p class="text-sm font-medium">{row.label}</p>
              <p class="text-xs text-base-content/50">{row.statusText}</p>
            </div>
            <button
              type="button"
              class={row.actionButtonClass}
              onclick={() => viewModel.openManualSetup(row.id)}
            >
              {row.actionLabel}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <div>
      <p class="mb-2 text-sm font-medium text-base-content/70">Optional</p>
      <div class="space-y-2">
        {#each viewModel.optionalRows as row (row.id)}
          <div class="rounded-lg border border-base-300 p-3">
            <div class="flex items-center gap-3">
              <input
                type="checkbox"
                class="checkbox checkbox-primary checkbox-sm"
                checked={row.checked}
                aria-label={row.label}
                onchange={() => viewModel.toggleCapability(row.id)}
              >
              <div class="flex-1">
                <p class="text-sm font-medium">{row.label}</p>
                <p class="text-xs text-base-content/50">{row.statusText}</p>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onclick={() => viewModel.openManualSetup(row.id)}
              >
                {row.actionLabel}
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if viewModel.showNoProvidersMessage}
      <div class="rounded-lg border border-dashed border-base-300 p-4 text-center">
        <p class="text-sm text-base-content/50">{viewModel.noProvidersMessage}</p>
      </div>
    {/if}

    {#if viewModel.hasDiscoveredProviders}
      <div>
        <p class="mb-2 text-sm font-medium text-base-content/70">Found on your network</p>
        <div class="space-y-2">
          {#each viewModel.discoveredProviders as provider (provider.key)}
            <div class="rounded-lg border border-base-300 bg-base-200 p-3">
              <div class="flex items-center gap-2">
                <span class="text-lg">{provider.icon}</span>
                <div>
                  <p class="text-sm font-medium">{provider.label}</p>
                  <p class="text-xs text-base-content/50">{provider.detailText}</p>
                </div>
                {#if provider.isCompatible}
                  <span class="badge badge-success badge-xs ml-auto">Compatible</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if viewModel.hasResourceWarnings}
      <div class="space-y-1">
        {#each viewModel.resourceWarnings as warning}
          <div class="alert alert-warning py-2 text-sm">
            <span>{warning}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        disabled={viewModel.isDetecting}
        onclick={() => viewModel.rescan()}
      >
        {#if viewModel.isDetecting}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        Scan again
      </button>
      <div class="flex-1"></div>
      <button type="button" class="btn btn-outline" onclick={() => viewModel.goBack()}>Back</button>
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => viewModel.applyPlan()}
        disabled={viewModel.isContinueDisabled}
      >
        {#if viewModel.isApplying}
          <span class="loading loading-spinner loading-xs"></span>
          Applying…
        {:else}
          Continue
        {/if}
      </button>
    </div>
    {#if viewModel.hasBlockedHint}
      <p class="text-center text-xs text-base-content/50">{viewModel.blockedHint}</p>
    {/if}
  </div>
{:else if viewModel.isManualStep}
  <div class="flex flex-col gap-4">
    <p class="text-sm text-base-content/60">
      Enter your provider's details in the editor. Close it when you're done and your connection
      will appear in the review below.
    </p>
    <button type="button" class="btn btn-primary" onclick={() => viewModel.reopenManualEditor()}>
      Open Connection Editor
    </button>
    <AiConnectionModals viewModel={viewModel.editorViewModel} />
    <div class="flex gap-2">
      <button type="button" class="btn btn-outline flex-1" onclick={() => viewModel.goBack()}>
        Back
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        onclick={() => viewModel.finishManualSetup()}
      >
        Continue
      </button>
    </div>
  </div>
{:else if viewModel.isApplyingStep}
  <div class="flex flex-col items-center gap-3 py-8">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="text-sm text-base-content/60">Applying configuration…</p>
  </div>
{:else if viewModel.isReadyStep}
  <div class="flex flex-col items-center gap-4 py-4">
    <div class="text-4xl">✅</div>
    <h2 class="text-lg font-semibold">Ready to Play!</h2>
    <p class="text-center text-sm text-base-content/60">{viewModel.readyMessage}</p>
    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary" onclick={() => viewModel.leave()}>
        Continue
      </button>
      <button type="button" class="btn btn-outline" onclick={() => viewModel.reviewSetup()}>
        Review setup
      </button>
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => viewModel.reset()}>
        Start over
      </button>
    </div>
  </div>
{:else if viewModel.isErrorStep}
  <div class="flex flex-col items-center gap-4 py-4">
    <div class="alert alert-error">
      <span>{viewModel.displayErrorMessage}</span>
    </div>
    <div class="flex gap-2">
      <button type="button" class="btn btn-outline" onclick={() => viewModel.retry()}>Retry</button>
      <button type="button" class="btn btn-ghost" onclick={() => viewModel.goBack()}>
        Go Back
      </button>
    </div>
  </div>
{/if}
