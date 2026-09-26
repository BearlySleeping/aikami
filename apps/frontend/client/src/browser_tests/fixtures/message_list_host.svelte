<script lang="ts">
// apps/frontend/client/src/browser_tests/fixtures/message_list_host.svelte

import TalkToPartyView from '$lib/views/game/ui/overlays/talk_to_party/talk_to_party_view.svelte';
import {
  createTalkToPartyViewModel,
  type TalkToPartyViewModelInterface,
} from '$lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte';

let viewModel = $state<TalkToPartyViewModelInterface | undefined>(
  createTalkToPartyViewModel({
    className: 'MessageListHost',
    npcId: 'companion',
    npcName: 'Test companion',
    npcDialogueService: { generateTurn: async () => ({ narrative: 'Ready to travel.' }) },
    partyRoster: { getMember: () => undefined, getApproval: () => 0 },
    overlays: {
      clearStack: () => {
        viewModel = undefined;
      },
      openPartyRoster: () => {},
    },
  }),
);
</script>

{#if viewModel}
  <TalkToPartyView {viewModel} />
{/if}
