<script lang="ts">
// apps/frontend/client/src/lib/views/dev/autonomous_sandbox_view.svelte
//
// Dev sandbox for testing autonomous NPC behavior — idle simulation,
// DND toggle, poller control, mock NPCs, schedule editor access.
//
// Contract: C-248 Autonomous NPC Behavior Schedules
import ScheduleEditorView from '$views/settings/autonomous/schedule_editor_view.svelte';
import type { AutonomousSandboxViewModelInterface } from './autonomous_sandbox_view_model.svelte';

type Props = {
  viewModel: AutonomousSandboxViewModelInterface;
};
const { viewModel }: Props = $props();

let idleSeconds = $state(10);
</script>

<div class="min-h-screen bg-base-200 p-8">
  <div class="mx-auto max-w-4xl">
    <h1 class="text-2xl font-bold text-base-content mb-2">Autonomous NPC Behavior Sandbox</h1>
    <p class="text-sm text-base-content/50 mb-6">
      Dev sandbox for testing C-248 — idle detection, DND, schedules, poller.
    </p>

    <!-- ══════════════════════════════════════════════════════════════════
         Status Cards
         ══════════════════════════════════════════════════════════════════ -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">Idle Duration</span>
        <p class="text-lg font-bold text-base-content font-mono">
          {(viewModel.idleDurationMs / 1000).toFixed(0)}s
        </p>
      </div>
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">DND Mode</span>
        <p class="text-lg font-bold {viewModel.isDnd ? 'text-error' : 'text-success'}">
          {viewModel.isDnd ? 'ON' : 'OFF'}
        </p>
      </div>
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">Poller</span>
        <p
          class="text-lg font-bold {viewModel.isPollerRunning ? 'text-success' : 'text-base-content/50'}"
        >
          {viewModel.isPollerRunning
            ? viewModel.isPollerPaused
              ? 'PAUSED'
              : 'RUNNING'
            : 'STOPPED'}
        </p>
      </div>
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">Mock NPCs</span>
        <p class="text-lg font-bold text-base-content">{viewModel.mockNpcIds.length}</p>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         Idle Simulation
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm mb-4">
      <div class="card-body">
        <h2 class="card-title text-base">Idle Detection</h2>
        <div class="flex items-center gap-3 flex-wrap">
          <div class="form-control">
            <label class="label" for="idle-seconds">
              <span class="label-text">Simulate idle (seconds)</span>
            </label>
            <input
              id="idle-seconds"
              type="range"
              min="1"
              max="600"
              value={idleSeconds}
              class="range range-sm range-primary w-40"
              oninput={(e) => { idleSeconds = Number((e.target as HTMLInputElement).value); }}
            >
            <span class="text-xs text-base-content/50">{idleSeconds}s</span>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick={() => viewModel.simulateIdle({ seconds: idleSeconds })}
          >
            Simulate Idle
          </button>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => viewModel.resetIdle()}>
            Reset
          </button>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         DND & Poller Controls
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm mb-4">
      <div class="card-body">
        <h2 class="card-title text-base">DND & Poller</h2>
        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            class="btn btn-sm {viewModel.isDnd ? 'btn-error' : 'btn-outline'}"
            onclick={() => viewModel.toggleDnd()}
          >
            {viewModel.isDnd ? 'Turn DND OFF' : 'Turn DND ON'}
          </button>
          {#if !viewModel.isPollerRunning}
            <button
              type="button"
              class="btn btn-sm btn-primary"
              onclick={() => viewModel.startPoller()}
            >
              Start Poller
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-sm btn-warning"
              onclick={() => viewModel.stopPoller()}
            >
              Stop Poller
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              onclick={() => (viewModel.isPollerPaused ? viewModel.resumePoller() : viewModel.pausePoller())}
            >
              {viewModel.isPollerPaused ? 'Resume' : 'Pause'}
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         Mock NPCs
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm mb-4">
      <div class="card-body">
        <h2 class="card-title text-base">Mock NPCs</h2>
        <div class="space-y-3">
          <!-- Grimm Forgebeard -->
          <div class="flex items-center gap-3 p-3 rounded-lg bg-base-200">
            <div class="flex-1">
              <p class="font-semibold text-sm">⚒️ Grimm Forgebeard</p>
              <p class="text-xs text-base-content/50">
                Dwarven blacksmith — morning worker, gruff demeanor. Talkativeness: 0.4
              </p>
            </div>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel.openScheduleEditor({ npcId: 'mock-npc-blacksmith' })}
            >
              Edit Schedule
            </button>
          </div>

          <!-- Shadow Elara -->
          <div class="flex items-center gap-3 p-3 rounded-lg bg-base-200">
            <div class="flex-1">
              <p class="font-semibold text-sm">🌙 Shadow Elara</p>
              <p class="text-xs text-base-content/50">
                Nocturnal rogue — prowls at night, sleeps midday. Talkativeness: 0.3
              </p>
            </div>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel.openScheduleEditor({ npcId: 'mock-npc-rogue' })}
            >
              Edit Schedule
            </button>
          </div>

          <!-- Melodious Finn -->
          <div class="flex items-center gap-3 p-3 rounded-lg bg-base-200">
            <div class="flex-1">
              <p class="font-semibold text-sm">🎵 Melodious Finn</p>
              <p class="text-xs text-base-content/50">
                Outgoing bard — performs evenings, very chatty. Talkativeness: 0.9
              </p>
            </div>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel.openScheduleEditor({ npcId: 'mock-npc-bard' })}
            >
              Edit Schedule
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         Visibility / Time Override (for testing)
         ══════════════════════════════════════════════════════════════════ -->
    <div class="card bg-base-100 shadow-sm mb-4">
      <div class="card-body">
        <h2 class="card-title text-base">Quick Status Check</h2>
        <p class="text-xs text-base-content/50 mb-2">
          What's happening right now? The current time is{' '}
          <span class="font-mono">{new Date().toLocaleString()}</span>.
        </p>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div class="p-3 rounded bg-base-200">
            <span class="font-semibold">{viewModel.dayLabels[new Date().getDay()]}</span>
            <span class="text-base-content/50 ml-1">Day {new Date().getDay()}</span>
          </div>
          <div class="p-3 rounded bg-base-200">
            <span class="font-semibold">{new Date().getHours()}:00</span>
            <span class="text-base-content/50 ml-1">Hour {new Date().getHours()}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         Test Log
         ══════════════════════════════════════════════════════════════════ -->
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-bold text-base-content">Test Log</h2>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => viewModel.clearLog()}>
        Clear
      </button>
    </div>
    <div class="rounded-lg bg-base-300 p-4 max-h-64 overflow-y-auto">
      {#if viewModel.testLog.length === 0}
        <p class="text-sm text-base-content/50 font-mono">No log entries — click actions above</p>
      {:else}
        <div class="space-y-1">
          {#each viewModel.testLog as entry (entry)}
            <p class="text-xs text-base-content/70 font-mono">{entry}</p>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Schedule Editor (mounted here for sandbox access) -->
  <ScheduleEditorView viewModel={viewModel.scheduleEditorViewModel} />
</div>
