<script lang="ts">
// apps/frontend/client/src/routes/worldgen/+page.svelte
//
// C-405 AC-4: Advanced entry for the World Generation Wizard.
//
// This is a production route (not /dev) hosting the relocated wizard. The
// generated world is a PREVIEW: it seeds NPCs/locations/arcs/HUD state and
// GM prompt context, but it does not compile into the authored
// ContentPackManifest the game loads maps from (issue #81). The banner below
// states that plainly.

import { routerService } from '$services';
import WorldGenWizardView from '$views/worldgen/world_gen_wizard_view.svelte';
import { getWorldGenWizardViewModel } from '$views/worldgen/world_gen_wizard_view_model.svelte';

const viewModel = getWorldGenWizardViewModel({ className: 'WorldGenWizardViewModel' });
</script>

<div class="min-h-screen bg-base-100">
  <!-- C-405: honest preview notice — the generated world is not playable yet -->
  <div class="bg-warning/10 border-b border-warning/30 px-4 py-3">
    <div class="max-w-3xl mx-auto flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span class="badge badge-warning badge-sm shrink-0" data-testid="worldgen-preview-badge">
        Preview
      </span>
      <p class="text-sm text-base-content/80">
        This generated world is a preview and is not playable yet. It seeds story context and
        prompts, but the playable map is authored content — see
        <a
          href="https://github.com/BearlySleeping/aikami/issues/81"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-primary"
        >
          issue #81
        </a>
        for the content-pack compiler that will make generated worlds playable.
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
