<script lang="ts">
import { getChatViewModel } from '$lib/views/chat/chat-view-model.svelte.ts';

import type { PageProps } from './$types';

let { data }: PageProps = $props();

const _viewModel = getChatViewModel({
  className: 'ChatViewModel',
  // svelte-ignore state_referenced_locally
  npcId: data.id,
});
</script>

<ChatView {viewModel} />
