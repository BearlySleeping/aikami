<script lang="ts">
// apps/frontend/client/src/lib/views/settings/autonomous/autonomous_settings_view.svelte
//
// Autonomous NPCs settings section — global toggles, sliders,
// per-NPC controls placeholder, and schedule editor mounting.
//
// Contract: C-248 Autonomous NPC Behavior Schedules
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { AutonomousSettingsViewModelInterface } from './autonomous_settings_view_model.svelte';
import ScheduleEditorView from './schedule_editor_view.svelte';

type Props = {
  viewModel: AutonomousSettingsViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6">
    <!-- ══════════════════════════════════════════════════════════════════
         Global Controls
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body">
        <h2 class="card-title text-base">Global Controls</h2>

        <!-- Global Pause Toggle -->
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-4" for="global-pause-toggle">
            <input
              id="global-pause-toggle"
              type="checkbox"
              class="toggle toggle-primary"
              checked={viewModel.isGloballyPaused}
              onchange={(e) => {
                const input = e.target as HTMLInputElement;
                viewModel.setGloballyPaused(input.checked);
              }}
            >
            <span class="label-text">Pause All Autonomous Messages</span>
          </label>
          <span class="text-xs text-base-content/60 ml-14">
            When enabled, no NPC will send autonomous messages. Persistent across sessions.
          </span>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         Timing Settings
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body">
        <h2 class="card-title text-base">Timing</h2>

        <!-- Idle Threshold -->
        <div class="form-control">
          <label class="label" for="idle-threshold-slider">
            <span class="label-text">Idle Threshold</span>
            <span class="label-text-alt">{viewModel.idleThresholdMinutes} min</span>
          </label>
          <input
            id="idle-threshold-slider"
            type="range"
            min={viewModel.idleThresholdMin}
            max={viewModel.idleThresholdMax}
            value={viewModel.idleThresholdMinutes}
            class="range range-sm range-primary"
            oninput={(e) => {
              const input = e.target as HTMLInputElement;
              viewModel.setIdleThresholdMinutes(Number(input.value));
            }}
          >
          <div class="flex justify-between text-xs text-base-content/50 px-1">
            <span>{viewModel.idleThresholdMin} min</span>
            <span>{viewModel.idleThresholdMax} min</span>
          </div>
        </div>

        <!-- Poller Interval -->
        <div class="form-control mt-4">
          <label class="label" for="poller-interval-slider">
            <span class="label-text">Poller Interval</span>
            <span class="label-text-alt">{viewModel.pollerIntervalSeconds}s</span>
          </label>
          <input
            id="poller-interval-slider"
            type="range"
            min={viewModel.pollerIntervalMin}
            max={viewModel.pollerIntervalMax}
            value={viewModel.pollerIntervalSeconds}
            class="range range-sm range-primary"
            oninput={(e) => {
              const input = e.target as HTMLInputElement;
              viewModel.setPollerIntervalSeconds(Number(input.value));
            }}
          >
          <div class="flex justify-between text-xs text-base-content/50 px-1">
            <span>{viewModel.pollerIntervalMin}s</span>
            <span>{viewModel.pollerIntervalMax}s</span>
          </div>
        </div>

        <!-- Default Cooldown -->
        <div class="form-control mt-4">
          <label class="label" for="cooldown-slider">
            <span class="label-text">Default Cooldown</span>
            <span class="label-text-alt">{viewModel.defaultCooldownMinutes} min</span>
          </label>
          <input
            id="cooldown-slider"
            type="range"
            min={viewModel.cooldownMin}
            max={viewModel.cooldownMax}
            value={viewModel.defaultCooldownMinutes}
            class="range range-sm range-primary"
            oninput={(e) => {
              const input = e.target as HTMLInputElement;
              viewModel.setDefaultCooldownMinutes(Number(input.value));
            }}
          >
          <div class="flex justify-between text-xs text-base-content/50 px-1">
            <span>{viewModel.cooldownMin} min</span>
            <span>{viewModel.cooldownMax} min</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         Per-NPC Overrides
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body">
        <h2 class="card-title text-base">Per-NPC Overrides</h2>

        <p class="text-sm text-base-content/60">
          Per-NPC schedule editing, talkativeness, and cooldown controls are available through the
          Schedule Editor. Open an NPC's schedule to configure their autonomous behavior.
        </p>

        <div class="alert alert-info text-sm mt-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <title>info</title>
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            Per-NPC schedule and behavior configuration will be accessible from the NPC detail page
            in a future update. For now, use the Schedule Editor to configure individual NPC
            behavior.
          </span>
        </div>
      </div>
    </div>
  </div>

  <!-- Schedule Editor (mounted globally, opened via external trigger) -->
  <ScheduleEditorView viewModel={viewModel.scheduleEditorViewModel} />
</BaseViewModelContainer>
