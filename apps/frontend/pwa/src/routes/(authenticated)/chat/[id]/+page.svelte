<script lang="ts">
    import ChatView from "$lib/views/chat/ChatView.svelte";
    import { getChatViewModel } from "$lib/views/chat/chat-view-model.svelte";

    import type { PageProps } from "./$types";

    let { data }: PageProps = $props();

    const viewModel = getChatViewModel({
        className: "ChatViewModel",
        // svelte-ignore state_referenced_locally
        npcId: data.id,
    });
</script>

<ChatView {viewModel} />
