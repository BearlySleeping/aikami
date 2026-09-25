<script lang="ts">
// apps/frontend/client/src/browser_tests/fixtures/message_list_host.svelte
//
// Host that mounts the real RichMessageList behind a ViewModel reference it
// later drops — the shape game_ui_view.svelte uses for every overlay
// (`{#if viewModel.xViewModel}`). `close()` sets the reference to undefined,
// which destroys the branch; any bind path the surface installed into the
// dropped ViewModel is read again by Svelte's `bind:this` teardown.

import { untrack } from 'svelte';
import RichMessageList from '$lib/components/messaging/rich_message_list.svelte';
import type { RichMessage } from '$types';

type FakeViewModel = {
  messages: RichMessage[];
  /** Throws once the host has dropped the ViewModel — a teardown read is a bug. */
  messageContainerElement: HTMLDivElement | undefined;
};

type Props = { initial: FakeViewModel };

let { initial }: Props = $props();
let viewModel = $state<FakeViewModel | undefined>(untrack(() => initial));

export function close(): void {
  viewModel = undefined;
}
</script>

{#if viewModel}
  <RichMessageList messages={viewModel.messages} containerClass="space-y-2">
    {#snippet renderRow(message)}
      <p>{message.text}</p>
    {/snippet}
  </RichMessageList>
{/if}
