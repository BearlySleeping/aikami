<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/credits_modal.svelte
//
// Credits modal for the Start menu. Renders the static credit groups
// (including project inspirations) as a dismissible overlay.

import { CREDIT_GROUPS } from '../credits_data';

type Props = {
  /** Called when the player dismisses the credits modal. */
  onclose: () => void;
};

let { onclose }: Props = $props();

// Dismiss on Escape at window scope so it works regardless of where focus
// currently sits inside the modal.
$effect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onclose();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
});
</script>

<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  aria-label="Credits"
  tabindex="-1"
  onclick={(e) => {
    // Only dismiss when the backdrop itself is clicked — clicks that bubble
    // up from the modal-box, credit links, or the Close button must not
    // dismiss the modal.
    if (e.target === e.currentTarget) {
      onclose();
    }
  }}
  onkeydown={(e) => {
    // Keyboard dismissal mirrors the backdrop-only click rule: Enter/Space
    // only dismiss when the backdrop itself has focus.
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      onclose();
    }
  }}
>
  <div class="modal-box max-w-lg" role="dialog" aria-modal="true" aria-label="Credits">
    <h3 class="text-lg font-bold mb-4">Credits</h3>

    {#each CREDIT_GROUPS as group}
      <div class="mb-4">
        <h4 class="font-semibold text-sm text-base-content/70 mb-2">{group.heading}</h4>
        <ul class="space-y-2">
          {#each group.items as item}
            <li>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                class="link link-hover font-medium"
              >
                {item.name}
              </a>
              <p class="text-xs text-base-content/50">{item.description}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/each}

    <div class="modal-action">
      <button type="button" class="btn btn-sm" onclick={() => onclose()}>Close</button>
    </div>
  </div>
</div>
