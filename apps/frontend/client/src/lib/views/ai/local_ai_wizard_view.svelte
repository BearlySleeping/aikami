<script lang="ts">
// apps/frontend/client/src/lib/views/ai/local_ai_wizard_view.svelte
//
// Local AI install wizard UI (C-467). Renders the wizard steps: hardware
// detection → model recommendation → download → ready.
//
// Matches the design reference from C-467:
//   "Set up AI on this computer"
//     Detecting your hardware...
//     ✓ GPU: NVIDIA RTX 3070, 8GB VRAM
//     ✓ RAM: 32GB
//     ✓ Disk: 220GB free
//     Recommended: Llama 3.1 8B, Q4_K_M quantization (4.9GB)
//     [ Download & start ]           [ Choose a different model ]
//     Downloading model... ████████░░ 78%   Cancel
//     ✓ Text engine running on this computer.

import { BaseViewModelContainer } from '$components';
import type { LocalAiWizardViewModelInterface } from './local_ai_wizard_view_model.svelte';

type Props = {
  viewModel: LocalAiWizardViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="card bg-base-100 w-full shadow-xl">
    <div class="card-body gap-4">
      <!-- Header -->
      <h2 class="card-title text-lg text-base-content">Set up AI on this computer</h2>
      <p class="text-sm text-base-content/60">
        Detect your hardware and install a local AI engine — no Docker or terminal required.
      </p>

      <!-- Idle: Start detection -->
      {#if viewModel.step === 'idle'}
        <div class="flex flex-col gap-3 py-2">
          <p class="text-sm text-base-content/70">
            This will scan your system for available hardware (GPU, RAM, disk space) and recommend a
            model that fits your machine.
          </p>
          <button type="button" class="btn btn-primary" onclick={() => viewModel.startDetection()}>
            Detect my hardware
          </button>
        </div>
      {/if}

      <!-- Detecting: spinner + progress -->
      {#if viewModel.step === 'detecting'}
        <div class="flex flex-col gap-3 py-2">
          <div class="flex items-center gap-2">
            <span class="loading loading-spinner loading-md text-primary"></span>
            <span class="text-sm text-base-content/70">Detecting your hardware...</span>
          </div>
        </div>
      {/if}

      <!-- Plan: show detected hardware + recommendation -->
      {#if viewModel.step === 'plan' && viewModel.hardwareProfile && viewModel.stackPlan}
        <div class="flex flex-col gap-3 py-2">
          <!-- Hardware summary -->
          <div class="flex flex-col gap-1 text-sm">
            <div class="flex items-center gap-2">
              <span class="text-success">✓</span>
              <span class="text-base-content/80">
                {#if viewModel.hardwareProfile.gpu.vendor !== 'none'}
                  GPU: {viewModel.hardwareProfile.gpu.name ?? viewModel.hardwareProfile.gpu.vendor}
                  {#if viewModel.hardwareProfile.gpu.vramMb}
                    , {viewModel.hardwareProfile.gpu.vramMb}MB VRAM
                  {/if}
                {:else}
                  GPU: Integrated (CPU-only mode)
                {/if}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-success">✓</span>
              <span class="text-base-content/80">RAM: {viewModel.hardwareProfile.ramMb}MB</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-success">✓</span>
              <span class="text-base-content/80">
                Disk:
                {(viewModel.hardwareProfile.freeDiskBytes / (1024 * 1024 * 1024)).toFixed(0)}GB free
              </span>
            </div>
          </div>

          <!-- Model recommendation -->
          {#if viewModel.firstModelName}
            <div class="bg-base-200 rounded-box p-3 mt-2">
              <p class="text-sm font-medium text-base-content">
                Recommended: {viewModel.firstModelName}
              </p>
              <p class="text-xs text-base-content/60 mt-1">
                This fits comfortably in your system's memory.
              </p>
            </div>
          {/if}

          <!-- Actions -->
          <div class="flex gap-2 mt-2">
            <button
              type="button"
              class="btn btn-primary btn-sm flex-1"
              onclick={() => viewModel.startInstall()}
            >
              Download &amp; start
            </button>
          </div>
        </div>
      {/if}

      <!-- Starting / Downloading -->
      {#if viewModel.step === 'starting' || viewModel.step === 'downloading'}
        <div class="flex flex-col gap-3 py-2">
          <div class="flex items-center gap-2">
            <span class="loading loading-spinner loading-sm text-primary"></span>
            <span class="text-sm text-base-content/70">Starting local engine...</span>
          </div>
        </div>
      {/if}

      <!-- Ready -->
      {#if viewModel.step === 'ready'}
        <div class="flex flex-col gap-3 py-2">
          <div class="flex items-center gap-2">
            <span class="text-success text-lg">✓</span>
            <span class="text-sm font-medium text-success">
              Text engine running on this computer.
            </span>
          </div>
          {#if viewModel.sidecarPort}
            <p class="text-xs text-base-content/50">Port: {viewModel.sidecarPort}</p>
          {/if}
        </div>
      {/if}

      <!-- Error -->
      {#if viewModel.step === 'error'}
        <div class="flex flex-col gap-3 py-2">
          <div class="alert alert-error">
            <span class="text-sm">{viewModel.errorMessage || 'An error occurred'}</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline" onclick={() => viewModel.retry()}>
            Retry
          </button>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
