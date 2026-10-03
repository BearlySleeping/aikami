<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/decision/decision_settings_view.svelte
//
// Settings → Decisions / System One (issue #381).
//
// The layout exists to keep three promises apart on screen:
//   · configured  ≠  ready      (a saved backend has not answered anything yet)
//   · ready       ≠  qualified (a sample decision is not a task measurement)
//   · qualified   is not reachable from this screen, and says so.

import { BaseViewModelContainer } from '$components';
import type { DecisionSettingsViewModelInterface } from './decision_settings_view_model.svelte';

type Props = { viewModel: DecisionSettingsViewModelInterface };
let { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="max-w-3xl mx-auto space-y-6">
  <section class="space-y-1">
    <h2 class="font-mono text-lg font-bold text-[#cabeff]">{viewModel.title}</h2>
    <p class="text-xs text-[#938ea1] font-sans">{viewModel.subtitle}</p>
  </section>

  <!-- ═══ State ═══════════════════════════════════════════════════════════ -->
  <section class="card card-bordered border-white/[0.08] bg-base-100/50">
    <div class="card-body p-4 space-y-2">
      <div class="flex items-center gap-3">
        <span class="text-lg {viewModel.stateDescriptor.textColorClass}">
          {viewModel.stateDescriptor.dot}
        </span>
        <span class="font-mono text-sm font-semibold">{viewModel.stateDescriptor.label}</span>
        <span class="badge badge-xs font-mono {viewModel.stateDescriptor.colorClass}">
          {viewModel.summary.state}
        </span>
      </div>
      <p class="text-xs text-[#938ea1] font-sans">{viewModel.stateDescriptor.meaning}</p>

      {#if viewModel.configured}
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2 font-mono text-xs">
          <dt class="text-[#938ea1]/60">Runtime</dt>
          <dd>{viewModel.summary.runtimeLabel}</dd>
          <dt class="text-[#938ea1]/60">Endpoint</dt>
          <dd class="break-all">{viewModel.summary.endpointLabel}</dd>
          <dt class="text-[#938ea1]/60">Checkpoint</dt>
          <dd>{viewModel.summary.checkpoint}</dd>
          <dt class="text-[#938ea1]/60">Credential</dt>
          <dd>{viewModel.credentialSummary}</dd>
        </dl>
      {/if}

      <div class="flex flex-wrap gap-2 pt-3">
        <button
          type="button"
          class="btn btn-xs font-mono border-[#00e3fd]/30 text-[#00e3fd]"
          disabled={viewModel.testDisabled}
          onclick={() => viewModel.test()}
        >
          {viewModel.testLabel}
        </button>
        {#if viewModel.configured}
          <button
            type="button"
            class="btn btn-ghost btn-xs font-mono text-[10px] text-error/70"
            onclick={() => viewModel.disable()}
          >
            Disable
          </button>
        {/if}
      </div>

      {#if viewModel.readinessMessage}
        <div class="mt-2 rounded border border-white/[0.06] bg-base-100/40 p-3">
          <p class="font-mono text-[10px] uppercase tracking-wider text-[#938ea1]/60">
            Sample inference
          </p>
          <p class="text-xs text-[#cabeff] font-sans mt-1">{viewModel.readinessMessage}</p>
          {#if viewModel.hasSetupSteps}
            <ul class="mt-2 space-y-1">
              {#each viewModel.setupSteps as step (step)}
                <li class="text-[11px] text-[#938ea1] font-sans">· {step.detail}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <!-- ═══ Configuration ════════════════════════════════════════════════════ -->
  <section class="card card-bordered border-white/[0.08] bg-base-100/50">
    <div class="card-body p-4 space-y-3">
      <label class="form-control w-full">
        <span class="label-text font-mono text-xs text-[#938ea1]">Backend</span>
        <select
          class="select select-sm select-bordered bg-base-100 font-mono text-xs"
          value={viewModel.draft.registryId}
          onchange={(event) => viewModel.setProvider(event.currentTarget.value)}
        >
          {#each viewModel.providerOptions as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </label>

      {#if viewModel.selectedProvider}
        <p class="text-[11px] text-[#938ea1] font-sans">{viewModel.selectedProvider.description}</p>
        <button
          type="button"
          class="text-left font-mono text-[10px] text-[#00e3fd]/70 hover:underline self-start"
          onclick={() => viewModel.toggleDocs()}
        >
          {viewModel.docsToggleLabel}
        </button>
        {#if viewModel.showDocs}
          <p class="font-mono text-[10px] text-[#938ea1] break-all">
            {viewModel.selectedProvider.docsUrl}
          </p>
        {/if}
      {/if}

      <label class="form-control w-full">
        <span class="label-text font-mono text-xs text-[#938ea1]">Endpoint</span>
        <input
          type="text"
          class="input input-sm input-bordered bg-base-100 font-mono text-xs"
          placeholder="http://127.0.0.1:11434"
          value={viewModel.draft.endpoint}
          oninput={(event) => viewModel.setEndpoint(event.currentTarget.value)}
        >
      </label>

      <label class="form-control w-full">
        <span class="label-text font-mono text-xs text-[#938ea1]">Decision checkpoint</span>
        <input
          type="text"
          class="input input-sm input-bordered bg-base-100 font-mono text-xs"
          placeholder="nimble"
          value={viewModel.draft.checkpoint}
          oninput={(event) => viewModel.setCheckpoint(event.currentTarget.value)}
        >
        <span class="label-text-alt text-[10px] text-[#938ea1]/60 font-sans">
          A decision checkpoint only. A chat model on the same server cannot answer bounded
          questions and will not be accepted here.
        </span>
      </label>

      {#if viewModel.showCredentialField}
        <label class="form-control w-full">
          <span class="label-text font-mono text-xs text-[#938ea1]">
            {viewModel.credentialLabel}
          </span>
          <div class="join w-full">
            <input
              type={viewModel.credentialInputType}
              class="input input-sm input-bordered bg-base-100 font-mono text-xs join-item flex-1"
              value={viewModel.draft.credential}
              oninput={(event) => viewModel.setCredential(event.currentTarget.value)}
            >
            <button
              type="button"
              class="btn btn-sm join-item font-mono text-[10px]"
              onclick={() => viewModel.toggleCredential()}
            >
              {viewModel.credentialToggleLabel}
            </button>
          </div>
          <span class="label-text-alt text-[10px] text-[#938ea1]/60 font-sans">
            Stored encrypted in the local vault. It is sent only to the endpoint above.
          </span>
        </label>
      {/if}

      <div class="flex items-center gap-3 pt-1">
        <button
          type="button"
          class="btn btn-sm font-mono text-xs border-[#00e3fd]/40 text-[#00e3fd]"
          onclick={() => viewModel.save()}
        >
          Save
        </button>
        {#if viewModel.saveBlockedReason}
          <span class="text-[11px] text-[#938ea1] font-sans">{viewModel.saveBlockedReason}</span>
        {/if}
      </div>
    </div>
  </section>

  <!-- ═══ Tasks and the gameplay gate ══════════════════════════════════════ -->
  <section class="card card-bordered border-white/[0.08] bg-base-100/50">
    <div class="card-body p-4 space-y-2">
      <h3 class="font-mono text-sm font-semibold text-[#cabeff]">Supported tasks</h3>
      <ul class="space-y-2">
        {#each viewModel.taskRows as task (task.id)}
          <li class="text-xs font-sans">
            <div class="flex items-center gap-2">
              <span class="font-mono">{task.label}</span>
              <span class="badge badge-xs font-mono {task.badgeClass}">
                {task.qualificationLabel}
              </span>
            </div>
            <p class="text-[11px] text-[#938ea1]">{task.description}</p>
          </li>
        {/each}
      </ul>

      <div class="mt-2 rounded border border-white/[0.06] bg-base-100/40 p-3">
        <p class="font-mono text-[10px] uppercase tracking-wider text-[#938ea1]/60">
          Automatic gameplay routing
        </p>
        <p class="text-xs text-[#938ea1] font-sans mt-1">{viewModel.gameplayRouting.reason}</p>

        <!-- Off / Shadow / On. Shadow is deliberately ungated: it discards its
             result, so it cannot change the game and does not need a
             qualification. `on` is refused with the reason spelled out. -->
        <fieldset class="mt-3 space-y-2" disabled={!viewModel.configured}>
          <legend class="font-mono text-[10px] uppercase tracking-wider text-[#938ea1]/60">
            Gameplay mode
          </legend>
          {#each viewModel.gameplayModeOptions as option (option.mode)}
            <label
              class="flex items-start gap-2 text-xs font-sans
                {option.allowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}"
            >
              <input
                type="radio"
                name="decision-gameplay-mode"
                class="radio radio-xs mt-0.5"
                value={option.mode}
                checked={option.selected}
                disabled={!option.allowed}
                onchange={() => viewModel.setGameplayMode(option.mode)}
              >
              <span>
                <span class="font-mono">{option.mode}</span>
                <span class="block text-[11px] text-[#938ea1]">{option.detail}</span>
              </span>
            </label>
          {/each}
        </fieldset>
      </div>
    </div>
  </section>
</BaseViewModelContainer>
