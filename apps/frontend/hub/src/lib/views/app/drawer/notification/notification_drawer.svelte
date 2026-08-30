<script lang="ts">
import { BaseViewModelContainer } from '$components';
import { getNotificationDrawerViewModel } from './notification_drawer_view_model.svelte.ts';

const viewModel = getNotificationDrawerViewModel({ className: 'NotificationDrawer' });

let drawerElement = $state<HTMLDivElement | undefined>();
let previouslyFocused: HTMLElement | null = null;

// Move focus into the drawer when it opens so Escape is handled by the
// active modal, and restore focus to the trigger when it closes.
$effect(() => {
  if (viewModel.showNotificationDrawer && drawerElement) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    drawerElement.focus();
  }
});

$effect(() => {
  if (!viewModel.showNotificationDrawer && previouslyFocused) {
    previouslyFocused.focus();
    previouslyFocused = null;
  }
});
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.showNotificationDrawer}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      bind:this={drawerElement}
      class="fixed inset-0 z-50"
      onclick={() => viewModel.toggleNotificationDrawer(false)}
      onkeydown={(e) => { if (e.key === 'Escape') { viewModel.toggleNotificationDrawer(false); } }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="absolute inset-0 bg-black/50"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute right-0 top-0 h-full w-80 border-l border-border bg-card shadow-elevated overflow-y-auto"
        onclick={(e: MouseEvent) => e.stopPropagation()}
        role="none"
      >
        <div class="p-4">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-display text-lg text-foreground">Notifications</h2>
            <button
              type="button"
              class="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              onclick={() => viewModel.toggleNotificationDrawer(false)}
              aria-label="Close"
            >
              <svg
                role="img"
                aria-label="Close"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {#if viewModel.notificationCount > 0}
            <div class="flex items-center justify-between mb-2">
              <span class="font-mono text-[11px] text-muted-foreground">
                {viewModel.notificationCount}
                notification{viewModel.notificationCount === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                class="font-mono text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onclick={() => viewModel.clearNotifications()}
              >
                Mark all as read
              </button>
            </div>

            <div class="border-t border-border my-2"></div>

            <ul class="space-y-2">
              {#each viewModel.notificationDrawerItems as notification (notification.id)}
                <li>
                  <button
                    type="button"
                    class="w-full rounded-md border border-border bg-card/40 p-3 text-left transition-colors hover:bg-accent"
                    onclick={() => viewModel.handleNotificationClick(notification)}
                  >
                    <div class="flex gap-3">
                      {#if notification.imageURL}
                        <div class="h-10 w-10 shrink-0 overflow-hidden rounded-full">
                          <img
                            src={notification.imageURL}
                            alt=""
                            class="h-full w-full object-cover"
                          >
                        </div>
                      {/if}
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium text-foreground">
                          {notification.notificationType}
                        </p>
                        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                          {notification.createdAt.toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="flex flex-col items-center justify-center py-12">
              <svg
                role="img"
                aria-label="No notifications"
                class="h-16 w-16 text-muted-foreground/30 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              <h3 class="font-display text-base text-foreground mb-1">No notifications</h3>
              <p class="text-sm text-muted-foreground">You're all caught up!</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</BaseViewModelContainer>
