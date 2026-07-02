<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/party-follow/+page.svelte
  //
  // Party Follow sandbox route.
  // Tests the concept of NPCs joining the player's party and following
  // them through the game world. Spawns recruitable NPCs that visually
  // trail behind the player at fixed offsets when recruited.

  import PartyFollowSandboxView from '$lib/views/dev/sandbox/party_follow/party_follow_sandbox_view.svelte';
  import { getPartyFollowSandboxViewModel } from '$lib/views/dev/sandbox/party_follow/party_follow_sandbox_view_model.svelte.ts';

  const viewModel = getPartyFollowSandboxViewModel({
    className: 'PartyFollowSandboxViewModel',
  });
</script>

<svelte:head>
  <title>Party Follow Sandbox — Aikami Dev</title>
</svelte:head>

<PartyFollowSandboxView {viewModel} />
