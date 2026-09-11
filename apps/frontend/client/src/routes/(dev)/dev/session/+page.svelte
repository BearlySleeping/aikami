<script lang="ts">
import { getSessionSandboxViewModel } from '$views/dev/session_sandbox_composition.ts';
// apps/frontend/client/src/routes/(dev)/dev/session/+page.svelte
//
// Dev sandbox route for the C-240 session management lifecycle.
import SessionSandboxView from '$views/dev/session_sandbox_view.svelte';

const viewModel = getSessionSandboxViewModel({ className: 'SessionSandboxViewModel' });
</script>

<SessionSandboxView {viewModel} />
