<script lang="ts">
import { getExportSandboxViewModel } from '$views/dev/export_sandbox_view_model.svelte';
// apps/frontend/client/src/routes/(dev)/dev/export/+page.svelte
//
// Dev sandbox page for the Export & Data settings tab (C-246).
// Uses the sandbox ViewModel which injects mock chats, characters,
// and sessions for isolated testing.
import ExportView from '$views/settings/export/export_view.svelte';

const viewModel = getExportSandboxViewModel({
  className: 'ExportSandboxViewModel',
});
</script>

<div class="min-h-screen bg-base-200">
  <ExportView {viewModel} />
</div>
