<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/capability_detail_content.svelte
//
// Stateless presentation for capability status and setup actions. Mounts
// the same shared connection editor used by the full AI Settings page and
// onboarding — one editor, three hosts. Capability-specific controls (voice
// archetypes, image presets) live here so text, image and voice each have
// their own focused settings section.

import { Image } from '$components';
import AiConnectionModals from './ai_connection_modals.svelte';
import type { CapabilityDetailViewModelInterface } from './capability_detail_view_model.svelte';

type Props = {
  viewModel: CapabilityDetailViewModelInterface;
};

const { viewModel }: Props = $props();
const aiVm = $derived(viewModel.aiSettingsViewModel);
const capabilityConnections = $derived(aiVm.connectionsForCapability(viewModel.capability));
const capabilityRoles = $derived(aiVm.rolesForCapability(viewModel.capability));
let connectionSettingsOpen = $state(false);
let advancedOpen = $state(false);
</script>

<div class="max-w-2xl mx-auto space-y-6">
  <!-- Status card -->
  <div class="card card-bordered border-base-300 bg-base-100">
    <div class="card-body">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold">Status</h2>
          <p class="text-sm text-base-content/60 mt-1">
            {#if viewModel.isConfigured}
              {viewModel.providerLabel}
              {#if viewModel.modelName}
                · {viewModel.modelName}
              {/if}
            {:else}
              Not configured
            {/if}
          </p>
        </div>
        <span class="badge {viewModel.statusColor}">{viewModel.statusLabel}</span>
      </div>
    </div>
  </div>

  <!-- Actions -->
  <div class="flex gap-3">
    {#if viewModel.isConfigured}
      <button type="button" class="btn btn-primary" onclick={() => viewModel.openChange()}>
        Change
      </button>
      <button
        type="button"
        class="btn btn-outline"
        onclick={() => viewModel.testConnection()}
        disabled={viewModel.isTesting}
      >
        {viewModel.isTesting ? 'Testing…' : 'Test Connection'}
      </button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={() => viewModel.openSetup()}>
        Set Up
      </button>
    {/if}
  </div>

  <!-- Connection settings (every capability) -->
  {#if capabilityConnections.length > 0}
    <div class="card card-bordered border-base-300 bg-base-100">
      <div class="card-body p-4 space-y-3">
        <button
          type="button"
          class="btn btn-ghost btn-sm justify-start w-full font-normal"
          onclick={() => (connectionSettingsOpen = !connectionSettingsOpen)}
        >
          {connectionSettingsOpen ? '▾' : '▸'}
          Connection settings
        </button>
        {#if connectionSettingsOpen}
          {#each capabilityConnections as conn (conn.id)}
            <div class="flex items-center justify-between gap-3 border-t border-base-200 pt-2">
              <div class="min-w-0">
                <p class="text-sm font-semibold truncate">{conn.label}</p>
                {#if conn.model}
                  <p class="text-xs font-mono text-base-content/50 truncate">{conn.model}</p>
                {/if}
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  onclick={() => aiVm.openEditConnection(conn.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => aiVm.deleteConnection(conn.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Advanced (per-role connections) -->
    <div class="card card-bordered border-base-300 bg-base-100">
      <div class="card-body p-4 space-y-3">
        <button
          type="button"
          class="btn btn-ghost btn-sm justify-start w-full font-normal"
          onclick={() => (advancedOpen = !advancedOpen)}
        >
          {advancedOpen ? '▾' : '▸'}
          Advanced
        </button>
        {#if advancedOpen}
          <p class="text-xs text-base-content/60">
            {#if viewModel.capability === 'text'}
              Use different models for narration and dialogue.
            {:else if viewModel.capability === 'voice'}
              Use different voices for the narrator and characters.
            {:else}
              Use different sources for portraits and scenes.
            {/if}
          </p>
          {#each capabilityRoles as role (role)}
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-mono text-base-content/70 capitalize">{role}</span>
              <select
                class="select select-bordered select-xs font-mono max-w-[60%]"
                value={aiVm.connectionIdForRole(role) ?? ''}
                onchange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value) {
                    aiVm.assignRole(role, value);
                  } else {
                    aiVm.clearRole(role);
                  }
                }}
              >
                <option value="">— Default —</option>
                {#each capabilityConnections as conn (conn.id)}
                  <option value={conn.id}>{conn.label}</option>
                {/each}
              </select>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Voice-specific controls (Read Aloud) -->
  {#if viewModel.capability === 'voice'}
    {@const ai = viewModel.aiSettingsViewModel}
    {#if ai.voiceConnections.length === 0}
      <p class="text-sm text-base-content/60 font-sans italic">
        No voice connection yet — set one up above to assign voices.
      </p>
    {:else}
      <div class="card card-bordered border-base-300 bg-base-100">
        <div class="card-body p-4 space-y-3">
          <h3 class="font-mono text-sm font-semibold">Voice settings</h3>

          <div class="flex items-center gap-4">
            <label class="text-xs font-mono text-base-content/60 flex-1" for="voice-speed">
              Speed ({ai.voiceSpeed.toFixed(2)}x)
              <input
                id="voice-speed"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                class="range range-xs w-full"
                value={ai.voiceSpeed}
                oninput={(e) => ai.setVoiceSpeed(Number((e.target as HTMLInputElement).value))}
                onchange={() => ai.commitConfigChanges()}
              >
            </label>
            <label class="text-xs font-mono text-base-content/60 flex-1" for="voice-pitch">
              Pitch ({ai.voicePitch})
              <input
                id="voice-pitch"
                type="range"
                min="-12"
                max="12"
                step="1"
                class="range range-xs w-full"
                value={ai.voicePitch}
                oninput={(e) => ai.setVoicePitch(Number((e.target as HTMLInputElement).value))}
                onchange={() => ai.commitConfigChanges()}
              >
            </label>
          </div>

          <div class="space-y-2">
            {#each ai.voiceArchetypes as archetype (archetype.id)}
              <div class="flex items-center gap-2 text-xs font-mono">
                <span class="w-32 text-base-content/60">{archetype.label}</span>
                <input
                  type="text"
                  class="input input-bordered input-xs flex-1"
                  aria-label={ai.voiceIdInputLabelFor(archetype.label)}
                  value={archetype.voiceId}
                  oninput={(e) =>
                    ai.setVoiceArchetype(archetype.id, (e.target as HTMLInputElement).value)}
                  onchange={() => ai.commitConfigChanges()}
                >
                {#if ai.voicePreviewState.status === 'synthesizing' || ai.voicePreviewState.status === 'playing'}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-primary"
                    onclick={() => ai.stopVoicePreview()}
                  >
                    {ai.voicePreviewState.status === 'synthesizing' ? '… Synthesizing' : '■ Stop'}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-primary"
                    onclick={() => ai.previewVoiceArchetype(archetype.id)}
                  >
                    ▶ Preview
                  </button>
                {/if}
              </div>
            {/each}
          </div>

          {#if ai.voicePreviewState.status === 'error'}
            <p class="text-xs text-error">{ai.voicePreviewState.error}</p>
          {/if}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Image-specific controls (Artwork) -->
  {#if viewModel.capability === 'image'}
    {@const ai = viewModel.aiSettingsViewModel}
    {#if ai.imageConnections.length === 0}
      <p class="text-sm text-base-content/60 font-sans italic">
        No image connection yet — set one up above to configure it.
      </p>
    {:else}
      {#each ai.imageConnections as conn (conn.id)}
        <div class="card card-bordered border-base-300 bg-base-100">
          <div class="card-body p-4 space-y-3">
            <h3 class="font-mono text-sm font-semibold">{conn.label}</h3>

            <div class="flex gap-2">
              {#each ai.imageSizePresets as preset}
                <button
                  type="button"
                  class="btn btn-xs font-mono"
                  onclick={() => ai.setImageSizePreset(conn.id, preset.id)}
                >
                  {preset.label}
                </button>
              {/each}
            </div>

            <div class="flex gap-2">
              {#each ai.imageQualityLevels as level}
                <button
                  type="button"
                  class="btn btn-xs font-mono"
                  onclick={() => ai.setImageQuality(conn.id, level.id)}
                >
                  {level.label}
                </button>
              {/each}
            </div>

            <button
              type="button"
              class="btn btn-ghost btn-xs font-mono text-[10px] text-base-content/60 w-fit"
              onclick={() => ai.toggleImageAdvanced(conn.id)}
            >
              {ai.isImageAdvancedOpenFor(conn.id) ? '▾' : '▸'}
              Advanced (raw steps/cfg)
            </button>
            {#if ai.isImageAdvancedOpenFor(conn.id)}
              <div class="flex gap-4 text-xs font-mono text-base-content/60">
                <label for={`steps-${conn.id}`}>
                  Steps
                  <input
                    id={`steps-${conn.id}`}
                    type="number"
                    class="input input-bordered input-xs w-20"
                    value={ai.imageParamsFor(conn.id).steps}
                    oninput={(e) =>
                      ai.setImageParamField(
                        conn.id,
                        'steps',
                        Number((e.target as HTMLInputElement).value),
                      )}
                    onchange={() => ai.commitConfigChanges()}
                  >
                </label>
                <label for={`cfg-${conn.id}`}>
                  CFG
                  <input
                    id={`cfg-${conn.id}`}
                    type="number"
                    class="input input-bordered input-xs w-20"
                    value={ai.imageParamsFor(conn.id).cfg}
                    oninput={(e) =>
                      ai.setImageParamField(
                        conn.id,
                        'cfg',
                        Number((e.target as HTMLInputElement).value),
                      )}
                    onchange={() => ai.commitConfigChanges()}
                  >
                </label>
              </div>
            {/if}

            <div class="flex gap-2">
              <select
                class="select select-bordered select-xs font-mono"
                aria-label="Image checkpoint"
                value={ai.imageParamsFor(conn.id).checkpoint}
                onchange={(e) =>
                  ai.setImageCheckpoint(conn.id, (e.target as HTMLSelectElement).value)}
              >
                {#each ai.imageCheckpoints as checkpoint}
                  <option value={checkpoint}>{checkpoint}</option>
                {/each}
              </select>

              <select
                class="select select-bordered select-xs font-mono"
                aria-label="Image style profile"
                value={ai.activeStyleProfileId}
                onchange={(e) =>
                  ai.setImageStyleProfile((e.target as HTMLSelectElement).value)}
              >
                {#each ai.imageStyleProfiles as profile}
                  <option value={profile.id}>{profile.label}</option>
                {/each}
              </select>

              <button
                type="button"
                class="btn btn-xs btn-primary font-mono"
                disabled={ai.imagePreviewStateFor(conn.id).status === 'generating'}
                onclick={() => ai.previewImage(conn.id)}
              >
                {ai.imagePreviewStateFor(conn.id).status === 'generating'
                  ? 'Generating…'
                  : 'Preview'}
              </button>
            </div>

            {#if ai.imagePreviewStateFor(conn.id).status === 'ready'}
              <Image
                src={ai.imagePreviewUrlFor(conn.id)}
                alt="Generated preview"
                class="rounded-box max-h-48"
              />
            {:else if ai.imagePreviewStateFor(conn.id).status === 'error'}
              <p class="text-xs text-error">{ai.imagePreviewErrorFor(conn.id)}</p>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  {/if}

  <!-- Real connection editor — same controller instance that owns Set Up /
       Change above, so Save and Cancel act on this page. -->
  <AiConnectionModals viewModel={viewModel.aiSettingsViewModel} />
</div>
