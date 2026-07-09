<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/dialogs/+page.svelte
  //
  // Sandbox for testing app dialogs, toast stack, and loading overlay.

  import { dialogService, imageGenerationService } from '$services';

  let _simulating = $state(false);

  const showToast = (type: string) => {
    dialogService.showSnackbar({
      text: `${type} toast notification`,
      type: type as 'success' | 'error' | 'warning',
    });
  };

  const stackToasts = () => {
    dialogService.showSnackbar({ text: 'First toast', type: 'info' });
    setTimeout(() => dialogService.showSnackbar({ text: 'Second toast', type: 'success' }), 300);
    setTimeout(() => dialogService.showSnackbar({ text: 'Third toast', type: 'warning' }), 600);
  };

  const showConfirm = async () => {
    const result = await dialogService.open({
      type: 'confirm',
      props: {
        title: 'Delete Item?',
        message: 'This action cannot be undone.',
        agreeLabel: 'Delete',
        disagreeLabel: 'Cancel',
      },
    });
    if (result) {
      dialogService.showSnackbar({ text: 'Confirmed!', type: 'success' });
    } else {
      dialogService.showSnackbar({ text: 'Cancelled', type: 'warning' });
    }
  };

  const toggleLoading = () => {
    if (dialogService.appLoading) {
      dialogService.setAppLoading(false);
    } else {
      dialogService.setAppLoading(true, 'Processing...');
    }
  };

  const simulateProgress = async () => {
    if (_simulating) {
      return;
    }
    _simulating = true;
    (
      imageGenerationService as { generationProgress: number; isGenerating: boolean }
    ).generationProgress = 0;
    (imageGenerationService as { generationProgress: number; isGenerating: boolean }).isGenerating =
      true;
    for (let i = 0; i <= 100; i += 5) {
      (
        imageGenerationService as { generationProgress: number; isGenerating: boolean }
      ).generationProgress = i;
      await new Promise((r) => setTimeout(r, 100));
    }
    (
      imageGenerationService as { generationProgress: number; isGenerating: boolean }
    ).generationProgress = 0;
    (imageGenerationService as { generationProgress: number; isGenerating: boolean }).isGenerating =
      false;
    _simulating = false;
  };
</script>

<div class="p-6 max-w-lg mx-auto space-y-8">
  <h1 class="text-2xl font-bold">App Dialogs & Toast Sandbox</h1>

  <!-- Toast -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold">Toast (auto-dismiss 5s)</h2>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-success" onclick={() => showToast('success')}>
        Success
      </button>
      <button type="button" class="btn btn-error" onclick={() => showToast('error')}>Error</button>
      <button type="button" class="btn btn-warning" onclick={() => showToast('warning')}>
        Warning
      </button>
      <button type="button" class="btn btn-info" onclick={() => showToast('info')}>Info</button>
      <button type="button" class="btn" onclick={stackToasts}>Stack 3</button>
    </div>
  </section>

  <!-- Confirm Dialog -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold">Confirm Dialog</h2>
    <button type="button" class="btn btn-primary" onclick={() => void showConfirm()}>
      Open Confirm Dialog
    </button>
  </section>

  <!-- Loading -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold">Loading Overlay</h2>
    <button type="button" class="btn" onclick={toggleLoading}>
      {dialogService.appLoading ? 'Hide Loading' : 'Show Loading'}
    </button>
  </section>

  <!-- Progress Bar -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold">Bottom Progress Bar</h2>
    <p class="text-sm text-base-content/60">
      Simulates a background task (e.g. image generation). Check the bottom of the screen.
    </p>
    <button type="button" class="btn" onclick={simulateProgress}>Simulate Progress</button>
  </section>
</div>
