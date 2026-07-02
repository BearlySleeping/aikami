<script lang="ts">
  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
  // apps/frontend/client/src/routes/(dev)/dev/character/+page.svelte
  import { getPersonaCreateDevViewModel } from '$views/character/persona/create/persona_create_view_model.dev.svelte.ts';

  const viewModel = getPersonaCreateDevViewModel({
    className: 'PersonaCreateDevViewModel',
  });

  /** Dev tools actions wired to CharacterDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Dev Generate (AI)',
      onClick: () => viewModel.dev(),
    },
    {
      label: 'Mock Generate',
      onClick: () => viewModel.mockGenerateCharacter(),
    },
    {
      label: 'Force Error State',
      onClick: () => viewModel.forceErrorState(),
    },
    {
      label: 'Inject Junk Data',
      onClick: () => viewModel.injectJunkData(),
    },
  ];
</script>

<PersonaCreateView {viewModel} />

<!-- Debug panel -->
<div class="fixed bottom-4 left-4 z-[9999] w-96">
  <div class="collapse collapse-arrow bg-base-300">
    <input type="checkbox" bind:checked={viewModel.debugOpen}>
    <div class="collapse-title text-xs font-mono opacity-60">
      Debug: phase={viewModel.phase}
      | msgs={viewModel.messages.length}
      | streaming={viewModel.isStreaming}
      | loading={viewModel.showLoadingView}
      | avatar={viewModel.avatarUrl ? '✓' : '✗'}
      | persona={viewModel.persona ? '✓' : '✗'}
      | uploading={viewModel.isUploading ? '✓' : '✗'}
    </div>
    <div class="collapse-content text-xs font-mono opacity-60">
      <pre>{JSON.stringify({
        phase: viewModel.phase,
        messageCount: viewModel.messages.length,
        isStreaming: viewModel.isStreaming,
        showLoadingView: viewModel.showLoadingView,
        hasAvatar: !!viewModel.avatarUrl,
        hasPersona: !!viewModel.persona,
        isUploading: viewModel.isUploading,
        errorMessage: viewModel.errorMessage ?? 'none',
      }, null, 2)}</pre>
    </div>
  </div>
</div>

<DevToolsPanel actions={devActions} />
