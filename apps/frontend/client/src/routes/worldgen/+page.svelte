<script lang="ts">
// apps/frontend/client/src/routes/worldgen/+page.svelte
//
// C-405 AC-4 / G01: Advanced entry for the World Generation Wizard.
//
// This route produces a PRIVATE NARRATIVE DRAFT: a bounded, coherent text
// description of a world, saved on this device. It is not a playable world.
// Nothing on this route creates a campaign, a map, an NPC in the running game,
// or a save — the wizard has no capability that could.
//
// Making a generated world playable is a later milestone that needs a
// deterministic compiler and an install path; neither exists yet. The
// roadmap below names the next real step rather than linking a closed ticket
// that implies the work is merely waiting to be turned on.

import { onMount } from 'svelte';
import { routerService } from '$services';
import { getWorldGenWizardViewModel } from '$views/worldgen/world_gen_wizard_composition.ts';
import WorldGenWizardView from '$views/worldgen/world_gen_wizard_view.svelte';

const viewModel = getWorldGenWizardViewModel({ className: 'WorldGenWizardViewModel' });

// A real page reload builds a brand-new ViewModel and a brand-new draft
// service, neither of which holds anything in memory. Without this the wizard
// came back empty even though the draft row was sitting in the device
// database — the durable claim was true only within one tab's lifetime.
onMount(() => {
  void viewModel.initialize();
});
</script>

<div class="min-h-screen bg-base-100">
  <div class="bg-warning/10 border-b border-warning/30 px-4 py-3">
    <div class="max-w-3xl mx-auto flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span class="badge badge-warning badge-sm shrink-0" data-testid="worldgen-preview-badge">
        Narrative draft
      </span>
      <p class="text-sm text-base-content/80">
        This produces a private narrative draft kept on this device — not a playable world. There is
        no content-pack compiler yet; the next milestone is a deterministic compiler that turns a
        draft into a playable pack. See
        <a
          href="https://github.com/BearlySleeping/aikami/blob/main/docs/plans/private_world_generation_drafts.md"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-primary"
          data-testid="worldgen-plan-link"
        >
          the draft milestone plan
        </a>
        for exactly what this does and does not do.
      </p>
    </div>
  </div>

  <button
    type="button"
    class="btn btn-ghost btn-sm m-4"
    onclick={() => routerService.navigateToApp()}
  >
    ← Back to Start
  </button>

  <WorldGenWizardView {viewModel} />
</div>
