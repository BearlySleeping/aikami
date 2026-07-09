<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/lorebook/+page.svelte
  //
  // Dev sandbox route for the Lorebook / World Info system (C-238 AC-5).
  // Instantiates LorebookSandboxViewModel, renders LorebookSandboxView.
  // DevToolsPanel with reset actions.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import type { DevAction } from '$types';
  import LorebookSandboxView from '$views/lorebook/lorebook_sandbox_view.svelte';
  import { getLorebookSandboxViewModel } from '$views/lorebook/lorebook_sandbox_view_model.svelte';

  const sandboxViewModel = getLorebookSandboxViewModel({
    className: 'LorebookSandboxViewModel',
  });

  const devActions: DevAction[] = [
    {
      label: 'Reset All',
      onClick: () => {
        sandboxViewModel.resetAll();
      },
    },
    {
      label: 'Toggle Active Context',
      onClick: () => {
        if (sandboxViewModel.activeContextOpen) {
          sandboxViewModel.closeActiveContext();
        } else {
          sandboxViewModel.openActiveContext();
        }
      },
    },
  ];
</script>

<div class="flex flex-col h-screen">
  <!-- Signal for visual test runner's _waitForGameReady -->
  <div data-testid="game-ready" class="hidden"></div>

  <!-- Header -->
  <div class="px-6 pt-6 pb-2 shrink-0">
    <h1 class="text-2xl font-bold">Lorebook Sandbox</h1>
    <p class="text-sm text-base-content/60 mt-1">
      Create and manage world info lorebooks. Test keyword scanning against sample messages, preview
      active context, and generate entries with AI.
    </p>
  </div>

  <!-- Main content -->
  <div class="flex-1 min-h-0 overflow-hidden px-6 pb-6">
    <LorebookSandboxView {sandboxViewModel} />
  </div>
</div>

<DevToolsPanel actions={devActions} toggles={[]} />
