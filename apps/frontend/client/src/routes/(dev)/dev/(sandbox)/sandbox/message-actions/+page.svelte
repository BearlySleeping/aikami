<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/message-actions/+page.svelte
//
// C-423: Deterministic a11y sandbox for the three hover-only action surfaces.
// Mounts the PRODUCTION components in controlled states so the E2E spec
// (message_actions_a11y.spec.ts) can assert keyboard-focus + touch-width
// visibility without needing a full game session.
//
// Surfaces covered:
//   - MessageActionBar (chat) — sender='ai' and sender='user'
//   - CombatInlineImage (combat) — loaded image with Expand/Regenerate overlay
//
// The dialogue surface is exercised through the existing /dev/sandbox/dialogue
// route, which mounts the production DialogueOverlay.
import MessageActionBar from '$lib/components/chat/message_action_bar.svelte';
import CombatInlineImage from '$lib/views/combat/components/combat_inline_image.svelte';
import type { MessageAction } from '$types';

/** No-op handler — the sandbox only verifies visibility/focus, not behaviour. */
const noop = (): void => {};

/** Sample image used to render the combat inline image overlay. */
const SAMPLE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<rect width="100%" height="100%" fill="#2a2a3a"/>' +
      '<text x="160" y="95" fill="#e8e8f0" font-size="18" text-anchor="middle">Combat scene</text>' +
      '</svg>',
  );

/** Records the last action invoked (surfaced in the DOM for E2E assertions). */
let lastAction = $state<MessageAction | null>(null);
</script>

<svelte:head>
  <title>Message Actions A11y (C-423) — Aikami Dev</title>
</svelte:head>

<div class="min-h-screen bg-base-100 p-6" data-testid="message-actions-sandbox">
  <h1 class="mb-6 text-lg font-bold text-base-content" data-testid="message-actions-heading">
    Message Actions A11y (C-423)
  </h1>

  <!-- Chat: AI message action bar -->
  <section class="mb-10" data-testid="chat-ai-surface">
    <h2 class="mb-2 text-sm font-semibold text-base-content/70">Chat — AI message</h2>
    <div class="group relative inline-block rounded-lg bg-base-200 p-4">
      <p class="text-sm text-base-content">An AI reply bubble.</p>
      <MessageActionBar sender="ai" ttsAvailable onAction={(action) => (lastAction = action)} />
    </div>
  </section>

  <!-- Chat: user message action bar -->
  <section class="mb-10" data-testid="chat-user-surface">
    <h2 class="mb-2 text-sm font-semibold text-base-content/70">Chat — user message</h2>
    <div class="group relative inline-block rounded-lg bg-base-200 p-4">
      <p class="text-sm text-base-content">A user message bubble.</p>
      <MessageActionBar sender="user" onAction={(action) => (lastAction = action)} />
    </div>
  </section>

  <!-- Combat: inline image overlay -->
  <section class="mb-10" data-testid="combat-surface">
    <h2 class="mb-2 text-sm font-semibold text-base-content/70">Combat — inline image</h2>
    <div class="max-w-sm">
      <CombatInlineImage imageUrl={SAMPLE_IMAGE} onRegenerate={noop} />
    </div>
  </section>

  <!-- Last action readout (E2E assertion anchor) -->
  <p class="text-xs text-base-content/50" data-testid="last-action">
    Last action: {lastAction ?? 'none'}
  </p>
</div>
