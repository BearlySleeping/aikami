<script lang="ts">
// apps/frontend/client/src/lib/views/chat/connected_chats_sandbox_view.svelte
//
// Dev sandbox view for /dev/connected-chats — full demo of the
// connected chats bridge with game chat, tag parser test area,
// OOC chat panel, and connected chats settings panel.
//
// Styled with daisyUI — distinct visual treatment for notes,
// influences, OOC, narration, and dialogue, inspired by
// Marinara-Engine's message-type differentiation.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ChatView from '$views/chat/chat_view.svelte';
import ConnectedChatsPanelView from '$views/chat/connected_chats_panel_view.svelte';
import { getConnectedChatsPanelViewModel } from '$views/chat/connected_chats_panel_view_model.svelte.ts';
import type { ConnectedChatsSandboxViewModel } from './connected_chats_sandbox_view_model.svelte.ts';

type Props = {
  viewModel: ConnectedChatsSandboxViewModel;
};

const { viewModel }: Props = $props();

const panelViewModel = getConnectedChatsPanelViewModel({
  className: 'ConnectedChatsPanelDevViewModel',
  targetChatId: 'dev-connected-chats-game',
});
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col h-full gap-3 p-4">
    <!-- ─── Header ─────────────────────────────────────────────── -->
    <div class="flex items-center justify-between flex-shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold font-mono">/dev/connected-chats</h1>
        <div class="flex items-center gap-1.5">
          <span class="badge badge-info badge-xs gap-1">
            <span class="text-[8px]">📝</span>
            Notes
          </span>
          <span class="badge badge-warning badge-xs gap-1">
            <span class="text-[8px]">⚡</span>
            Influence
          </span>
          <span class="badge badge-accent badge-xs gap-1">
            <span class="text-[8px]">💬</span>
            OOC
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="badge badge-ghost badge-xs">Bridge Tags</span>
        <span class="badge badge-ghost badge-xs">C-244</span>
      </div>
    </div>

    <!-- ─── Description ────────────────────────────────────────── -->
    <div class="alert alert-soft text-xs flex-shrink-0 py-2">
      <span class="text-base-content/70">
        Type messages with <code class="kbd kbd-xs">&lt;note&gt;</code>
        <code class="kbd kbd-xs">&lt;influence&gt;</code>
        or
        <code class="kbd kbd-xs">&lt;ooc&gt;</code>
        tags in the game chat. Tags are parsed, stripped from display, and routed appropriately.
        Notes persist across turns; influences are one-shot; OOC cross-posts to the linked DM.
      </span>
    </div>

    <!-- ─── Main layout ────────────────────────────────────────── -->
    <div class="flex flex-1 gap-4 min-h-0">
      <!-- Left column: Game Chat -->
      <div class="flex-1 min-w-0 flex flex-col min-h-0 gap-2">
        <div class="flex items-center justify-between flex-shrink-0">
          <div class="flex items-center gap-2">
            <div class="avatar avatar-placeholder w-6">
              <div class="bg-primary text-primary-content rounded-full w-6">
                <span class="text-[10px]">A</span>
              </div>
            </div>
            <span class="text-sm font-semibold">Aldric the Loremaster</span>
            <span class="badge badge-ghost badge-xs">Game Chat</span>
          </div>
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.toggleConnectedPanel()}
          >
            {viewModel.showConnectedPanel ? 'Hide Settings' : '⚙️ Settings'}
          </button>
        </div>
        <div class="flex-1 min-h-0 border border-base-300 rounded-lg overflow-hidden bg-base-100">
          <ChatView {viewModel} />
        </div>
      </div>

      <!-- Right column: Side panels -->
      <div class="w-96 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto pr-0.5">
        <!-- ── Tag Parser Test card ─────────────────────────────── -->
        <div class="card card-compact bg-base-200 border border-base-300 shadow-sm">
          <div class="card-body p-3 gap-2">
            <div class="flex items-center justify-between">
              <h3 class="card-title text-xs font-semibold">
                <span class="text-info">🧪</span>
                Tag Parser Test
              </h3>
              <span
                class="badge badge-xs"
                class:badge-ghost={viewModel.foundTags === 'None'}
                class:badge-info={viewModel.foundTags !== 'None'}
              >
                {viewModel.foundTags}
              </span>
            </div>

            <!-- Quick presets -->
            <div class="flex gap-1 flex-wrap">
              <button
                type="button"
                class="btn btn-xs btn-outline btn-info"
                onclick={() => { viewModel.tagTestInput = '<note>The wizard is watching the party</note>'; viewModel.parseTestTags(); }}
              >
                +note
              </button>
              <button
                type="button"
                class="btn btn-xs btn-outline btn-warning"
                onclick={() => { viewModel.tagTestInput = '<influence>Make the NPC suspicious of outsiders</influence>'; viewModel.parseTestTags(); }}
              >
                +influence
              </button>
              <button
                type="button"
                class="btn btn-xs btn-outline btn-accent"
                onclick={() => { viewModel.tagTestInput = '<ooc>What does my character know about dragons?</ooc>'; viewModel.parseTestTags(); }}
              >
                +ooc
              </button>
              <button
                type="button"
                class="btn btn-xs btn-outline"
                onclick={() => { viewModel.tagTestInput = '<note>watching</note>Text<influence>push</influence><ooc>question</ooc>'; viewModel.parseTestTags(); }}
              >
                All three
              </button>
            </div>

            <!-- Input -->
            <textarea
              class="textarea textarea-bordered textarea-xs w-full font-mono text-xs leading-relaxed"
              rows={3}
              bind:value={viewModel.tagTestInput}
              placeholder="Paste or type bridge-tagged text..."
            ></textarea>

            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-xs flex-1"
                onclick={() => viewModel.parseTestTags()}
              >
                Parse Tags
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => viewModel.clearTags()}
              >
                Clear
              </button>
            </div>

            <!-- Results -->
            {#if viewModel.tagParseResult}
              <div class="text-xs space-y-2">
                <div class="divider divider-neutral my-0 text-[10px]">RESULT</div>

                <!-- Clean content -->
                <div class="bg-base-100 rounded-lg p-2 border border-base-300">
                  <span
                    class="text-[10px] font-semibold text-base-content/50 uppercase tracking-wider"
                    >Clean Output</span
                  >
                  <div class="mt-0.5 text-base-content/80 italic">
                    "{viewModel.tagParseResult.cleanContent || '(empty)'}"
                  </div>
                </div>

                <!-- Notes -->
                {#if viewModel.tagParseResult.notes.length > 0}
                  <div class="bg-info/10 rounded-lg p-2 border border-info/30">
                    <span class="text-[10px] font-semibold text-info uppercase tracking-wider">
                      📝 Durable Notes ({viewModel.tagParseResult.notes.length})
                    </span>
                    {#each viewModel.tagParseResult.notes as note}
                      <div
                        class="mt-1 text-info-content/80 pl-2 border-l-2 border-info/40 text-[11px] leading-relaxed"
                      >
                        {note}
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Influences -->
                {#if viewModel.tagParseResult.influences.length > 0}
                  <div class="bg-warning/10 rounded-lg p-2 border border-warning/30">
                    <span class="text-[10px] font-semibold text-warning uppercase tracking-wider">
                      ⚡ One-Shot Influences ({viewModel.tagParseResult.influences.length})
                    </span>
                    {#each viewModel.tagParseResult.influences as inf}
                      <div
                        class="mt-1 text-warning-content/80 pl-2 border-l-2 border-warning/40 text-[11px] leading-relaxed"
                      >
                        {inf}
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- OOC -->
                {#if viewModel.tagParseResult.oocContents.length > 0}
                  <div class="bg-accent/10 rounded-lg p-2 border border-accent/30">
                    <span class="text-[10px] font-semibold text-accent uppercase tracking-wider">
                      💬 Cross-Post OOC ({viewModel.tagParseResult.oocContents.length})
                    </span>
                    {#each viewModel.tagParseResult.oocContents as ooc}
                      <div
                        class="mt-1 text-accent-content/80 pl-2 border-l-2 border-accent/40 text-[11px] leading-relaxed"
                      >
                        {ooc}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <!-- ── OOC Chat Panel ───────────────────────────────────── -->
        <div class="card card-compact bg-base-200 border border-base-300 shadow-sm flex-1">
          <div class="card-body p-3 flex flex-col min-h-0 gap-2">
            <div class="flex items-center justify-between flex-shrink-0">
              <h3 class="card-title text-xs font-semibold">
                <span class="text-accent">💬</span>
                DM Study
              </h3>
              <div class="flex items-center gap-1">
                <span class="badge badge-accent badge-xs gap-1" data-testid="ooc-connection-badge">
                  <span class="text-[8px]">🔗</span>
                  Connected
                </span>
              </div>
            </div>

            <div class="text-[10px] text-base-content/50 flex-shrink-0 italic">
              Out-of-character questions for the DM. &lt;ooc&gt; tags from the game chat cross-post
              here.
            </div>

            <!-- Messages area — daisyUI chat -->
            <div
              class="flex-1 overflow-y-auto min-h-0 border border-base-300 rounded-lg bg-base-100 p-2"
            >
              {#if viewModel.oocMessages.length === 0}
                <div
                  class="flex items-center justify-center h-full text-xs text-base-content/30 italic"
                >
                  No messages yet — ask the DM something
                </div>
              {:else}
                {#each viewModel.oocMessages as msg (msg.id)}
                  <div class="chat {msg.sender === 'user' ? 'chat-end' : 'chat-start'} mb-1">
                    {#if msg.sender === 'ai'}
                      <div class="chat-image avatar w-6">
                        <div class="w-6 rounded-full bg-accent text-accent-content">
                          <span class="text-[10px]">DM</span>
                        </div>
                      </div>
                      <div class="chat-header text-[10px] text-base-content/50 mb-0.5">
                        Game Master
                      </div>
                    {:else}
                      <div class="chat-header text-[10px] text-base-content/50 mb-0.5">You</div>
                    {/if}
                    <div
                      class="chat-bubble text-xs {msg.sender === 'user' ? 'chat-bubble-primary' : 'chat-bubble-accent'} text-xs py-2 px-3 leading-relaxed"
                    >
                      {msg.text}
                    </div>
                  </div>
                {/each}
              {/if}
            </div>

            <!-- OOC Input -->
            <div class="flex gap-1 flex-shrink-0">
              <input
                type="text"
                class="input input-bordered input-xs flex-1"
                placeholder="Ask the DM something..."
                id="ooc-input"
                data-testid="ooc-input"
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    const input = document.getElementById('ooc-input') as HTMLInputElement;
                    if (input?.value.trim()) {
                      viewModel.simulateOocPost(input.value.trim());
                      input.value = '';
                    }
                  }
                }}
              >
              <button
                type="button"
                class="btn btn-accent btn-xs"
                onclick={() => {
                  const input = document.getElementById('ooc-input') as HTMLInputElement;
                  if (input?.value.trim()) {
                    viewModel.simulateOocPost(input.value.trim());
                    input.value = '';
                  }
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        <!-- ── Connected Chats Settings ──────────────────────────── -->
        {#if viewModel.showConnectedPanel}
          <div class="card card-compact bg-base-200 border border-base-300 shadow-sm">
            <div class="card-body p-3 gap-2">
              <div class="flex items-center justify-between">
                <h3 class="card-title text-xs font-semibold">⚙️ Link Settings</h3>
                <span class="text-[10px] text-base-content/40">Manage notes & influences</span>
              </div>
              <ConnectedChatsPanelView viewModel={panelViewModel} />
              <div class="divider my-0 text-[10px]">Dev Tools</div>
              <button
                type="button"
                class="btn btn-outline btn-xs w-full"
                onclick={() => {
                  void viewModel.seedDemoLink();
                  void panelViewModel.loadLinkData();
                }}
                data-testid="seed-demo-link-btn"
              >
                🌱 Seed Demo Link
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- ─── Tag reference bar ───────────────────────────────────── -->
    <div class="flex-shrink-0 flex items-center gap-2 text-xs">
      <span class="text-base-content/40 text-[10px] font-semibold uppercase tracking-wider"
        >Quick Reference</span
      >
      <div class="divider divider-horizontal mx-0 h-4"></div>
      <button
        type="button"
        class="btn btn-xs btn-ghost text-info hover:bg-info/10 font-mono"
        onclick={() => { viewModel.tagTestInput = '<note>The wizard is watching</note>'; viewModel.parseTestTags(); }}
      >
        &lt;note&gt;
      </button>
      <button
        type="button"
        class="btn btn-xs btn-ghost text-warning hover:bg-warning/10 font-mono"
        onclick={() => { viewModel.tagTestInput = '<influence>Make them suspicious</influence>'; viewModel.parseTestTags(); }}
      >
        &lt;influence&gt;
      </button>
      <button
        type="button"
        class="btn btn-xs btn-ghost text-accent hover:bg-accent/10 font-mono"
        onclick={() => { viewModel.tagTestInput = '<ooc>What about dragons?</ooc>'; viewModel.parseTestTags(); }}
      >
        &lt;ooc&gt;
      </button>
      <div class="divider divider-horizontal mx-0 h-4"></div>
      <span class="text-base-content/30 text-[10px]">Durable</span>
      <span class="text-base-content/30 text-[10px]">|</span>
      <span class="text-base-content/30 text-[10px]">One-shot</span>
      <span class="text-base-content/30 text-[10px]">|</span>
      <span class="text-base-content/30 text-[10px]">Cross-post</span>
    </div>

    <!-- Visual runner readiness marker -->
    <div data-testid="game-ready" class="hidden"></div>
  </div>
</BaseViewModelContainer>
