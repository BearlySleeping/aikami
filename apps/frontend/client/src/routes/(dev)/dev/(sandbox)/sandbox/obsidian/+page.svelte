<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/obsidian/+page.svelte
//
// Fixture-driven design sandbox for the Obsidian Chronicle UI/HUD overhaul
// (docs/design/game_ui_hud_overhaul.md, Phase 1). Proves one shell —
// Scene / Chronicle / Codex — across exploration, dialogue, inline checks,
// inventory inspection, and a combat turn.

import { getObsidianSandboxViewModel } from '$lib/views/dev/obsidian/obsidian_composition';
import ObsidianSandboxView from '$lib/views/dev/obsidian/obsidian_sandbox_view.svelte';

const viewModel = getObsidianSandboxViewModel({
  className: 'ObsidianSandboxViewModel',
});
</script>

<svelte:head>
  <title>Obsidian Chronicle Sandbox — Aikami Dev</title>
</svelte:head>

<ObsidianSandboxView {viewModel} />
